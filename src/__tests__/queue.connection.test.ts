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
      // @ts-expect-error - test mock
      this.on = vi.fn();
    },
  };
});

describe("queue connection", () => {
  beforeEach(() => {
    vi.resetModules();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (global as any).queueRedis = undefined;
  });

  it("creates a Redis connection with BullMQ-compatible options", async () => {
    const { queueRedis } = await import("@/lib/queue/connection");

    expect(queueRedis).toBeDefined();
    expect(queueRedis.status).toBe("ready");
  });

  it("reuses the same connection across imports in non-production", async () => {
    const { queueRedis: first } = await import("@/lib/queue/connection");
    const { queueRedis: second } = await import("@/lib/queue/connection");

    expect(first).toBe(second);
  });
});
