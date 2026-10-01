import { z } from 'zod';
import { ticketPrioritySchema, ticketStatusSchema } from '@/lib/tickets/schema';
import type { MessageAuthorType } from '@/lib/messages/authorship';
import {
  ATTACHMENT_FALLBACK_MIME_TYPE,
  normalizeAttachmentMimeType,
  sanitizeAttachmentFilename,
} from '@/lib/attachments/filename';
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
 *  - `Message.authorType`'s raw value is mapped to a label, never exposed
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
 * `reply` arrives in Task 3; `attach` is Task 4 and is still never returned.
 * The field exists so the UI renders from capability data rather than from a
 * hard-coded "no reply box" branch that Task 3 would have to remember to
 * remove.
 */
export type CustomerTicketAction = 'reply' | 'attach';

/**
 * Statuses in which a customer reply is refused.
 *
 * A closed ticket is part of the customer's record; re-opening it silently
 * would contradict what the portal just told them. Replying to a resolved or
 * waiting-on-us ticket is allowed and does not change the status — that is
 * the customer's call to make with the support team, not the portal's.
 */
const REPLY_BLOCKED_STATUSES: ReadonlySet<CustomerTicketStatus> = new Set<CustomerTicketStatus>(['closed']);

/**
 * Resolves the action list for a ticket in its current status.
 *
 * Capability data rather than a UI-side condition: the API returns the same
 * list the page renders from, so the reply box cannot appear for a status the
 * service would reject.
 */
export function resolveCustomerTicketActions(status: CustomerTicketStatus): CustomerTicketAction[] {
  return REPLY_BLOCKED_STATUSES.has(status) ? [] : ['reply'];
}

/**
 * Customer-visible author of a conversation entry.
 *
 * Task 3 introduces an explicit `Message.authorType`, so the portal reads the
 * value the writer recorded rather than inferring authorship from which
 * foreign key happens to be null.
 *
 * No member identity is exposed in any case: the customer learns whether a
 * message came from the support team, from themselves, or from the system,
 * never which agent sent it.
 */
export type CustomerMessageAuthor = 'support' | 'customer' | 'system';

export type CustomerAttachmentView = {
  id: string;
  originalFilename: string;
  mimeType: string;
  sizeBytes: number;
  createdAt: string;
};

export type CustomerMessageView = {
  /** Stable short reference. The raw message id is never serialized. */
  reference: string;
  author: CustomerMessageAuthor;
  authorLabel: string;
  body: string;
  createdAt: string;
  /** Always present, possibly empty: the portal never branches on `undefined`. */
  attachments: CustomerAttachmentView[];
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
  customer: 'You',
  system: 'System',
};

/**
 * Maps `Message.authorType` onto the portal's author vocabulary.
 *
 * A one-to-one mapping, deliberately: the three values Task 3 defines are
 * exactly the three the customer can meaningfully distinguish. Anything
 * unexpected falls back to `system`, the least revealing of the three, so a
 * future author type cannot accidentally render as the customer's own words.
 */
export function resolveCustomerMessageAuthor(authorType: MessageAuthorType | string): CustomerMessageAuthor {
  switch (authorType) {
    case 'agent':
      return 'support';
    case 'customer':
      return 'customer';
    default:
      return 'system';
  }
}

/**
 * Builds a customer-visible conversation entry.
 *
 * Accepts only the fields the portal is allowed to read, so a caller cannot
 * widen the projection by handing over a fuller row. `storageKey`, `messageId`,
 * `createdById` and `customerId` are not accepted at all — there is no argument
 * that could smuggle them into a response.
 *
 * The filename is re-sanitized here even though the upload path already did it.
 * That is not redundancy for its own sake: attachments written through the
 * *internal* route before Task 4 have whatever filename an agent's browser sent,
 * and the ticket projection reads those same rows. Sanitizing on the read path
 * means a pre-existing hostile name cannot be rendered into the conversation even
 * though it would still be re-sanitized again by the download route.
 *
 * This module stays importable from client components: `sanitizeAttachmentFilename`
 * is a pure string function with no Node or database imports.
 */
export function toCustomerAttachmentView(input: {
  id: string;
  originalFilename: string;
  mimeType: string;
  sizeBytes: number;
  createdAt: Date;
}): CustomerAttachmentView {
  return {
    id: input.id,
    originalFilename: sanitizeAttachmentFilename(input.originalFilename),
    // Fail closed rather than echoing a stored value the normalizer rejects
    // (OMP remediation, Task 4 audit). This value is a JSON field rather than a
    // header, so it cannot inject one — but a legacy row holding
    // `text/plain\r\nX-Injected: yes` should not be republished verbatim into a
    // customer payload either. Same constant as the download path.
    mimeType: normalizeAttachmentMimeType(input.mimeType) || ATTACHMENT_FALLBACK_MIME_TYPE,
    sizeBytes: input.sizeBytes,
    createdAt: input.createdAt.toISOString(),
  };
}

export function toCustomerMessageView(input: {
  id: string;
  authorType: MessageAuthorType | string;
  body: string;
  createdAt: Date;
  attachments?: Array<{
    id: string;
    originalFilename: string;
    mimeType: string;
    sizeBytes: number;
    createdAt: Date;
  }>;
}): CustomerMessageView {
  const author = resolveCustomerMessageAuthor(input.authorType);

  return {
    reference: toTicketReferenceCode(input.id),
    author,
    authorLabel: AUTHOR_LABELS[author],
    body: input.body,
    createdAt: input.createdAt.toISOString(),
    attachments: (input.attachments ?? []).map((attachment) => toCustomerAttachmentView(attachment)),
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
 * `availableActions` is derived from the status via
 * {@link resolveCustomerTicketActions}, so the API response and the rendered
 * page cannot disagree about whether replying is allowed.
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
  const availableActions = resolveCustomerTicketActions(input.status);

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
