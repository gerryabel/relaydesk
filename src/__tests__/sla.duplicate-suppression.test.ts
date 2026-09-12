import { describe, it, expect, beforeEach, vi } from "vitest";
import type { Prisma, PrismaClient } from "@/generated/prisma";
import {
  claimNotificationSlot,
  releaseNotificationSlot,
  clearNotificationSlots,
  clearNotificationSlotForType,
  DEFAULT_SUPPRESSION_WINDOW_MS,
} from "@/lib/sla/duplicate-suppression";

type SuppressionRow = { ticketId: string; slaType: string; sentAt: Date };

function createMockPrisma() {
  const rows: SuppressionRow[] = [];

  const findUnique = vi.fn(async ({ where }: { where: { ticketId?: string; slaType?: string } }) => {
    const found = rows.find(
      (r) => r.ticketId === where.ticketId && r.slaType === where.slaType,
    );
    return found ?? null;
  });

  const create = vi.fn(async ({ data }: { data: SuppressionRow }) => {
    const existing = rows.find(
      (r) => r.ticketId === data.ticketId && r.slaType === data.slaType,
    );
    if (existing) {
      const error = new Error("Unique constraint failed") as Error & { code: string };
      error.code = "P2002";
      throw error;
    }
    const row: SuppressionRow = { ...data };
    rows.push(row);
    return row;
  });

  const updateMany = vi.fn(async ({ where, data }: { where: Prisma.SentSlaNotificationWhereInput; data: Prisma.SentSlaNotificationUpdateManyMutationInput }) => {
    const windowStart = where.sentAt && typeof where.sentAt === "object" && "lte" in where.sentAt
      ? (where.sentAt as { lte: Date }).lte
      : undefined;
    const matching = rows.filter(
      (r) =>
        r.ticketId === where.ticketId &&
        r.slaType === where.slaType &&
        (windowStart ? r.sentAt.getTime() <= windowStart.getTime() : true),
    );
    for (const row of matching) {
      row.sentAt = data.sentAt as Date;
    }
    return { count: matching.length };
  });

  const deleteMany = vi.fn(async ({ where }: { where: Prisma.SentSlaNotificationWhereInput }) => {
    let count = 0;
    for (let i = rows.length - 1; i >= 0; i--) {
      const r = rows[i];
      const matchesTicket = !where.ticketId || r.ticketId === where.ticketId;
      const matchesType = !where.slaType || r.slaType === where.slaType;
      const sentAtMatch = where.sentAt && typeof where.sentAt === "object" && "equals" in where.sentAt
        ? r.sentAt.getTime() === (where.sentAt as { equals: Date }).equals.getTime()
        : true;
      if (matchesTicket && matchesType && sentAtMatch) {
        rows.splice(i, 1);
        count += 1;
      }
    }
    return { count };
  });

  const mockPrisma = {
    sentSlaNotification: {
      findUnique,
      create,
      updateMany,
      deleteMany,
    },
  } as unknown as PrismaClient;

  return { mockPrisma, rows, findUnique, create, updateMany, deleteMany };
}

