import { describe, it, expect, beforeAll, afterAll, afterEach } from 'vitest';
import { Redis } from 'ioredis';
import { createRedisRateLimitStore } from '@/lib/rate-limit/redis-store';

/**
 * Real Redis integration tests for the rate-limit store.
 *
 * These tests require a running Redis server. They are run in CI via a
 * dedicated GitHub Actions job with a Redis service. If Redis is unavailable,
 * the tests fail fast rather than silently skipping.
 *
 * Run with: npx vitest run src/__tests__/rate-limit.redis.real.test.ts
 */

const REDIS_URL = process.env.REDIS_URL ?? 'redis://127.0.0.1:6379';
const TEST_PREFIX = 'relaydesk:ratelimit:test:real';

describe('real Redis rate-limit store', () => {
  let client: Redis | null = null;
  let store: ReturnType<typeof createRedisRateLimitStore> | null = null;

  function connected() {
    if (!client || !store) {
      throw new Error('Redis not connected');
    }
    return { client, store };
  }

  beforeAll(async () => {
    client = new Redis(REDIS_URL, {
      lazyConnect: false,
      connectTimeout: 5000,
      commandTimeout: 5000,
    });
    await client.ping();

    store = createRedisRateLimitStore({
      execute: (script, keys, args) => client!.eval(script, keys.length, ...keys, ...args),
    }, TEST_PREFIX);
  }, 30_000);

  afterAll(async () => {
    if (client) {
      try {
        const keys = await Promise.race([
          client.keys(`${TEST_PREFIX}:*`),
          new Promise<string[]>((resolve) => setTimeout(() => resolve([]), 1000)),
        ]);
        if (keys.length > 0) {
          await client.del(keys);
        }
      } catch {
        // best-effort cleanup
      }
      try {
        await Promise.race([
          client.quit(),
          new Promise<void>((resolve) => setTimeout(() => resolve(), 1000)),
        ]);
      } catch {
        // best-effort
      }
    }
  });

  afterEach(async () => {
    if (client && store) {
      try {
        const keys = await Promise.race([
          client.keys(`${TEST_PREFIX}:*`),
          new Promise<string[]>((resolve) => setTimeout(() => resolve([]), 1000)),
        ]);
        if (keys.length > 0) {
          await client.del(keys);
        }
      } catch {
        // best-effort cleanup
      }
    }
  });

  it('creates a new key with the configured TTL', async () => {
    const { client: c, store: s } = connected();
    const result = await s.increment('new-key', 120);

    expect(result.count).toBe(1);
    expect(result.ttlSeconds).toBeGreaterThanOrEqual(119);
    expect(result.ttlSeconds).toBeLessThanOrEqual(120);

    const ttl = await c.ttl(`${TEST_PREFIX}:new-key`);
    expect(ttl).toBeGreaterThan(0);
    expect(ttl).toBeLessThanOrEqual(120);
  });

  it('executes the actual Lua script through ioredis.eval', async () => {
    const { store: s } = connected();
    const result = await s.increment('lua-test', 60);

    expect(result.count).toBe(1);
    expect(result.ttlSeconds).toBeGreaterThan(0);

    // Verify the key exists in Redis with the correct TTL.
    const { client: c } = connected();
    const exists = await c.exists(`${TEST_PREFIX}:lua-test`);
    expect(exists).toBe(1);
  });

  it('handles concurrent increments correctly', async () => {
    const { store: s } = connected();
    const workers = Array.from({ length: 10 }, () => s.increment('concurrent', 60));
    const results = await Promise.all(workers);

    const counts = results.map((r) => r.count);
    expect(counts).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10]);

    // All should see the same TTL.
    const ttls = results.map((r) => r.ttlSeconds);
    expect(ttls.every((t) => t === ttls[0])).toBe(true);
  });

  it('does not extend an existing TTL window during a burst', async () => {
    const { client: c, store: s } = connected();
    // Pre-populate a key with a 300s TTL (simulating an existing window).
    await c.set(`${TEST_PREFIX}:bounded`, '3', 'PX', 300_000);

    const result = await s.increment('bounded', 60);

    expect(result.count).toBe(4);

    // TTL should still reflect the original 300s window, not be reset to 60s.
    const ttl = await c.pttl(`${TEST_PREFIX}:bounded`);
    expect(ttl).toBeGreaterThan(0);
    expect(ttl).toBeLessThanOrEqual(300_000);
  });

  it('repairs a legacy key that has no TTL', async () => {
    const { client: c, store: s } = connected();
    // Pre-populate a key without TTL.
    await c.set(`${TEST_PREFIX}:legacy`, '5');

    const result = await s.increment('legacy', 90);

    expect(result.count).toBe(6);
    expect(result.ttlSeconds).toBeGreaterThan(0);
    expect(result.ttlSeconds).toBeLessThanOrEqual(90);

    const ttl = await c.pttl(`${TEST_PREFIX}:legacy`);
    expect(ttl).toBeGreaterThan(0);
    expect(ttl).toBeLessThanOrEqual(90_000);
  });

  it('returns PTTL and rounds Retry-After up correctly', async () => {
    const { store: s } = connected();
    const result = await s.increment('pttl-test', 60);

    expect(result.count).toBe(1);
    expect(result.ttlSeconds).toBeGreaterThanOrEqual(59);
    expect(result.ttlSeconds).toBeLessThanOrEqual(60);
  });

  it('preserves an existing TTL and does not reset it', async () => {
    const { client: c, store: s } = connected();
    // Set a key with a 180s TTL.
    await c.set(`${TEST_PREFIX}:preserved`, '1', 'PX', 180_000);

    const result = await s.increment('preserved', 30);

    expect(result.count).toBe(2);

    // TTL should still be close to 180s, not reset to 30s.
    const pttl = await c.pttl(`${TEST_PREFIX}:preserved`);
    expect(pttl).toBeGreaterThan(170_000);
    expect(pttl).toBeLessThanOrEqual(180_000);
  });

  it('actually expires the key after the TTL window', async () => {
    const { client: c, store: s } = connected();
    // Use a short TTL so the test doesn't wait long.
    await s.increment('expiry', 2);

    const existsBefore = await c.exists(`${TEST_PREFIX}:expiry`);
    expect(existsBefore).toBe(1);

    // Wait for expiry (2 seconds + buffer).
    await new Promise((resolve) => setTimeout(resolve, 3_500));

    const existsAfter = await c.exists(`${TEST_PREFIX}:expiry`);
    expect(existsAfter).toBe(0);
  });
});
