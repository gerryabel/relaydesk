import { redirect } from 'next/navigation';
import {
  requireCustomerInWorkspace,
  CustomerUnauthenticatedError,
  CustomerWorkspaceMismatchError,
} from '@/lib/customer-portal/session';
import type { CustomerSessionContext, PublicWorkspace } from '@/lib/customer-portal/session';

/**
 * Server-side route protection for portal pages (Phase 9 Task 2).
 *
 * Client-side restriction is not security, so every protected page resolves
 * its session on the server before rendering, and the service behind it
 * authorizes independently — a caller who skips the page still gets a `401`.
 *
 * The two entry points below exist because of how the session reads interact
 * with rendering, not because authorization is optional.
 *
 *  - {@link requirePortalSession} for pages that need the resolved workspace
 *    or customer for rendering.
 *  - {@link withPortalSession} for pages whose main work is a service call
 *    that authorizes on its own, so the session is resolved once rather than
 *    twice. Resolving twice is not merely wasteful: it also writes two
 *    `lastSeenAt` updates per render, and a page that renders during a
 *    navigation and again during a prefetch turns that into a write storm.
 */

export type PortalSession = {
  workspace: PublicWorkspace;
  customer: CustomerSessionContext;
};

/**
 * Redirects an unauthenticated or wrong-workspace visitor to sign-in.
 *
 * Typed `never` because it is meant to be called from a `catch` block that has
 * already decided the failure was an authorization one: the code after the
 * call is unreachable, and the compiler is told so rather than warning about
 * a possibly-undefined result.
 */
export function redirectPortalVisitorToLogin(workspaceSlug: string): never {
  redirect(`/portal/${workspaceSlug}/login`);
}

/**
 * Resolves the session for a portal page, or redirects to sign-in.
 *
 * A session bound to a different workspace is treated exactly like no session:
 * it authorizes nothing here, so the visitor is sent to that workspace's own
 * login page. It is deliberately not a `403` — telling an
 * authenticated-but-wrong-workspace visitor "forbidden" would confirm that the
 * slug they guessed belongs to a real workspace.
 *
 * `redirect()` signals by throwing, so anything that is not an authentication
 * failure is re-thrown rather than being swallowed into a sign-in redirect.
 */
export async function requirePortalSession(workspaceSlug: string): Promise<PortalSession> {
  try {
    return await requireCustomerInWorkspace(workspaceSlug);
  } catch (error) {
    if (
      error instanceof CustomerUnauthenticatedError ||
      error instanceof CustomerWorkspaceMismatchError
    ) {
      redirectPortalVisitorToLogin(workspaceSlug);
    }

    throw error;
  }
}

/**
 * Runs an authorized portal operation, redirecting to sign-in if the
 * operation rejects the caller.
 *
 * The operation must be a service call that re-derives identity from the
 * customer session. This is a presentation-layer redirect only: the
 * authorization has already happened inside `operation`, and it does not
 * depend on this wrapper in any way.
 */
export async function withPortalSession<T>(
  workspaceSlug: string,
  operation: () => Promise<T>,
): Promise<T> {
  try {
    return await operation();
  } catch (error) {
    if (
      error instanceof CustomerUnauthenticatedError ||
      error instanceof CustomerWorkspaceMismatchError
    ) {
      redirectPortalVisitorToLogin(workspaceSlug);
    }

    throw error;
  }
}
