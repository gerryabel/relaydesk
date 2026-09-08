import { describe, it, expect } from "vitest";
import { fileURLToPath } from "node:url";
import path from "node:path";
import fs from "node:fs";
import { QUEUE_NAMES, getBullMQQueueName } from "@/lib/queue/config";

const resolvedWorkerPath = path.resolve(fileURLToPath(new URL("../../scripts/worker.mjs", import.meta.url)));

describe("worker startup", () => {
  it("uses the shared queue configuration from the queue config module", async () => {
    const source = await fs.promises.readFile(resolvedWorkerPath, "utf8");

    expect(source).toContain(`../src/lib/queue/constants.js`);
    expect(source).toContain(`QUEUE_NAMES.primary`);
    expect(source).toContain(`getBullMQQueueName(QUEUE_NAME)`);
    expect(source).not.toContain("relaydesk-primary");
  });

  it("fails startup clearly when Redis is unreachable", async () => {
    const source = await fs.promises.readFile(resolvedWorkerPath, "utf8");

    expect(source).toContain("Failed to connect to Redis");
    expect(source).toContain("process.exit(1)");
  });
});
