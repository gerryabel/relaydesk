import { prisma } from '@/lib/db/prisma';
import type { Prisma } from '@/generated/prisma';
import { requireCustomerInWorkspace } from '@/lib/customer-portal/session';
import { CustomerTicketNotFoundError, CustomerTicketReplyNotAllowedError } from '@/lib/customer-portal/errors';
import {
  CUSTOMER_DEFAULT_TICKET_PRIORITY,
  CUSTOMER_DEFAULT_TICKET_STATUS,
  normalizeCustomerTicketSearch,
  parseCreateCustomerReplyInput,
  parseCreateCustomerTicketInput,
  parseCustomerTicketListQuery,
  type CustomerTicketListQuery,
} from '@/lib/customer-portal/schema';
import {
  resolveCustomerTicketActions,
  toCustomerMessageView,
  toCustomerTicketDetail,
  toCustomerTicketSummary,
  type CustomerMessageView,
  type CustomerTicketDetail,
  type CustomerTicketPage,
  type CustomerTicketStatus,
} from '@/lib/customer-portal/dto';
import { assertMessageAuthor } from '@/lib/messages/authorship';
import { CUSTOMER_VISIBLE_ATTACHMENT_AUTHOR_TYPES } from '@/lib/customer-portal/attachments';
import { buildLastVisibleActivityMap } from '@/lib/customer-portal/activity';
import { normalizeTicketPagination } from '@/lib/tickets/pagination';
import {
  getWorkspaceSlaPolicy,
  toResponseDeadlineMs,
  toResolutionDeadlineMs,
} from '@/lib/workspace/sla-policy';
import { createOutboxEvent } from '@/lib/outbox/outbox';
import { queueAutomationEvaluation } from '@/lib/automation/outbox';
import { createAutomationContext } from '@/lib/automation/context';

/**
 * Customer ticket service (Phase 9 Task 2).
 *
 * This module deliberately does not reuse `src/lib/tickets/server.ts`. Every
 * function there opens with `getCurrentMembership()` and is therefore
 * unreachable for a customer — a customer session is not a Better Auth
 * session and must never satisfy a membership check (spec §11). Keeping the
 * customer query path separate means the two authorization domains share no
 * call path at all.
 *
 * Invariants enforced by every entry point:
 *
 *  1. `workspaceSlug` is a lookup key only. `requireCustomerInWorkspace()`
 *     re-resolves the workspace from the database, re-resolves the customer
 *     from the session row, and asserts `customer.workspaceId ===
 *     workspace.id` before any ticket is touched.
 *  2. `workspaceId` and `customerId` always come from that resolved pair. No
 *     function in this file accepts either as an argument.
 *  3. Ticket reads are scoped in the `where` clause by both ids, so a
 *     cross-customer or cross-workspace id matches zero rows. The ticket is
 *     never fetched and authorized afterwards.
 *  4. Only `CustomerTicketDetail` / `CustomerTicketSummary` /
 *     `CustomerMessageView` leave this module; Prisma rows never do.
 */

/**
 * Column projection shared by the list, detail and create paths.
 *
 * Everything outside this list is unavailable to the customer by
 * construction — there is no value to strip later if a column is added.
 */
const customerTicketSelect = {
  id: true,
  title: true,
  description: true,
  status: true,
  priority: true,
  createdAt: true,
  resolvedAt: true,
} satisfies Prisma.TicketSelect;

type CustomerTicketRow = Prisma.TicketGetPayload<{ select: typeof customerTicketSelect }>;

/** Raw query-string values. The route layer normalizes absent keys to `undefined`. */
export type CustomerTicketListParams = Record<string, string | undefined>;

export type ListCustomerTicketsInput = {
  workspaceSlug: string;
  params?: CustomerTicketListParams;
};

/**
 * Lists the authenticated customer's own tickets.
 *
 * Scoped by `workspaceId` **and** `customerId` inside the database query — the
 * workspace-wide ticket set is never loaded and filtered afterwards. Search
 * matches only `title` and `description`, both customer-owned content;
 * `createdBy`, `assignedTo` and `customer` are deliberately not searchable on
 * a customer's behalf, and internal notes are never searched at all.
 *
 * Issues exactly three queries regardless of page size: one count, one
 * paginated `findMany`, and one grouped read of the newest message timestamp.
 * There is no per-ticket follow-up query.
 */
