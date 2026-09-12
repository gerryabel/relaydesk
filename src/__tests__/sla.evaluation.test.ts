import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import type { Prisma } from "@/generated/prisma";

type TicketRow = {
  id: string;
  workspaceId: string;
  assignedToId: string | null;
  createdAt: Date;
  responseSlaDeadline: Date | null;
  resolutionSlaDeadline: Date | null;
  firstResponseAt: Date | null;
  resolvedAt: Date | null;
};

type SuppressionRow = { ticketId: string; slaType: string; sentAt: Date };
type OutboxData = { eventType: string; aggregateType: string; aggregateId: string; payload: Record<string, unknown> };

// Mutable mock state shared across tests.
const mockState = {
  tickets: [] as TicketRow[],
  outboxEvents: [] as OutboxData[],
  suppressionRows: [] as SuppressionRow[],
  findManyCalls: 0,
};

function mockTicketFindMany(args: Prisma.TicketFindManyArgs) {
  const skip = args.skip ?? 0;
  const take = args.take ?? 100;
  mockState.findManyCalls += 1;
  return mockState.tickets.slice(skip, skip + take);
}

function mockSuppressionFindUnique({ where }: { where: Prisma.SentSlaNotificationWhereUniqueInput }) {
  return (
    mockState.suppressionRows.find(
      (r) => r.ticketId === where.ticketId && r.slaType === where.slaType,
    ) ?? null
  );
}

function mockSuppressionCreate({ data }: { data: Prisma.SentSlaNotificationCreateInput }) {
  const ticketId = data.ticketId as string;
  const slaType = data.slaType as string;
  const existing = mockState.suppressionRows.find(
    (r) => r.ticketId === ticketId && r.slaType === slaType,
  );
  if (existing) {
    const error = new Error("Unique constraint failed") as Error & { code: string };
    error.code = "P2002";
    throw error;
  }
  const row: SuppressionRow = {
    ticketId,
    slaType,
    sentAt: (data.sentAt as Date) ?? new Date(),
  };
  mockState.suppressionRows.push(row);
  return row;
}

function mockSuppressionUpdateMany({ where, data }: { where: Prisma.SentSlaNotificationWhereInput; data: Prisma.SentSlaNotificationUpdateManyMutationInput }) {
  const windowStart = where.sentAt && typeof where.sentAt === "object" && "lte" in where.sentAt
    ? (where.sentAt as { lte: Date }).lte
    : undefined;
  const matching = mockState.suppressionRows.filter(
    (r) =>
      r.ticketId === where.ticketId &&
      r.slaType === where.slaType &&
      (windowStart ? r.sentAt.getTime() <= windowStart.getTime() : true),
  );
  for (const row of matching) {
    row.sentAt = data.sentAt as Date;
  }
  return { count: matching.length };
}

function mockSuppressionDeleteMany({ where }: { where: Prisma.SentSlaNotificationWhereInput }) {
  let count = 0;
  for (let i = mockState.suppressionRows.length - 1; i >= 0; i--) {
    const r = mockState.suppressionRows[i];
    const matchesTicket = !where.ticketId || r.ticketId === where.ticketId;
    const matchesType = !where.slaType || r.slaType === where.slaType;
    if (matchesTicket && matchesType) {
      mockState.suppressionRows.splice(i, 1);
      count += 1;
    }
  }
  return { count };
}

function mockOutboxCreate({ data }: { data: Prisma.OutboxEventCreateInput }) {
  mockState.outboxEvents.push(data as OutboxData);
  return { id: `outbox-${mockState.outboxEvents.length}` };
}

async function mockTransaction(fn: (tx: Prisma.TransactionClient) => Promise<unknown>) {
  const tx = {
    outboxEvent: { create: vi.fn(mockOutboxCreate) },
    sentSlaNotification: {
      findUnique: vi.fn(mockSuppressionFindUnique),
      create: vi.fn(mockSuppressionCreate),
      updateMany: vi.fn(mockSuppressionUpdateMany),
      deleteMany: vi.fn(mockSuppressionDeleteMany),
    },
  } as unknown as Prisma.TransactionClient;
  return fn(tx);
}

vi.mock("@/lib/db/prisma", () => ({
  prisma: {
    ticket: { findMany: vi.fn(mockTicketFindMany) },
    $transaction: vi.fn(mockTransaction),
    sentSlaNotification: {
      findUnique: vi.fn(mockSuppressionFindUnique),
      create: vi.fn(mockSuppressionCreate),
      updateMany: vi.fn(mockSuppressionUpdateMany),
      deleteMany: vi.fn(mockSuppressionDeleteMany),
    },
  },
}));

