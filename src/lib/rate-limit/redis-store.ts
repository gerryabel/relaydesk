import { createInMemoryRateLimitStore, type RateLimitStore } from './store';

/**
 * Redis-backed rate-limit store.
 *
 * RelayDesk already depends on Redis for BullMQ, so public endpoints reuse the
 * existing connection rather than introducing a second infrastructure
 * dependency. The connection is imported lazily so that merely importing this
 * module never opens a socket (tests and CLI scripts depend on that).
 *
 * If Redis is unreachable the limiter degrades to an in-process store instead
 * of failing open entirely: abuse protection stays bounded per instance and the
 * customer portal keeps working.
 */

const KEY_PREFIX = 'relaydesk:ratelimit';

/**
 * Atomic Lua script: increment, repair missing TTL, return count + PTTL.
 *
 * Redis guarantees Lua scripts execute atomically, so this replaces the
 * non-atomic `INCR` + `EXPIRE` sequence (R-1, R-3).
 *
 * TTL repair (R-3): if the key already exists but has no expiry (TTL == -1),
 * the script applies the configured window. This handles legacy keys that
 * were created before this script or that lost their TTL through external
 * intervention.
 */
const INCR_WITH_TTL_SCRIPT = `
  local count = redis.call('INCR', KEYS[1])
  local ttl = redis.call('TTL', KEYS[1])
  if ttl == -1 then
    redis.call('EXPIRE', KEYS[1], ARGV[1])
  end
  local pttl = redis.call('PTTL', KEYS[1])
  return {count, pttl}
`;

export interface RedisCounterClient {
  execute(script: string, keys: string[], args: (string | number)[]): Promise<unknown>;
}

export function createRedisRateLimitStore(
  redis: RedisCounterClient,
  prefix = KEY_PREFIX,
): RateLimitStore {
  return {
    async increment(key, windowSeconds) {
      const fullKey = `${prefix}:${key}`;
      const result = (await redis.execute(INCR_WITH_TTL_SCRIPT, [fullKey], [windowSeconds])) as [
        number,
        number,
      ];

      const [count, pttl] = result;

      if (!Number.isFinite(count)) {
        throw new Error('Rate limit counter is not numeric');
      }

      // PTTL returns milliseconds. Use ceil so Retry-After never under-reports
      // the remaining duration (R-2). Values <= 0 mean the key is expired or
      // missing; fall back to the configured window so callers get a sane value.
      const ttlSeconds =
        pttl <= 0 ? windowSeconds : Math.max(1, Math.ceil(pttl / 1000));

      return { count, ttlSeconds };
    },
  };
}

let storePromise: Promise<RateLimitStore> | null = null;

/** Returns the process-wide rate-limit store, preferring Redis and degrading to the in-memory store when Redis cannot be reached. */
export function getRateLimitStore(): Promise<RateLimitStore> {
  if (!storePromise) {
    storePromise = createDefaultRateLimitStore();
  }

  return storePromise;
}

/** Test seam: forces the next {@link getRateLimitStore} call to rebuild. */
export function resetRateLimitStore(): void {
  storePromise = null;
}

const DEGRADED_RETRY_INTERVAL_MS = 30_000;

async function createDefaultRateLimitStore(): Promise<RateLimitStore> {
  const fallback = createInMemoryRateLimitStore();

  let redis: RedisCounterClient;

  try {
    const { getQueueRedis } = await import('@/lib/queue/connection');
    const client = getQueueRedis();

    redis = {
      execute: (script, keys, args) => client.eval(script, keys.length, ...keys, ...args),
    };
  } catch (error) {
    console.warn('[rate-limit] Redis unavailable at startup; using in-memory store', error);
    return fallback;
  }

  const primary = createRedisRateLimitStore(redis);
  let degraded = false;
  let retryTimer: ReturnType<typeof setInterval> | null = null;
  let consecutiveHealthcheckSuccesses = 0;
  const REQUIRED_HEALTHCHECK_SUCCESSES = 2;
  let healthcheckInFlight = false;

  async function stopRetryTimer(): Promise<void> {
    if (retryTimer) {
      clearInterval(retryTimer);
      retryTimer = null;
      consecutiveHealthcheckSuccesses = 0;
      healthcheckInFlight = false;
    }
  }

  /**
   * Attempts to restore Redis as the primary store after a transient failure.
   *
   * We do not flip `degraded` back to `false` immediately on the first
   * successful Redis call: a flapping Redis instance that alternates between
   * up and down would cause the limiter to oscillate between accurate
   * distributed limits and per-instance in-memory bounds, which is worse than
   * staying degraded for a bounded period.
   *
   * The timer resets the degradation state only after a stable window of
   * consecutive successful healthchecks.
   *
   * Single-flight: only one healthcheck runs at a time. If a previous probe
   * is still awaiting Redis, subsequent timer ticks skip rather than stack.
   */
  async function tryRecover(): Promise<void> {
    if (retryTimer) {
      return;
    }

    retryTimer = setInterval(async () => {
      if (healthcheckInFlight) {
        return;
      }

      healthcheckInFlight = true;
      try {
        await primary.increment('__healthcheck__', 60);
        consecutiveHealthcheckSuccesses += 1;

        if (consecutiveHealthcheckSuccesses >= REQUIRED_HEALTHCHECK_SUCCESSES) {
          await stopRetryTimer();
          degraded = false;
          console.info('[rate-limit] Redis recovered; resuming distributed rate limiting');
        }
      } catch {
        consecutiveHealthcheckSuccesses = 0;
        // Still unreachable; stay degraded.
      } finally {
        healthcheckInFlight = false;
      }
    }, DEGRADED_RETRY_INTERVAL_MS);
  }

  return {
    async increment(key, windowSeconds) {
      if (degraded) {
        await tryRecover();
        return fallback.increment(key, windowSeconds);
      }

      try {
        return await primary.increment(key, windowSeconds);
      } catch (error) {
        if (!degraded) {
          degraded = true;
          console.error(
            '[rate-limit] Redis counter failed; degrading to in-memory store for this process',
            error,
          );
        }

        await tryRecover();
        return fallback.increment(key, windowSeconds);
      }
    },
  };
}

/**
 * Recovery trade-off (R-5):
 *
 * When Redis becomes unavailable, the process switches to an in-memory store.
 * In-memory counters are per-process and are NOT merged back into Redis when
 * distributed limiting resumes. This means a burst of requests during an
 * outage may not be counted against the distributed limit after recovery.
 *
 * For the current authentication threat model (magic-link request/verify), this
 * trade-off is acceptable:
 *   - Outages are expected to be short-lived (network blips, restarts).
 *   - Workspace-email and workspace rules still bound total traffic even if
 *     the per-IP counter is reset.
 *   - Adding counter merging would require complex reconciliation and could
 *     briefly inflate counters, creating its own availability issues.
 *
 * If the threat model changes (e.g., high-value unauthenticated endpoints),
 * reconsider merging or reducing the degradation window.
 */
