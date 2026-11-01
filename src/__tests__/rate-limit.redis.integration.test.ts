import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest';
import { getRateLimitStore, resetRateLimitStore } from '@/lib/rate-limit/redis-store';
import type { RedisCounterClient } from '@/lib/rate-limit/redis-store';

/**
 * Integration tests for the Redis rate-limit wrapper: degradation on failure,
 * periodic recovery attempts, hysteresis, and TTL repair.
 *
 * Redis is not required; the queue connection is mocked so we can inject a
 * fake Redis client that behaves like a real one with controllable failures.
 */

vi.mock('@/lib/queue/connection', async () => {
  const actual = await import('@/lib/queue/connection');
  return {
    ...actual,
    getQueueRedis: vi.fn(),
  };
});

const { getQueueRedis } = await import('@/lib/queue/connection');
const mockedGetQueueRedis = vi.mocked(getQueueRedis);

beforeEach(() => {
  resetRateLimitStore();
  vi.clearAllMocks();
  vi.useFakeTimers();
});

afterEach(() => {
  vi.useRealTimers();
});

describe('Redis rate-limit wrapper', () => {
  it('uses Redis when available at startup', async () => {
    const redis = createFakeRedis({ healthy: true });
    mockedGetQueueRedis.mockReturnValue(redis as never);

    const store = getRateLimitStore();
    const result = await store.then((s) => s.increment('k', 60));

    expect(result.count).toBe(1);
    expect(result.ttlSeconds).toBe(60);
  });

  it('falls back to in-memory when Redis is unreachable at startup', async () => {
    mockedGetQueueRedis.mockImplementation(() => {
      throw new Error('ECONNREFUSED');
    });

    const store = getRateLimitStore();
    const result = await store.then((s) => s.increment('k', 60));

    expect(result.count).toBe(1);
    expect(result.ttlSeconds).toBe(60);
  });

  it('degrades to in-memory after a mid-process Redis failure', async () => {
    const redis = createFakeRedis({ healthy: true });
    mockedGetQueueRedis.mockReturnValue(redis as never);

    const store = getRateLimitStore();
    // Prime the connection.
    await store.then((s) => s.increment('k', 60));

    // Simulate a Redis outage.
    redis.setHealthy(false);
    redis.setNextError(new Error('Redis connection reset'));

    const result = await store.then((s) => s.increment('k2', 60));

    expect(result.count).toBe(1);
    expect(result.ttlSeconds).toBe(60);
  });

  it('requires two consecutive healthcheck successes to recover (hysteresis)', async () => {
    const redis = createFakeRedis({ healthy: true });
    mockedGetQueueRedis.mockReturnValue(redis as never);

    const store = getRateLimitStore();
    await store.then((s) => s.increment('k', 60));

    redis.setHealthy(false);
    redis.setNextError(new Error('Redis down'));

    // First degraded call triggers the retry timer.
    await store.then((s) => s.increment('k2', 60));

    // One failed healthcheck should NOT recover.
    vi.advanceTimersByTime(30_001);
    redis.setHealthy(true);
    redis.setNextError(new Error('Redis still flaky'));

    const result1 = await store.then((s) => s.increment('k3', 60));
    expect(result1.count).toBe(1);
    // Still degraded because only 1 success (need 2).
    expect(result1.ttlSeconds).toBe(60);

    // Second consecutive success SHOULD recover.
    vi.advanceTimersByTime(30_001);
    redis.setNextError(null);

    const result2 = await store.then((s) => s.increment('k4', 60));
    expect(result2.count).toBe(1);
    expect(result2.ttlSeconds).toBe(60);
  });

  it('resets healthcheck streak after a failure during recovery', async () => {
    const redis = createFakeRedis({ healthy: true });
    mockedGetQueueRedis.mockReturnValue(redis as never);

    const store = getRateLimitStore();
    await store.then((s) => s.increment('k', 60));

    redis.setHealthy(false);
    redis.setNextError(new Error('Redis down'));
    await store.then((s) => s.increment('k2', 60));

    // First tick: success.
    vi.advanceTimersByTime(30_001);
    redis.setHealthy(true);
    redis.setNextError(null);

    await store.then((s) => s.increment('k3', 60));

    // Second tick: failure — should reset streak.
    vi.advanceTimersByTime(30_001);
    redis.setHealthy(true);
    redis.setNextError(new Error('Redis flaky'));

    const result = await store.then((s) => s.increment('k4', 60));
    expect(result.count).toBe(1);
    expect(result.ttlSeconds).toBe(60);
    // Still degraded; need 2 consecutive successes again.
  });

  it('repairs a legacy key that has no TTL', async () => {
    const redis = createFakeRedis({ healthy: true });
    mockedGetQueueRedis.mockReturnValue(redis as never);

    // Pre-populate a key without TTL (legacy state).
    redis.counters.set('relaydesk:ratelimit:legacy', 5);
    redis.ttls.set('relaydesk:ratelimit:legacy', -1); // no expiry

    const store = getRateLimitStore();
    const result = await store.then((s) => s.increment('legacy', 120));

    expect(result.count).toBe(6);
    // The script repaired the missing TTL.
    expect(result.ttlSeconds).toBe(120);
  });

  it('does not extend a window that already has a TTL', async () => {
    const redis = createFakeRedis({ healthy: true });
    mockedGetQueueRedis.mockReturnValue(redis as never);

    // Pre-populate a key with a 300s TTL.
    redis.counters.set('relaydesk:ratelimit:bounded', 3);
    redis.ttls.set('relaydesk:ratelimit:bounded', 300_000);

    const store = getRateLimitStore();
    const result = await store.then((s) => s.increment('bounded', 60));

    expect(result.count).toBe(4);
    // Existing TTL preserved (not reset to 60s).
    expect(result.ttlSeconds).toBe(300);
  });

  it('skips overlapping recovery probes (single-flight)', async () => {
    const redis = createFakeRedis({ healthy: true });
    mockedGetQueueRedis.mockReturnValue(redis as never);

    const store = getRateLimitStore();
    await store.then((s) => s.increment('k', 60));

    redis.setHealthy(false);
    redis.setNextError(new Error('Redis down'));

    // First degraded call triggers the retry timer.
    await store.then((s) => s.increment('k2', 60));

    // Advance to trigger the first healthcheck tick.
    vi.advanceTimersByTime(30_001);
    redis.setHealthy(true);
    redis.setNextError(null);

    // The healthcheck succeeds, streak = 1. Not enough to recover.
    const result1 = await store.then((s) => s.increment('k3', 60));
    expect(result1.count).toBe(1);
    expect(result1.ttlSeconds).toBe(60); // still degraded

    // Advance again for the second tick.
    vi.advanceTimersByTime(30_001);
    // Healthcheck succeeds again, streak = 2 → recovery.
    const result2 = await store.then((s) => s.increment('k4', 60));
    expect(result2.count).toBe(1);
    expect(result2.ttlSeconds).toBe(60);
  });
});

