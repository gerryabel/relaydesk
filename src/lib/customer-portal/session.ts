import {
  requireCustomerInWorkspace,
  getCurrentCustomerSession,
} from '@/lib/customer-access/session';
import {
  CustomerUnauthenticatedError,
  CustomerWorkspaceMismatchError,
  WorkspaceSlugNotFoundError,
} from '@/lib/customer-access/errors';
import { resolveWorkspaceBySlug } from '@/lib/customer-access/server';

/**
 * Portal session surface (Phase 9 Task 2).
 *
 * A thin re-export of the Task 1 primitives rather than a second
 * authorization implementation. It exists for two reasons:
 *
 *  - the portal reads one module for its entire session dependency, so the
 *    set of ways a customer identity can enter the portal is enumerable in
 *    one file; and
 *  - every portal route resolves the session through `requireCustomerInWorkspace()`,
 *    so there is no portal-specific session path that could drift from the
 *    boundary Task 1 established.
 *
 * Nothing here derives identity from a request body, a query string or a
 * route parameter. The workspace slug selects *which* workspace is addressed;
 * it never says *who* the caller is.
 */

export {
  requireCustomerInWorkspace,
  getCurrentCustomerSession,
  resolveWorkspaceBySlug,
  CustomerUnauthenticatedError,
  CustomerWorkspaceMismatchError,
  WorkspaceSlugNotFoundError,
};

export type { CustomerSessionContext, PublicWorkspace } from '@/lib/customer-access/server';