describe("duplicate suppression", () => {
  describe("claimNotificationSlot", () => {
    let ctx: ReturnType<typeof createMockPrisma>;

    beforeEach(() => {
      ctx = createMockPrisma();
    });

    it("first claim succeeds and creates a row", async () => {
      const now = new Date("2026-09-12T00:00:00Z");
      const result = await claimNotificationSlot(
        ctx.mockPrisma,
        "ticket-1",
        "response",
        now,
      );
      expect(result).toEqual({ claimed: true, isNew: true });
      expect(ctx.rows).toHaveLength(1);
      expect(ctx.rows[0]).toMatchObject({
        ticketId: "ticket-1",
        slaType: "response",
        sentAt: now,
      });
    });

    it("duplicate claim within window is suppressed", async () => {
      const now = new Date("2026-09-12T00:00:00Z");
      await claimNotificationSlot(ctx.mockPrisma, "ticket-1", "response", now);

      const later = new Date(now.getTime() + 60 * 60 * 1000); // 1 hour later
      const result = await claimNotificationSlot(
        ctx.mockPrisma,
        "ticket-1",
        "response",
        later,
      );
      expect(result).toEqual({ claimed: false, isNew: false });
      expect(ctx.rows).toHaveLength(1);
    });

    it("expired suppression window can be reclaimed", async () => {
      const now = new Date("2026-09-12T00:00:00Z");
      await claimNotificationSlot(ctx.mockPrisma, "ticket-1", "response", now);

      // 25 hours later — window expired (24h default)
      const later = new Date(now.getTime() + 25 * 60 * 60 * 1000);
      const result = await claimNotificationSlot(
        ctx.mockPrisma,
        "ticket-1",
        "response",
        later,
      );
      expect(result).toEqual({ claimed: true, isNew: false });
      expect(ctx.rows).toHaveLength(1);
      expect(ctx.rows[0].sentAt).toEqual(later);
    });

    it("uses conditional updateMany for the compare-and-swap", async () => {
      const now = new Date("2026-09-12T00:00:00Z");
      await claimNotificationSlot(ctx.mockPrisma, "ticket-1", "response", now);

      const later = new Date(now.getTime() + 25 * 60 * 60 * 1000);
      await claimNotificationSlot(ctx.mockPrisma, "ticket-1", "response", later);

      // The second claim should have gone through updateMany (not create)
      expect(ctx.updateMany).toHaveBeenCalled();
    });

    it("handles concurrent first claims — only one wins", async () => {
      const now = new Date("2026-09-12T00:00:00Z");

      // Simulate two concurrent claims: create is called twice,
      // but only the first succeeds. The second gets P2002.
      const results = await Promise.all([
        claimNotificationSlot(ctx.mockPrisma, "ticket-1", "response", now),
        claimNotificationSlot(ctx.mockPrisma, "ticket-1", "response", now),
      ]);

      const claimed = results.filter((r) => r.claimed);
      const suppressed = results.filter((r) => !r.claimed);
      expect(claimed).toHaveLength(1);
      expect(suppressed).toHaveLength(1);
      expect(ctx.rows).toHaveLength(1);
    });

    it("tracks response and resolution independently", async () => {
      const now = new Date("2026-09-12T00:00:00Z");

      const responseResult = await claimNotificationSlot(
        ctx.mockPrisma,
        "ticket-1",
        "response",
        now,
      );
      const resolutionResult = await claimNotificationSlot(
        ctx.mockPrisma,
        "ticket-1",
        "resolution",
        now,
      );

      expect(responseResult.claimed).toBe(true);
      expect(resolutionResult.claimed).toBe(true);
      expect(ctx.rows).toHaveLength(2);
    });
  });

  describe("releaseNotificationSlot", () => {
    it("releases a specific slot by ticketId + slaType + sentAt", async () => {
      const ctx = createMockPrisma();
      const now = new Date("2026-09-12T00:00:00Z");
      await claimNotificationSlot(ctx.mockPrisma, "ticket-1", "response", now);
      expect(ctx.rows).toHaveLength(1);

      await releaseNotificationSlot(
        ctx.mockPrisma,
        "ticket-1",
        "response",
        now,
      );
      expect(ctx.rows).toHaveLength(0);
    });

    it("does not release other slaType slots", async () => {
      const ctx = createMockPrisma();
      const now = new Date("2026-09-12T00:00:00Z");
      await claimNotificationSlot(ctx.mockPrisma, "ticket-1", "response", now);
      await claimNotificationSlot(ctx.mockPrisma, "ticket-1", "resolution", now);
      expect(ctx.rows).toHaveLength(2);

      await releaseNotificationSlot(
        ctx.mockPrisma,
        "ticket-1",
        "response",
        now,
      );
      expect(ctx.rows).toHaveLength(1);
      expect(ctx.rows[0].slaType).toBe("resolution");
    });
  });

  describe("clearNotificationSlots", () => {
    it("clears all slots for a ticket", async () => {
      const ctx = createMockPrisma();
      const now = new Date("2026-09-12T00:00:00Z");
      await claimNotificationSlot(ctx.mockPrisma, "ticket-1", "response", now);
      await claimNotificationSlot(ctx.mockPrisma, "ticket-1", "resolution", now);
      await claimNotificationSlot(ctx.mockPrisma, "ticket-2", "response", now);
      expect(ctx.rows).toHaveLength(3);

      await clearNotificationSlots(ctx.mockPrisma, "ticket-1");
      expect(ctx.rows).toHaveLength(1);
      expect(ctx.rows[0].ticketId).toBe("ticket-2");
    });
  });

  describe("clearNotificationSlotForType", () => {
    it("clears only the specified slaType for a ticket", async () => {
      const ctx = createMockPrisma();
      const now = new Date("2026-09-12T00:00:00Z");
      await claimNotificationSlot(ctx.mockPrisma, "ticket-1", "response", now);
      await claimNotificationSlot(ctx.mockPrisma, "ticket-1", "resolution", now);
      expect(ctx.rows).toHaveLength(2);

      await clearNotificationSlotForType(ctx.mockPrisma, "ticket-1", "response");
      expect(ctx.rows).toHaveLength(1);
      expect(ctx.rows[0].slaType).toBe("resolution");
    });
  });

  describe("DEFAULT_SUPPRESSION_WINDOW_MS", () => {
    it("equals 24 hours in milliseconds", () => {
      expect(DEFAULT_SUPPRESSION_WINDOW_MS).toBe(24 * 60 * 60 * 1000);
    });
  });
});
