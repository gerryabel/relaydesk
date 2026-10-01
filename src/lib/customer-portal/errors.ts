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