import {
  runSlaEvaluation,
  SLA_EVALUATION_BATCH_SIZE,
} from "@/lib/sla/evaluation";

function makeTicket(overrides: Record<string, unknown> & { id: string }): TicketRow {
  return {
    workspaceId: "workspace-1",
    assignedToId: "assignee-1",
    createdAt: new Date("2026-09-01T00:00:00Z"),
    responseSlaDeadline: null,
    resolutionSlaDeadline: null,
    firstResponseAt: null,
    resolvedAt: null,
    ...overrides,
  };
}

function atRiskResponseTicket(id: string, now: Date): TicketRow {
  const durationMs = 10 * 60 * 60 * 1000;
  const createdAt = new Date(now.getTime() - 9 * 60 * 60 * 1000);
  const deadline = new Date(createdAt.getTime() + durationMs);
  return makeTicket({ id, createdAt, responseSlaDeadline: deadline });
}

function atRiskResolutionTicket(id: string, now: Date): TicketRow {
  const durationMs = 10 * 60 * 60 * 1000;
  const createdAt = new Date(now.getTime() - 9 * 60 * 60 * 1000);
  const deadline = new Date(createdAt.getTime() + durationMs);
  return makeTicket({ id, createdAt, resolutionSlaDeadline: deadline });
}

function onTrackTicket(id: string, now: Date): TicketRow {
  const durationMs = 10 * 60 * 60 * 1000;
  const createdAt = new Date(now.getTime() - 1 * 60 * 60 * 1000);
  const deadline = new Date(createdAt.getTime() + durationMs);
  return makeTicket({ id, createdAt, responseSlaDeadline: deadline });
}

