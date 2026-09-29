/**
 * Customer portal configuration (Phase 9 Task 1).
 *
 * Kept in a dependency-free module so the async email worker can import the
 * TTL without pulling in Prisma or the HTTP-facing service.
 */

export const CUSTOMER_MAGIC_LINK_TTL_MS = 15 * 60 * 1000;

export const CUSTOMER_SESSION_TTL_MS = 7 * 24 * 60 * 60 * 1000;

/** Lifetime of the `/portal`-scoped customer session cookie. */
export const CUSTOMER_SESSION_COOKIE_MAX_AGE_SECONDS = Math.floor(CUSTOMER_SESSION_TTL_MS / 1000);

export const CUSTOMER_SESSION_COOKIE_NAME = 'relaydesk_customer_session';

/**
 * Cookie scope for the customer session credential.
 *
 * MUST cover both namespaces the customer credential is used from:
 *
 *   /portal/...          the portal pages themselves
 *   /api/portal/...      the authenticated session and logout routes
 *
 * A browser only sends a cookie to paths it prefixes-matches, so a
 * `/portal`-scoped cookie would never reach `/api/portal/...` and both
 * authenticated routes would be permanently unauthenticated. `Path=/` is the
 * narrowest scope that satisfies both.
 *
 * The credential is still not usable outside the customer domain: it is an
 * opaque random token, it is not a Better Auth session, and every route that
 * reads it is under /api/portal, which authorizes server-side. Internal
 * handlers (tickets, customers, members, ...) authenticate via
 * `getCurrentMembership()` and never consult this cookie.
 */
export const CUSTOMER_SESSION_COOKIE_PATH = '/';
