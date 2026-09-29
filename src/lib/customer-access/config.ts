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
 * The cookie is scoped to the portal namespace so it is never attached to
 * internal `/api` or `/dashboard` traffic.
 */
export const CUSTOMER_SESSION_COOKIE_PATH = '/portal';
