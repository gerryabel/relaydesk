/**
 * Customer portal error classes (Phase 9 Task 1).
 *
 * All messages are intentionally generic. The public customer surface must
 * never reveal whether an email, customer, workspace, token or session
 * exists, and must never leak database or stack-trace detail.
 */

const GENERIC_INVALID_TOKEN_MESSAGE = 'Magic link is invalid or has expired.';

export class CustomerAccessError extends Error {
  constructor(message: string, name: string) {
    super(message);
    this.name = name;
  }
}

/** No customer session could be resolved for the request. */
export class CustomerUnauthenticatedError extends CustomerAccessError {
  constructor(message = 'Customer sign-in required.') {
    super(message, 'CustomerUnauthenticatedError');
  }
}

/** A session exists but does not belong to the resolved workspace. */
export class CustomerWorkspaceMismatchError extends CustomerAccessError {
  constructor(message = 'Customer session is not valid for this workspace.') {
    super(message, 'CustomerWorkspaceMismatchError');
  }
}

/** Magic link missing, malformed, expired, already consumed or cross-workspace. */
export class CustomerMagicLinkInvalidError extends CustomerAccessError {
  constructor(message = GENERIC_INVALID_TOKEN_MESSAGE) {
    super(message, 'CustomerMagicLinkInvalidError');
  }
}

/** The public workspace slug does not resolve to a workspace. */
export class WorkspaceSlugNotFoundError extends CustomerAccessError {
  constructor(message = 'Workspace not found.') {
    super(message, 'WorkspaceSlugNotFoundError');
  }
}

/** Too many customer authentication attempts. */
export class CustomerRateLimitError extends CustomerAccessError {
  constructor(message = 'Too many requests. Please try again later.') {
    super(message, 'CustomerRateLimitError');
  }
}