export async function listCustomerTickets(
  input: ListCustomerTicketsInput,
): Promise<CustomerTicketPage> {
  const query: CustomerTicketListQuery = parseCustomerTicketListQuery(input.params ?? {});
  const { workspace, customer } = await requireCustomerInWorkspace(input.workspaceSlug);

  const where = buildOwnedTicketWhere({
    workspaceId: workspace.id,
    customerId: customer.customerId,
    status: query.status,
    search: normalizeCustomerTicketSearch(query.q),
  });

  const { page, limit } = normalizeTicketPagination({ page: query.page, limit: query.limit });

  const total = await prisma.ticket.count({ where });
  const totalPages = Math.max(1, Math.ceil(total / limit));
  const normalizedPage = Math.min(page, totalPages);

  const tickets = await prisma.ticket.findMany({
    where,
    select: customerTicketSelect,
    orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
    skip: (normalizedPage - 1) * limit,
    take: limit,
  });

  const lastActivityByTicket = await loadLastVisibleActivity(tickets);

  return {
    data: tickets.map((ticket) =>
      toCustomerTicketSummary({
        id: ticket.id,
        title: ticket.title,
        status: ticket.status,
        priority: ticket.priority,
        createdAt: ticket.createdAt,
        lastActivityAt: lastActivityByTicket.get(ticket.id) ?? ticket.createdAt,
      }),
    ),
    page: normalizedPage,
    limit,
    total,
    totalPages,
    hasPreviousPage: normalizedPage > 1,
    hasNextPage: normalizedPage < totalPages,
  };
}

export type GetCustomerTicketInput = {
  workspaceSlug: string;
  ticketId: string;
};

/**
 * Reads one ticket owned by the authenticated customer.
 *
 * Both ownership predicates live in the query itself, so a ticket owned by
 * another customer — or by a customer in another workspace — is
 * indistinguishable from one that does not exist.
 *
 * The message read is a separate, explicit projection: only messages on an
 * already-authorized ticket, and only the four customer-visible columns.
 * `InternalNote`, `TicketActivity`, `AutomationExecution`, `Notification`,
 * tags, assignment and SLA configuration are never selected, so there is
 * nothing to discard at presentation time.
 */
export async function getCustomerTicket(input: GetCustomerTicketInput): Promise<CustomerTicketDetail> {
  const { workspace, customer } = await requireCustomerInWorkspace(input.workspaceSlug);

  const ticket = await prisma.ticket.findFirst({
    where: {
      id: input.ticketId,
      workspaceId: workspace.id,
      customerId: customer.customerId,
    },
    select: customerTicketSelect,
  });

  if (!ticket) {
    throw new CustomerTicketNotFoundError();
  }

  // `authorType` replaces the Task 2 `createdById` inference: a customer
  // reply carries no workspace user, and classifying it from a null
  // `createdById` would have labelled it "System".
  //
  // Attachments come along in the same query (Task 4). Nesting them rather than
  // looping keeps the read at one round trip regardless of conversation length —
  // an `attachments` query per message would be N+1, and the per-message
  // latency difference would leak how many attachments other customers' messages
  // carry. `storageKey` is absent from the projection, so it cannot be
  // serialized even by accident: the download endpoint is the only way to reach
  // a file.
  const messages = await prisma.message.findMany({
    where: { ticketId: ticket.id },
    select: {
      id: true,
      authorType: true,
      body: true,
      createdAt: true,
      attachments: {
        // Restricted to the customer-visible author types, matching the
        // download endpoint's own predicate. Filtering here means the portal
        // never lists an attachment it would then refuse to serve.
        where: { message: { authorType: { in: [...CUSTOMER_VISIBLE_ATTACHMENT_AUTHOR_TYPES] } } },
        select: {
          id: true,
          originalFilename: true,
          mimeType: true,
          sizeBytes: true,
          createdAt: true,
        },
        orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
      },
    },
    orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
  });

  const lastActivityByTicket = await loadLastVisibleActivity([ticket]);

  return toCustomerTicketDetail({
    id: ticket.id,
    title: ticket.title,
    description: ticket.description,
    status: ticket.status,
    priority: ticket.priority,
    createdAt: ticket.createdAt,
    resolvedAt: ticket.resolvedAt,
    lastActivityAt: lastActivityByTicket.get(ticket.id) ?? ticket.createdAt,
    conversation: messages.map((message) => toCustomerMessageView(message)),
  });
}

export type CreateCustomerTicketResult = {
  ticket: CustomerTicketDetail;
};

