import { ZodError } from 'zod';
import {
  CustomerAttachmentNotFoundError,
  CustomerAttachmentValidationError,
  CustomerTicketNotFoundError,
  CustomerTicketReplyNotAllowedError,
  CustomerTicketValidationError,
  CustomerUnauthenticatedError,
  CustomerWorkspaceMismatchError,
  WorkspaceSlugNotFoundError,
} from '@/lib/customer-portal/errors';

/**
 * Customer API error mapping (Phase 9 Task 2; reply mapping added in Task 3;
 * attachment mapping added in Task 4).
 *
 * One translation point from domain error to HTTP status, so every portal
 * route answers identically and no handler has to remember the table.
 *
 * | Condition | Status | Body |
 * | --- | --- | --- |
 * | no customer session | 401 | `Unauthorized` |
 * | session belongs to another workspace | 403 | `Forbidden` |
 * | workspace slug resolves to nothing | 404 | `Not found` |
 * | ticket missing, other customer's, or other workspace's | 404 | `Not found` |
 * | attachment missing, foreign, or not customer-visible | 404 | `Not found` |
 * | invalid customer input | 400 | the first validation message |
 * | invalid attachment (size, type, count) | 400 | the validator's literal |
 * | reply not available on a closed ticket | 400 | the literal refusal message |
 * | anything else, incl. storage failures | 500 | a fixed generic message |
 *
 * The 500 branch is the important one. `error` is discarded, not formatted:
 * a `PrismaClientKnownRequestError` carries the failing SQL, the constraint
 * name and the parameter values, and a worker or automation failure carries
 * its own stack. None of that may reach an internet-facing endpoint. That is
 * also why `CustomerAttachmentStorageError` has no branch of its own — it
 * *is* the 500 case, and giving it a message would render the storage failure
 * to the customer.
 *
 * The 404 branches share one body constant. Distinguishing "no such attachment"
 * from "an attachment that exists but is not yours" would turn any id endpoint
 * into an existence oracle for the whole workspace.
 */

export type CustomerPortalErrorBody = { error: string };

export type CustomerPortalErrorResponse = {
  status: number;
  body: CustomerPortalErrorBody;
};

const NOT_FOUND_BODY: CustomerPortalErrorBody = { error: 'Not found' };

/**
 * Maps a thrown error to a safe portal response.
 *
 * `fallbackMessage` is a literal chosen by the route author and must never be
 * built from the thrown value.
 */
export function toCustomerPortalError(
  error: unknown,
  fallbackMessage: string,
): CustomerPortalErrorResponse {
  if (error instanceof CustomerUnauthenticatedError) {
    return { status: 401, body: { error: 'Unauthorized' } };
  }

  if (error instanceof CustomerWorkspaceMismatchError) {
    return { status: 403, body: { error: 'Forbidden' } };
  }

  if (error instanceof WorkspaceSlugNotFoundError) {
    return { status: 404, body: NOT_FOUND_BODY };
  }

  if (error instanceof CustomerTicketNotFoundError) {
    return { status: 404, body: NOT_FOUND_BODY };
  }

  // Same body as the ticket branch, and for the same reason: whether the
  // attachment is missing, owned by another customer, in another workspace, or
  // on a message the customer cannot see must not be observable.
  if (error instanceof CustomerAttachmentNotFoundError) {
    return { status: 404, body: NOT_FOUND_BODY };
  }

  if (error instanceof CustomerTicketValidationError) {
    return { status: 400, body: { error: error.message } };
  }

  // The resource is the customer's and the request is what is wrong, so the
  // validator's literal is actionable and safe to show.
  if (error instanceof CustomerAttachmentValidationError) {
    return { status: 400, body: { error: error.message } };
  }

  // 400, not 409: the portal's status vocabulary is the one in the table
  // above, and a closed ticket is a rejection of this request rather than a
  // resource conflict a client could resolve by changing its headers.
  if (error instanceof CustomerTicketReplyNotAllowedError) {
    return { status: 400, body: { error: error.message } };
  }

  if (error instanceof ZodError) {
    return { status: 400, body: { error: error.issues[0]?.message ?? 'Invalid request' } };
  }

  return { status: 500, body: { error: fallbackMessage } };
}

/**
 * Client-side rendering of a failed portal request.
 *
 * The portal API answers with `{ error: string }`; anything else — an HTML
 * error page from a proxy, an empty body, a JSON blob from an unexpected
 * layer — collapses to `fallbackMessage` rather than being rendered raw.
 */
export function readCustomerPortalErrorMessage(
  payload: unknown,
  fallbackMessage: string,
): string {
  if (payload && typeof payload === 'object' && 'error' in payload) {
    const value = (payload as { error?: unknown }).error;

    if (typeof value === 'string' && value.trim().length > 0 && value.length <= 200) {
      return value;
    }
  }

  return fallbackMessage;
}
