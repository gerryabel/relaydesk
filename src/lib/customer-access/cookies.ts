import { cookies } from 'next/headers';
import {
  CUSTOMER_SESSION_COOKIE_MAX_AGE_SECONDS,
  CUSTOMER_SESSION_COOKIE_NAME,
  CUSTOMER_SESSION_COOKIE_PATH,
} from './config';

/**
 * Customer session cookie handling (Phase 9 Task 1).
 *
 * The cookie carries an opaque random token. The browser never sees the
 * customer id, the workspace id, or any internal identifier — every one of
 * those is re-derived server-side from the persisted session row.
 */

export interface CustomerSessionCookieOptions {
  httpOnly: true;
  secure: boolean;
  sameSite: 'lax';
  path: string;
  maxAge: number;
}

export function buildCustomerSessionCookieOptions(): CustomerSessionCookieOptions {
  return {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    // `lax` keeps the magic-link navigation working while still blocking
    // cross-site form posts, which the portal never performs.
    sameSite: 'lax',
    path: CUSTOMER_SESSION_COOKIE_PATH,
    maxAge: CUSTOMER_SESSION_COOKIE_MAX_AGE_SECONDS,
  };
}

export { CUSTOMER_SESSION_COOKIE_NAME, CUSTOMER_SESSION_COOKIE_PATH };

/** Reads the raw session token from the request cookies. Never throws. */
export async function readCustomerSessionToken(): Promise<string | null> {
  try {
    const store = await cookies();
    return store.get(CUSTOMER_SESSION_COOKIE_NAME)?.value ?? null;
  } catch {
    return null;
  }
}
