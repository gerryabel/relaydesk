import { z } from 'zod';
import { ticketPrioritySchema, ticketStatusSchema } from '@/lib/tickets/schema';
import { formatTicketReference, toTicketReferenceCode } from './reference';

/**
 * Customer-safe DTOs (Phase 9 Task 2).
 *
 * This module is the single boundary between internal `Ticket`/`Message`
 * rows and anything a customer can observe. Nothing else may build a
 * customer-facing payload: every exported mapper constructs its object from
 * literals, so a column added to Prisma later cannot leak by accident the
 * way `prisma.ticket.findMany()` spread into `NextResponse.json()` would.
 *
 * Deliberately absent from every DTO below:
 *
 *  - `workspaceId`, `createdById`, `assignedToId`, `customerId`
 *  - `updatedAt` (moves on internal-only edits)
 *  - `responseSlaDeadline`, `resolutionSlaDeadline`, `firstResponseAt`
 *  - `InternalNote`, `TicketActivity`, `AutomationExecution`, `OutboxEvent`,
 *    `Notification`, worker/lease state, tags, workspace membership
 */

export type CustomerTicketStatus = z.infer<typeof ticketStatusSchema>;
export type CustomerTicketPriority = z.infer<typeof ticketPrioritySchema>;

/**
 * A row in "My tickets".
 *
 * `id` is present only because it is the route resource key for the detail
 * page (`/portal/{slug}/tickets/{ticketId}`); it is not a customer-facing
 * identifier and is never displayed. `reference` is what the UI shows.
 */
export type CustomerTicketSummary = {
  id: string;
  reference: string;
  title: string;
  status: CustomerTicketStatus;
  priority: CustomerTicketPriority;
  createdAt: string;
  /**
   * Most recent customer-visible activity.
   *
   * Derived from the ticket's creation time and its customer-visible
   * messages only — never `Ticket.updatedAt`, which internal assignment,
   * tagging, priority changes and internal notes all bump.
   */
  lastActivityAt: string;
};

/**
 * Customer actions a ticket actually supports.
 *
 * `reply` is Task 3 and `attach` is Task 4, so Task 2 returns an empty list.
 * The field exists so the UI renders from capability data rather than from a
 * hard-coded "no reply box" branch that Task 3 would have to remember to
 * remove.
 */
export type CustomerTicketAction = 'reply' | 'attach';

/**
 * Customer-visible author of a conversation entry.
 *
 * Task 3 introduces an explicit `Message.authorType`; until then the portal
 * must classify from what exists. Under the current model every message has
 * a non-null `createdById` (`createMessage` is the only writer and always
 * sets the acting workspace user), so `createdById === null` is the only
 * shape that is not an agent reply — i.e. a system entry.
 *
 * No member identity is exposed either way: the customer learns whether a
 * message came from the support team or the system, never who sent it.
 */
export type CustomerMessageAuthor = 'support' | 'system';

export type CustomerMessageView = {
  /** Stable short reference. The raw message id is never serialized. */
  reference: string;
  author: CustomerMessageAuthor;
  authorLabel: string;
  body: string;
  createdAt: string;
};

export type CustomerTicketDetail = {
  id: string;
  reference: string;
  title: string;
  description: string | null;
  status: CustomerTicketStatus;
  priority: CustomerTicketPriority;
  createdAt: string;
  lastActivityAt: string;
  resolvedAt: string | null;
  conversation: CustomerMessageView[];
  availableActions: CustomerTicketAction[];
};

export type CustomerTicketPage = {
  data: CustomerTicketSummary[];
  page: number;
  limit: number;
  total: number;
  totalPages: number;
  hasPreviousPage: boolean;
  hasNextPage: boolean;
};

const AUTHOR_LABELS: Record<CustomerMessageAuthor, string> = {
  support: 'Support team',
  system: 'System',
};

/**
 * Classifies a message author for the customer conversation.
 *
 * Replaced wholesale once Task 3 makes authorship explicit on `Message`.
 */
export function resolveCustomerMessageAuthor(createdById: string | null): CustomerMessageAuthor {
  return createdById === null ? 'system' : 'support';
}

/**
 * Builds a customer-visible conversation entry.
 *
 * Accepts only the four message fields the portal is allowed to read, so a
 * caller cannot widen the projection by handing over a fuller row.
 */
export function toCustomerMessageView(input: {
  id: string;
  createdById: string | null;
  body: string;
  createdAt: Date;
}): CustomerMessageView {
  const author = resolveCustomerMessageAuthor(input.createdById);

  return {
    reference: toTicketReferenceCode(input.id),
    author,
    authorLabel: AUTHOR_LABELS[author],
    body: input.body,
    createdAt: input.createdAt.toISOString(),
  };
}

/**
 * Builds one "My tickets" row.
 *
 * `lastActivityAt` is supplied by the caller as a `Date`, already derived
 * from customer-visible sources only (see `./activity`). `updatedAt` is not
 * accepted at all, which makes it impossible to regress this mapper onto the
 * internal timestamp.
 */
export function toCustomerTicketSummary(input: {
  id: string;
  title: string;
  status: CustomerTicketStatus;
  priority: CustomerTicketPriority;
  createdAt: Date;
  lastActivityAt: Date;
}): CustomerTicketSummary {
  return {
    id: input.id,
    reference: formatTicketReference(input.id),
    title: input.title,
    status: input.status,
    priority: input.priority,
    createdAt: input.createdAt.toISOString(),
    lastActivityAt: input.lastActivityAt.toISOString(),
  };
}

/**
 * Builds the customer ticket detail payload.
 *
 * `availableActions` is fixed to the empty list for Task 2; see
 * {@link CustomerTicketAction}.
 */
export function toCustomerTicketDetail(input: {
  id: string;
  title: string;
  description: string | null;
  status: CustomerTicketStatus;
  priority: CustomerTicketPriority;
  createdAt: Date;
  lastActivityAt: Date;
  resolvedAt: Date | null;
  conversation: CustomerMessageView[];
}): CustomerTicketDetail {
  const availableActions: CustomerTicketAction[] = [];

  return {
    id: input.id,
    reference: formatTicketReference(input.id),
    title: input.title,
    description: input.description,
    status: input.status,
    priority: input.priority,
    createdAt: input.createdAt.toISOString(),
    lastActivityAt: input.lastActivityAt.toISOString(),
    resolvedAt: input.resolvedAt?.toISOString() ?? null,
    conversation: input.conversation,
    availableActions,
  };
}
