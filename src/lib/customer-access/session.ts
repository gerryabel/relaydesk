import {
  CUSTOMER_SESSION_COOKIE_NAME,
  readCustomerSessionToken,
} from './cookies';
import {
  CustomerUnauthenticatedError,
  CustomerWorkspaceMismatchError,
} from './errors';
import {
  assertCustomerInWorkspace,
  requireCustomerSession,
  resolveCustomerSession,
  resolveWorkspaceBySlug,
  touchCustomerSession,
  type CustomerSessionContext,
  type PublicWorkspace,
} from './server';

/**
 * Server-side customer session utilities (Phase 9 Task 1).
 *
 * These are the only supported entry points for customer authorization. They
 * read the opaque cookie, re-resolve the session row from the database and
 * verify the workspace relationship — no customer or workspace identity is
 * ever taken from a request body, query string or route parameter.
 */

/**
 * Resolves the current customer session, or `null` when the caller is not
 * signed in to any workspace portal.
 */
export async function getCurrentCustomerSession(): Promise<CustomerSessionContext | null> {
  const token = await readCustomerSessionToken();
  return resolveCustomerSession(token);
}

/**
 * Resolves the current customer session or throws
 * {@link CustomerUnauthenticatedError}.
 */
export async function requireCustomerSessionFromCookies(): Promise<CustomerSessionContext> {
  return requireCustomerSession(await getCurrentCustomerSession());
}

/**
 * Resolves the workspace named by a public slug and returns the customer
 * context bound to it.
 *
 * Throws:
 *  - {@link WorkspaceSlugNotFoundError} when the slug resolves to nothing;
 *  - {@link CustomerUnauthenticatedError} when no valid session exists;
 *  - {@link CustomerWorkspaceMismatchError} when the session belongs to a
 *    different workspace than the one addressed by the request.
 */
export async function requireCustomerInWorkspace(
  workspaceSlug: string,
): Promise<{ workspace: PublicWorkspace; customer: CustomerSessionContext }> {
  const workspace = await resolveWorkspaceBySlug(workspaceSlug);
  const context = requireCustomerSession(await getCurrentCustomerSession());

  assertCustomerInWorkspace(context, workspace);

  await touchCustomerSession(context.sessionId);

  return { workspace, customer: context };
}

export { CustomerUnauthenticatedError, CustomerWorkspaceMismatchError, CUSTOMER_SESSION_COOKIE_NAME };
