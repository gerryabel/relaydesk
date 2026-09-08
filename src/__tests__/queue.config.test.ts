import { describe, it, expect } from "vitest";
import { QUEUE_NAMES, getBullMQQueueName } from "@/lib/queue/config";

describe("queue config", () => {
  it("exports a primary queue name matching the spec", () => {
    expect(QUEUE_NAMES.primary).toBe("relaydesk:primary");
  });

  it("primary queue name does not fall back to the legacy hyphenated form", () => {
    expect(QUEUE_NAMES.primary).not.toBe("relaydesk-primary");
  });

  it("provides a helper to map logical queue names to BullMQ-safe names", () => {
    expect(getBullMQQueueName(QUEUE_NAMES.primary)).toBe("relaydesk-primary");
  });
});
