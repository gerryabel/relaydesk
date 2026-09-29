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

export interface RedisCounterClient {
  incr(key: string): Promise<number>;
  expire(key: string, seconds: number): Promise<number>;
}

export function createRedisRateLimitStore(
  redis: RedisCounterClient,
  prefix = KEY_PREFIX,
): RateLimitStore {
  return {
    async increment(key, windowSeconds) {
      const fullKey = `${prefix}:${key}`;

      const count = Number(await redis.incr(fullKey));

      if (!Number.isFinite(count)) {
        throw new Error('Rate limit counter is not numeric');
      }

      // Only the first increment of a window sets the TTL, so a burst of
      // requests cannot keep extending the window indefinitely.
      if (count === 1) {
        await redis.expire(fullKey, windowSeconds);
      }

      return count;
    },
  };
}

let storePromise: Promise<RateLimitStore> | null = null;

/**
 * Returns the process-wide rate-limit store, preferring Redis and degrading to
 * the in-memory store when Redis cannot be reached.
 */
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

async function createDefaultRateLimitStore(): Promise<RateLimitStore> {
  const fallback = createInMemoryRateLimitStore();

  let redis: RedisCounterClient;

  try {
    const { getQueueRedis } = await import('@/lib/queue/connection');
    const client = getQueueRedis();

    redis = {
      incr: (key) => client.incr(key),
      expire: (key, seconds) => client.expire(key, seconds),
    };
  } catch (error) {
    console.warn('[rate-limit] Redis unavailable at startup; using in-memory store', error);
    return fallback;
  }

  const primary = createRedisRateLimitStore(redis);
  let degraded = false;

  /**
   * A connection that is up at startup can still fail mid-process. Degrade once
   * per process rather than returning 500s from every portal login.
   *
   * This weakens the guarantee to per-instance bounds, so it is logged loudly.
   */
  return {
    async increment(key, windowSeconds) {
      if (degraded) {
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

        return fallback.increment(key, windowSeconds);
      }
    },
  };
}