/**
 * Creates a ticket on behalf of the authenticated customer.
 *
 * Atomic by construction: SLA policy lookup, ticket insert, ticket activity,
 * the `TICKET_CREATED` outbox event and the `ticket.created` automation
 * evaluation all run in one transaction. A failure in any of them — a missing
 * SLA policy, an outbox write error — rolls the whole thing back, so a
 * customer never sees a ticket without its deadlines, and the internal
 * pipeline never sees a ticket whose creation event was lost.
 *
 * Actor semantics: a customer is not a `User`, so nothing is fabricated.
 * `Ticket.createdById`, `Ticket.assignedToId` and `TicketActivity.actorId`
 * stay `null`; both outbox payloads carry `actorId: null` and identify the
 * actor through `customerId`. Automation evaluates with a null actor, which
 * the existing `AutomationContext` type already permits, instead of the
 * ticket being attributed to an agent who never touched it.
 *
 * `assignedToId: null` is set explicitly rather than omitted so a customer
 * can never land on an agent's queue by accident, and so the trigger payload
 * matches the persisted row.
 */
export async function createCustomerTicket(input: {
  workspaceSlug: string;
  rawInput: unknown;
}): Promise<CreateCustomerTicketResult> {
  const { workspace, customer } = await requireCustomerInWorkspace(input.workspaceSlug);
  const parsed = parseCreateCustomerTicketInput(input.rawInput);

  const priority = CUSTOMER_DEFAULT_TICKET_PRIORITY;
  const now = new Date();

  const ticket = await prisma.$transaction(async (tx) => {
    const policy = await getWorkspaceSlaPolicy(tx, workspace.id, priority);

    const created = await tx.ticket.create({
      data: {
        workspaceId: workspace.id,
        customerId: customer.customerId,
        createdById: null,
        assignedToId: null,
        title: parsed.title,
        description: parsed.description ?? null,
        status: CUSTOMER_DEFAULT_TICKET_STATUS,
        priority,
        responseSlaDeadline: new Date(now.getTime() + toResponseDeadlineMs(policy)),
        resolutionSlaDeadline: new Date(now.getTime() + toResolutionDeadlineMs(policy)),
      },
      select: customerTicketSelect,
    });

    await tx.ticketActivity.create({
      data: {
        ticketId: created.id,
        actorId: null,
        type: 'TICKET_CREATED',
      },
    });

    await createOutboxEvent(
      {
        eventType: 'TICKET_CREATED',
        aggregateType: 'Ticket',
        aggregateId: created.id,
        payload: {
          workspaceId: workspace.id,
          ticketId: created.id,
          actorId: null,
          customerId: customer.customerId,
        },
      },
      tx,
    );

    await queueAutomationEvaluation(
      tx,
      'ticket.created',
      {
        workspaceId: workspace.id,
        ticketId: created.id,
        actorId: null,
        automationContext: createAutomationContext({ actorId: null }),
        triggerPayload: {
          ticketId: created.id,
          workspaceId: workspace.id,
          priority,
          status: CUSTOMER_DEFAULT_TICKET_STATUS,
          assignedToId: null,
          customerId: customer.customerId,
          createdById: null,
        },
      },
      created.id,
    );

    return created;
  });

  return {
    ticket: toCustomerTicketDetail({
      id: ticket.id,
      title: ticket.title,
      description: ticket.description,
      status: ticket.status,
      priority: ticket.priority,
      createdAt: ticket.createdAt,
      resolvedAt: ticket.resolvedAt,
      // Nothing has been said since the ticket was opened.
      lastActivityAt: ticket.createdAt,
      conversation: [],
    }),
  };
}

export type CreateCustomerReplyResult = {
  message: CustomerMessageView;
  /**
   * Raw message id of the reply just created.
   *
   * Internal plumbing only (Phase 9 Task 4): the server action uses it as the
   * target for a follow-up attachment upload, so the id never has to reach the
   * browser. The HTTP route serializes `message` alone, and the Task 3 invariant
   * holds — a raw message id is never in a customer payload.
   */
  messageId: string;
};

/**
 * Posts a customer-authored reply to a ticket (Phase 9 Task 3).
 *
 * Authorization is structural, not a check-then-write: the ticket lookup is
 * scoped by `workspaceId` *and* `customerId` in the query, so a ticket owned
 * by another customer, another workspace, or by nobody at all matches zero
 * rows and raises the same {@link CustomerTicketNotFoundError}.
 *
 * Authorship is taken from the resolved session, never from the request. The
 * body carries only text; `createdById` is `null` and `customerId` is the
 * session's customer, so a customer can neither forge an agent reply nor post
 * as another customer.
 *
 * Status is left untouched. A reply is not an implicit "please reopen this":
 * changing workflow state is the support team's action, and `assertTransitionAllowed`
 * enforces the internal transitions the portal has no business performing.
 *
 * The return value is a built DTO, so no Prisma row — and no raw message id —
 * can leak into a response from here.
 */
