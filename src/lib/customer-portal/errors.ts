/**
 * Customer portal ticket errors (Phase 9 Task 2).
 *
 * The portal must never disclose whether a ticket exists but belongs to
 * another customer or to another workspace, so "not yours" and "does not
 * exist" collapse into a single {@link CustomerTicketNotFoundError}. The
 * route layer maps it to `404` for both cases.
 */

import {
  CustomerAccessError,
  CustomerUnauthenticatedError,
  CustomerWorkspaceMismatchError,
  WorkspaceSlugNotFoundError,
} from '@/lib/customer-access/errors';

// Re-exported so the portal has a single error import surface. The classes
// themselves are Task 1's: portal routes must fail exactly the way the
// authentication routes do.
export {
  CustomerUnauthenticatedError,
  CustomerWorkspaceMismatchError,
  WorkspaceSlugNotFoundError,
  CustomerAccessError,
};

/**
 * The requested ticket is not visible to the authenticated customer.
 *
 * Raised for an unknown ticket id, a ticket owned by a different customer in
 * the same workspace, and a ticket owned by a different workspace. The three
 * are indistinguishable by design.
 */
export class CustomerTicketNotFoundError extends CustomerAccessError {
  constructor(message = 'Ticket not found.') {
    super(message, 'CustomerTicketNotFoundError');
  }
}

/**
 * Submitted customer input failed server-side validation.
 *
 * The route layer renders `issues[0].message`, which is always one of the
 * literal strings declared in `./schema` — never a raw driver or framework
 * message.
 */
export class CustomerTicketValidationError extends CustomerAccessError {
  readonly fieldErrors: Record<string, string[]>;

  constructor(message: string, fieldErrors: Record<string, string[]> = {}) {
    super(message, 'CustomerTicketValidationError');
    this.fieldErrors = fieldErrors;
  }
}

/**
 * The customer may not reply to this ticket right now.
 *
 * Distinct from {@link CustomerTicketNotFoundError} because the ticket *is*
 * visible — it is closed, and saying so is useful, not a disclosure. The route
 * layer renders it as `400`, not `409`: the portal's status vocabulary is the
 * one in `./http`, and the useful signal to the customer is "this will never
 * work as written" rather than a resource conflict.
 */
export class CustomerTicketReplyNotAllowedError extends CustomerAccessError {
  constructor(message = 'This ticket is closed, so replies are no longer available.') {
    super(message, 'CustomerTicketReplyNotAllowedError');
  }
}

/**
 * The requested attachment is not visible to the authenticated customer
 * (Phase 9 Task 4).
 *
 * Raised for an unknown attachment id, one on another customer's message, one
 * in another workspace, and one on a message that is not customer-visible. All
 * four are indistinguishable by design, and the route layer maps the class to
 * the same `404` body as {@link CustomerTicketNotFoundError}.
 *
 * The message is a fixed literal rather than a formatted string: an error
 * message that interpolated the id would turn a 500 log into a log of
 * enumeration attempts, and would invite the temptation to include *why* the
 * lookup failed — which is precisely the information the portal must not give.
 */
export class CustomerAttachmentNotFoundError extends CustomerAccessError {
  constructor(message = 'Attachment not found.') {
    super(message, 'CustomerAttachmentNotFoundError');
  }
}

/**
 * The submitted file failed server-side validation.
 *
 * Distinct from {@link CustomerAttachmentNotFoundError} because the resource is
 * legitimately the customer's and the *request* is what is wrong — an oversized
 * file, an empty file, or a disallowed type are actionable, so the route layer
 * renders the message as `400`.
 *
 * The message must always be a literal chosen by the validator. It may state
 * the limit that was exceeded (that is genuinely useful and discloses nothing);
 * it must never contain the offending filename, the storage key, or a driver
 * message.
 */
export class CustomerAttachmentValidationError extends CustomerAccessError {
  constructor(message = 'That file cannot be attached.') {
    super(message, 'CustomerAttachmentValidationError');
  }
}

/**
 * Storage or the attachment metadata write failed (Phase 9 Task 4).
 *
 * Deliberately *not* mapped to a customer-facing message of its own: it falls
 * through to the generic `500` branch in `./http`, which discards the message
 * entirely. The class exists so the service can distinguish "the file could not
 * be stored" from "this attachment does not exist", and so the cause is
 * loggable server-side without the route having to render it.
 */
export class CustomerAttachmentStorageError extends CustomerAccessError {
  constructor(message = 'The file could not be stored.') {
    super(message, 'CustomerAttachmentStorageError');
  }
}
