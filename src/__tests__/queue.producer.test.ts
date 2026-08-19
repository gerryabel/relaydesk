import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("@/lib/env", () => ({
  env: {
    DATABASE_URL: "postgresql://localhost:5432/relaydesk",
    BETTER_AUTH_SECRET: "test-secret-at-least-32-characters-long",
    BETTER_AUTH_URL: "http://localhost:3000",
    REDIS_URL: "redis://localhost:6379",
  },
}));

vi.mock("ioredis", () => {
  return {
    Redis: function Redis() {
      // @ts-expect-error - test mock
      this.ping = vi.fn().mockResolvedValue("PONG");
      // @ts-expect-error - test mock
      this.quit = vi.fn().mockResolvedValue(undefined);
      // @ts-expect-error - test mock
      this.status = "ready";
    },
  };
});

describe("queue producer", () => {
  beforeEach(() => {
    vi.resetModules();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (global as any).queueRedis = undefined;
  });

  it("returns a Queue instance for the primary queue", async () => {
    const { getQueue } = await import("@/lib/queue/producer");
    const { QUEUE_NAMES } = await import("@/lib/queue/config");

    const queue = getQueue();
    expect(queue).toBeDefined();
    expect(queue.name).toBe(QUEUE_NAMES.primary);
  });

  it("reuses the same Queue instance on subsequent calls", async () => {
    const { getQueue } = await import("@/lib/queue/producer");

    const first = getQueue();
    const second = getQueue();

    expect(first).toBe(second);
  });
});
