import { describe, it, expect } from "vitest";
import { fileURLToPath } from "node:url";
import path from "node:path";
import fs from "node:fs";

const infraPath = path.resolve(fileURLToPath(new URL("../../scripts/infra-check.mjs", import.meta.url)));

describe("infrastructure check", () => {
  it("requires REDIS_URL explicitly instead of falling back to a hardcoded localhost default", async () => {
    const source = await fs.promises.readFile(infraPath, "utf8");

    expect(source).toContain("process.env.REDIS_URL");
    expect(source).not.toContain("redis://localhost:6379");
  });

  it("exits with a non-zero status on failure instead of only setting exitCode", async () => {
    const source = await fs.promises.readFile(infraPath, "utf8");

    expect(source).toContain("process.exit(1)");
    expect(source).not.toContain("process.exitCode = 1");
  });
});