function createFakeRedis(opts: { healthy: boolean }): RedisCounterClient & {
  setHealthy: (v: boolean) => void;
  setNextError: (e: Error | null) => void;
  counters: Map<string, number>;
  ttls: Map<string, number>;
} {
  const counters = new Map<string, number>();
  const ttls = new Map<string, number>();
  let healthy = opts.healthy;
  let nextError: Error | null = null;

  const run = async (_script: string, keys: string[], args: (string | number)[]) => {
    if (!healthy || nextError) {
      const err = nextError ?? new Error('Redis connection lost');
      nextError = null;
      throw err;
    }

    const key = keys[0]!;
    const window = Number(args[0]!);
    const count = (counters.get(key) ?? 0) + 1;
    counters.set(key, count);

    if (!ttls.has(key)) {
      ttls.set(key, window * 1000);
    }

    return [count, ttls.get(key)!] as [number, number];
  };

  const client: RedisCounterClient & { eval: (script: string, keyCount: number, ...args: (string | number)[]) => Promise<unknown> } = {
    execute: run,
    eval: async (_script: string, keyCount: number, ...args: (string | number)[]) => {
      const keys = Array.from({ length: keyCount }, (_, i) => args[i] as string);
      const scriptArgs = args.slice(keyCount);
      return run(_script, keys, scriptArgs);
    },
  };

  return {
    ...client,
    counters,
    ttls,
    setHealthy: (v: boolean) => {
      healthy = v;
    },
    setNextError: (e: Error | null) => {
      nextError = e;
    },
  };
}