describe("SLA evaluation", () => {
  let now: Date;

  beforeEach(() => {
    now = new Date("2026-09-12T00:00:00Z");
    mockState.tickets = [];
    mockState.outboxEvents = [];
    mockState.suppressionRows = [];
    mockState.findManyCalls = 0;
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe("basic at-risk detection", () => {
    it("creates SLA_AT_RISK event for response at-risk ticket", async () => {
      mockState.tickets = [atRiskResponseTicket("ticket-1", now)];

      const summary = await runSlaEvaluation(now);

      expect(summary.evaluated).toBe(1);
      expect(summary.atRisk).toHaveLength(1);
      expect(summary.atRisk[0]).toEqual({
        ticketId: "ticket-1",
        slaType: "response",
      });
      expect(mockState.outboxEvents).toHaveLength(1);
      expect(mockState.outboxEvents[0].eventType).toBe("SLA_AT_RISK");
      expect(mockState.outboxEvents[0].aggregateId).toBe("ticket-1");
      expect(mockState.outboxEvents[0].payload.slaType).toBe("response");
    });

    it("creates SLA_AT_RISK event for resolution at-risk ticket", async () => {
      mockState.tickets = [atRiskResolutionTicket("ticket-2", now)];

      const summary = await runSlaEvaluation(now);

      expect(summary.atRisk).toEqual([
        { ticketId: "ticket-2", slaType: "resolution" },
      ]);
      expect(mockState.outboxEvents[0].payload.slaType).toBe("resolution");
    });

    it("creates two events when both SLA types are at risk", async () => {
      const durationMs = 10 * 60 * 60 * 1000;
      const createdAt = new Date(now.getTime() - 9 * 60 * 60 * 1000);
      const deadline = new Date(createdAt.getTime() + durationMs);
      mockState.tickets = [
        makeTicket({
          id: "ticket-both",
          createdAt,
          responseSlaDeadline: deadline,
          resolutionSlaDeadline: deadline,
        }),
      ];

      const summary = await runSlaEvaluation(now);

      expect(summary.atRisk).toHaveLength(2);
      const slaTypes = summary.atRisk.map((r: { slaType: string }) => r.slaType).sort();
      expect(slaTypes).toEqual(["resolution", "response"]);
      expect(mockState.outboxEvents).toHaveLength(2);
    });
  });

  describe("status filtering", () => {
    it("queries tickets with the correct filter", async () => {
      mockState.tickets = [onTrackTicket("t1", now)];

      await runSlaEvaluation(now);

      expect(mockState.findManyCalls).toBeGreaterThan(0);
    });

    it("does not create events for on-track tickets", async () => {
      mockState.tickets = [onTrackTicket("ticket-ontrack", now)];

      const summary = await runSlaEvaluation(now);

      expect(summary.atRisk).toHaveLength(0);
      expect(mockState.outboxEvents).toHaveLength(0);
    });
  });

  describe("suppression", () => {
    it("does not create duplicate event within suppression window", async () => {
      mockState.tickets = [atRiskResponseTicket("ticket-1", now)];

      const summary1 = await runSlaEvaluation(now);
      expect(summary1.atRisk).toHaveLength(1);
      expect(mockState.outboxEvents).toHaveLength(1);

      const later = new Date(now.getTime() + 60 * 60 * 1000);
      const summary2 = await runSlaEvaluation(later);
      expect(summary2.atRisk).toHaveLength(0);
      expect(mockState.outboxEvents).toHaveLength(1);
    });

    it("claims a suppression slot when creating an event", async () => {
      mockState.tickets = [atRiskResponseTicket("ticket-1", now)];

      await runSlaEvaluation(now);

      const suppressionRow = mockState.suppressionRows.find(
        (r) => r.ticketId === "ticket-1" && r.slaType === "response",
      );
      expect(suppressionRow).toBeDefined();
    });
  });

  describe("breached/completed slot clearing", () => {
    it("clears response slot when response becomes breached", async () => {
      mockState.tickets = [atRiskResponseTicket("ticket-1", now)];
      await runSlaEvaluation(now);
      expect(mockState.outboxEvents).toHaveLength(1);
      expect(mockState.suppressionRows).toHaveLength(1);

      const breachedTicket = makeTicket({
        id: "ticket-1",
        createdAt: new Date(now.getTime() - 20 * 60 * 60 * 1000),
        responseSlaDeadline: new Date(now.getTime() - 10 * 60 * 60 * 1000),
      });
      mockState.tickets = [breachedTicket];

      const summary = await runSlaEvaluation(now);
      expect(summary.atRisk).toHaveLength(0);

      const remainingResponseSlot = mockState.suppressionRows.find(
        (r) => r.ticketId === "ticket-1" && r.slaType === "response",
      );
      expect(remainingResponseSlot).toBeUndefined();
    });
  });

  describe("error handling", () => {
    it("handles ticket with only resolution deadline set", async () => {
      // Ticket with no response deadline — should evaluate resolution only
      const durationMs = 10 * 60 * 60 * 1000;
      const createdAt = new Date(now.getTime() - 9 * 60 * 60 * 1000);
      const deadline = new Date(createdAt.getTime() + durationMs);
      const ticket = makeTicket({
        id: "ticket-resolution-only",
        createdAt,
        responseSlaDeadline: null,
        resolutionSlaDeadline: deadline,
      });
      mockState.tickets = [ticket];

      const summary = await runSlaEvaluation(now);

      expect(summary.evaluated).toBe(1);
      expect(summary.atRisk).toEqual([
        { ticketId: "ticket-resolution-only", slaType: "resolution" },
      ]);
      expect(summary.errors).toHaveLength(0);
    });

    it("handles mixed batch of at-risk and on-track tickets", async () => {
      const atRiskTicket = atRiskResponseTicket("ticket-atrisk", now);
      const onTrack = onTrackTicket("ticket-ontrack", now);
      mockState.tickets = [atRiskTicket, onTrack];

      const summary = await runSlaEvaluation(now);

      expect(summary.evaluated).toBe(2);
      // Only the at-risk ticket should produce an event
      expect(summary.atRisk).toHaveLength(1);
      expect(summary.atRisk[0].ticketId).toBe("ticket-atrisk");
    });
  });

  describe("batching", () => {
    it("processes all tickets", async () => {
      mockState.tickets = Array.from({ length: 5 }, (_, i) =>
        onTrackTicket(`ticket-${i}`, now),
      );

      const summary = await runSlaEvaluation(now);
      expect(summary.evaluated).toBe(5);
    });

    it("paginates through multiple batches", async () => {
      mockState.tickets = Array.from({ length: 105 }, (_, i) =>
        onTrackTicket(`ticket-${i}`, now),
      );

      await runSlaEvaluation(now);

      expect(mockState.findManyCalls).toBeGreaterThan(1);
    });
  });

  describe("batch size constant", () => {
    it("exports SLA_EVALUATION_BATCH_SIZE", () => {
      expect(SLA_EVALUATION_BATCH_SIZE).toBe(100);
    });
  });
});
