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
 * Consumes one unit from every rule and reports the first rejection.
 *
 * All rules are incremented even after one rejects, so an attacker cannot
 * dodge a tighter bucket by hitting a looser one first.
 */
export async function consumeRateLimit(
  rules: RateLimitRule[],
  store?: RateLimitStore,
): Promise<RateLimitVerdict> {
  const activeStore = store ?? (await getRateLimitStore());

  for (const rule of rules) {
    const count = await activeStore.increment(buildRateLimitKey(rule), rule.windowSeconds);

    if (count > rule.limit) {
      return {
        allowed: false,
        limitedBy: rule,
        retryAfterSeconds: rule.windowSeconds,
      };
    }
  }

  return { allowed: true, limitedBy: null, retryAfterSeconds: 0 };
}
