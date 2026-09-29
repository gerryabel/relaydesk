/**
 * Rate-limit storage abstraction.
 *
 * A fixed-window counter is enough for RelayDesk's current abuse surface and
 * keeps the customer portal free of a second infrastructure dependency. The
 * interface exists so the public customer endpoints can be tested without a
 * live Redis instance.
 */
export interface RateLimitStore {
  /**
   * Increments the counter for `key` and returns the value *after* the
   * increment. Implementations must create the window key on first use.
   */
  increment(key: string, windowSeconds: number): Promise<number>;
}

type Window = { count: number; expiresAt: number };

/**
 * In-process fixed-window store.
 *
 * Suitable for tests and single-instance deployments. Not shared across
 * processes, so multi-instance deployments should use the Redis store.
 */
export function createInMemoryRateLimitStore(now: () => number = Date.now): RateLimitStore {
  const windows = new Map<string, Window>();

  return {
    async increment(key, windowSeconds) {
      const currentTime = now();
      const existing = windows.get(key);

      if (!existing || existing.expiresAt <= currentTime) {
        windows.set(key, { count: 1, expiresAt: currentTime + windowSeconds * 1000 });
        return 1;
      }

      existing.count += 1;
      return existing.count;
    },
  };
}