export async function createCustomerReply(input: {
  workspaceSlug: string;
  ticketId: string;
  rawInput: unknown;
}): Promise<CreateCustomerReplyResult> {
  const { workspace, customer } = await requireCustomerInWorkspace(input.workspaceSlug);
  const parsed = parseCreateCustomerReplyInput(input.rawInput);

  assertMessageAuthor({
    authorType: 'customer',
    createdById: null,
    customerId: customer.customerId,
  });

  const ticket = await prisma.ticket.findFirst({
    where: {
      id: input.ticketId,
      workspaceId: workspace.id,
      customerId: customer.customerId,
    },
    select: { id: true, status: true },
  });

  if (!ticket) {
    throw new CustomerTicketNotFoundError();
  }

  // Same predicate the DTO's `availableActions` uses, so the UI cannot offer a
  // reply that the service refuses (or vice versa).
  if (!resolveCustomerTicketActions(ticket.status).includes('reply')) {
    throw new CustomerTicketReplyNotAllowedError();
  }

  const message = await prisma.message.create({
    data: {
      ticketId: ticket.id,
      customerId: customer.customerId,
      createdById: null,
      authorType: 'customer',
      body: parsed.body,
    },
    select: { id: true, authorType: true, body: true, createdAt: true },
  });

  return { message: toCustomerMessageView(message), messageId: message.id };
}

/**
 * Builds the ownership predicate.
 *
 * `workspaceId` and `customerId` are required properties rather than
 * optional ones, so no caller can construct a filter that omits ownership.
 */
function buildOwnedTicketWhere(input: {
  workspaceId: string;
  customerId: string;
  status?: CustomerTicketStatus;
  search?: string;
}): Prisma.TicketWhereInput {
  const where: Prisma.TicketWhereInput = {
    workspaceId: input.workspaceId,
    customerId: input.customerId,
  };

  if (input.status) {
    where.status = input.status;
  }

  if (input.search) {
    where.OR = [
      { title: { contains: input.search, mode: 'insensitive' } },
      { description: { contains: input.search, mode: 'insensitive' } },
    ];
  }

  return where;
}

/**
 * Loads the newest customer-visible activity timestamp for a set of tickets.
 *
 * Two grouped queries for the whole page — newest message, newest
 * `STATUS_CHANGED` activity — and never one query per ticket. A ticket with
 * neither resolves to its own creation time, which is the correct
 * customer-visible answer: nothing has happened since it was opened.
 *
 * The activity query selects only `ticketId`, `createdAt` and the rows whose
 * `type` is `STATUS_CHANGED`; `actorId` and `metadata` are never read, so an
 * internal assignee or a priority edit cannot reach the portal even by
 * accident.
 */
async function loadLastVisibleActivity(
  tickets: CustomerTicketRow[],
): Promise<Map<string, Date>> {
  if (tickets.length === 0) {
    return new Map();
  }

  const ticketIds = tickets.map((ticket) => ticket.id);

  const [groupedMessages, groupedActivity] = await Promise.all([
    prisma.message.groupBy({
      by: ['ticketId'],
      where: { ticketId: { in: ticketIds } },
      _max: { createdAt: true },
    }),
    prisma.ticketActivity.groupBy({
      by: ['ticketId'],
      where: { ticketId: { in: ticketIds }, type: 'STATUS_CHANGED' },
      _max: { createdAt: true },
    }),
  ]);

  const latestMessageAt = new Map<string, Date>();
  const latestStatusChangeAt = new Map<string, Date>();

  for (const row of groupedMessages) {
    if (row._max.createdAt) {
      latestMessageAt.set(row.ticketId, row._max.createdAt);
    }
  }

  for (const row of groupedActivity) {
    if (row._max.createdAt) {
      latestStatusChangeAt.set(row.ticketId, row._max.createdAt);
    }
  }

  return buildLastVisibleActivityMap(tickets, latestMessageAt, latestStatusChangeAt);
}

export { CustomerTicketNotFoundError, CustomerTicketReplyNotAllowedError };
