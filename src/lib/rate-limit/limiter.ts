import { getRateLimitStore } from './redis-store';
import type { RateLimitStore } from './store';

export type { RateLimitStore } from './store';
export { createInMemoryRateLimitStore } from './store';
export { createRedisRateLimitStore, getRateLimitStore, resetRateLimitStore } from './redis-store';

/**
 * Minimal fixed-window rate limiter for public, unauthenticated endpoints.
 *
 * Deliberately dependency-free beyond the existing Redis connection so it can
 * be reused by the remaining customer portal endpoints.
 */

export interface RateLimitRule {
  /** Logical bucket name, e.g. `customer-magic-link-request`. */
  action: string;
  /** Caller-controlled dimensions joined with `:` (workspace, email hash, IP, ...). */
  dimensions: string[];
  /** Requests permitted per window. */
  limit: number;
  /** Window length in seconds. */
  windowSeconds: number;
}

export interface RateLimitVerdict {
  allowed: boolean;
  /** The rule that rejected the request, if any. */
  limitedBy: RateLimitRule | null;
  /** Seconds until the tightest exhausted window resets. */
  retryAfterSeconds: number;
}

export class RateLimitStoreUnavailableError extends Error {
  constructor(message = 'Rate limit storage is unavailable.') {
    super(message);
    this.name = 'RateLimitStoreUnavailableError';
  }
}

/**
 * Normalizes a rule into a storage key.
 *
 * Dimensions are caller-provided; callers must never pass raw secrets or raw
 * personal data. The customer portal passes only workspace ids, hashed emails
 * and hashed IP addresses.
 */
export function buildRateLimitKey(rule: RateLimitRule): string {
  return [rule.action, ...rule.dimensions].join(':');
}

/**
 * Consumes one unit from every rule, then reports the verdict.
 *
 * Every rule is always consumed, even after one rejects. Returning early would
 * let a caller probe a tighter bucket without paying for the others: a request
 * rejected on the per-workspace-email rule would never touch the per-IP bucket,
 * so the IP counter would under-count exactly the traffic an attacker is trying
 * to spread out. Consuming all buckets first means the totals are always a
 * faithful record of the requests actually made.
 *
 * When several rules reject, the one with the shortest window wins: it is the
 * soonest to reset, so it produces the least misleading `retryAfterSeconds`.
 */
export async function consumeRateLimit(
  rules: RateLimitRule[],
  store?: RateLimitStore,
): Promise<RateLimitVerdict> {
  const activeStore = store ?? (await getRateLimitStore());

  let rejection: RateLimitVerdict | null = null;

  for (const rule of rules) {
    const count = await activeStore.increment(buildRateLimitKey(rule), rule.windowSeconds);

    if (count > rule.limit && (rejection === null || rule.windowSeconds < rejection.retryAfterSeconds)) {
      rejection = {
        allowed: false,
        limitedBy: rule,
        retryAfterSeconds: rule.windowSeconds,
      };
    }
  }

  return rejection ?? { allowed: true, limitedBy: null, retryAfterSeconds: 0 };
}
