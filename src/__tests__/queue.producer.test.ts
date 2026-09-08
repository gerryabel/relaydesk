import { describe, it, expect, vi, beforeEach } from "vitest";
import { QUEUE_NAMES, getBullMQQueueName } from "@/lib/queue/config";

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

describe("queue producer", () => {
  beforeEach(() => {
    vi.resetModules();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (global as any).queueRedis = undefined;
  });

  it("creates a BullMQ queue from the shared logical queue name", async () => {
    const { getQueue } = await import("@/lib/queue/producer");

    const queue = getQueue();
    expect(queue).toBeDefined();
    expect(queue.name).toBe(getBullMQQueueName(QUEUE_NAMES.primary));
  });

  it("reuses the same Queue instance on subsequent calls", async () => {
    const { getQueue } = await import("@/lib/queue/producer");

    const first = getQueue();
    const second = getQueue();

    expect(first).toBe(second);
  });
});

describe("queue config/producer contract", () => {
  beforeEach(() => {
    vi.resetModules();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (global as any).queueRedis = undefined;
  });

  it("derives its BullMQ queue name from the shared queue config", async () => {
    const { getQueue } = await import("@/lib/queue/producer");

    expect(getQueue().name).toBe(getBullMQQueueName(QUEUE_NAMES.primary));
  });

  it("does not preserve the legacy hyphenated queue name as a hardcoded string", async () => {
    const { getQueue } = await import("@/lib/queue/producer");

    expect(getQueue().name).not.toBe(QUEUE_NAMES.primary);
  });
});
