import { describe, it, expect } from "vitest";
import { QUEUE_NAMES } from "@/lib/queue/config";

describe("queue config", () => {
  it("exports a primary queue name", () => {
    expect(QUEUE_NAMES.primary).toBe("relaydesk-primary");
  });

  it("primary queue name uses the relaydesk- prefix", () => {
    expect(QUEUE_NAMES.primary.startsWith("relaydesk-")).toBe(true);
  });
});
