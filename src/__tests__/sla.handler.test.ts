import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { handleSlaAtRiskEvent } from "@/lib/queue/handlers/sla";
import { PermanentError } from "@/lib/queue/errors";
import type { OutboxEventRecord } from "@/lib/outbox/types";

type NotificationRow = {
  id: string;
  userId: string;
  workspaceId: string;
  ticketId: string;
  type: string;
  title: string;
  body: string;
  outboxEventId?: string;
};

const mockNotifications: NotificationRow[] = [];

vi.mock("@/lib/db/prisma", () => {
  const mockPrisma = {
    membership: {
      findFirst: vi.fn(async () => null),
    },
    ticket: {
      findFirst: vi.fn(async () => null),
    },
    notification: {
      create: vi.fn(async ({ data }: { data: Omit<NotificationRow, "id"> }) => {
        const created: NotificationRow = { id: `notif-${mockNotifications.length + 1}`, ...data };
        mockNotifications.push(created);
        return created;
      }),
    },
  };

  return { prisma: mockPrisma as unknown as typeof import("@/generated/prisma").PrismaClient };
});

function makeEvent(overrides: Partial<OutboxEventRecord> & { payload?: Record<string, unknown> } = {}): OutboxEventRecord {
  return {
    id: "outbox-1",
    eventType: "SLA_AT_RISK",
    aggregateType: "Ticket",
    aggregateId: "ticket-1",
    payload: {
      ticketId: "ticket-1",
      slaType: "response",
      workspaceId: "workspace-1",
      assignedToId: "assignee-1",
    },
    createdAt: new Date(),
    processedAt: null,
    completedAt: null,
    failedAt: null,
    attempts: 0,
    lastError: null,
    ...overrides,
  } as OutboxEventRecord;
}

describe("SLA_AT_RISK handler", () => {
  let findMembership: ReturnType<typeof vi.fn>;
  let findTicket: ReturnType<typeof vi.fn>;
  let createNotification: ReturnType<typeof vi.fn>;

  beforeEach(async () => {
    mockNotifications.length = 0;
    const prisma = (await import("@/lib/db/prisma")).prisma as unknown as {
      membership: { findFirst: ReturnType<typeof vi.fn> };
      ticket: { findFirst: ReturnType<typeof vi.fn> };
      notification: { create: ReturnType<typeof vi.fn> };
    };
    findMembership = prisma.membership.findFirst;
    findTicket = prisma.ticket.findFirst;
    createNotification = prisma.notification.create;
    findMembership.mockReset();
    findTicket.mockReset();
    createNotification.mockClear();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("creates an in-app notification for the assignee", async () => {
    findMembership.mockResolvedValue({ id: "membership-1" });
    findTicket.mockResolvedValue({ id: "ticket-1" });

    const event = makeEvent();
    const result = await handleSlaAtRiskEvent(event);

    expect(result).toEqual({ status: "success" });
    expect(createNotification).toHaveBeenCalledTimes(1);
    expect(createNotification).toHaveBeenCalledWith({
      data: expect.objectContaining({
        userId: "assignee-1",
        workspaceId: "workspace-1",
        ticketId: "ticket-1",
        type: "SLA_AT_RISK",
        title: "SLA at risk",
        body: expect.stringContaining("ticket-1"),
      }),
    });
  });

  it("includes the SLA type in the notification body", async () => {
    findMembership.mockResolvedValue({ id: "membership-1" });
    findTicket.mockResolvedValue({ id: "ticket-1" });

    const event = makeEvent({
      payload: {
        ticketId: "ticket-1",
        slaType: "resolution",
        workspaceId: "workspace-1",
        assignedToId: "assignee-1",
      },
    });

    await handleSlaAtRiskEvent(event);

    const created = mockNotifications[0];
    expect(created.body).toContain("resolution");
  });

  it("verifies assignee workspace membership", async () => {
    findMembership.mockResolvedValue(null);

    const event = makeEvent();

    await expect(handleSlaAtRiskEvent(event)).rejects.toThrow(PermanentError);
    expect(createNotification).not.toHaveBeenCalled();
  });

  it("skips notification for unassigned tickets", async () => {
    const event = makeEvent({
      payload: {
        ticketId: "ticket-1",
        slaType: "response",
        workspaceId: "workspace-1",
        assignedToId: null,
      },
    });

    const result = await handleSlaAtRiskEvent(event);

    expect(result).toEqual({ status: "success" });
    expect(findMembership).not.toHaveBeenCalled();
    expect(createNotification).not.toHaveBeenCalled();
  });

  it("throws PermanentError when ticket no longer exists", async () => {
    findMembership.mockResolvedValue({ id: "membership-1" });
    findTicket.mockResolvedValue(null);

    const event = makeEvent();

    await expect(handleSlaAtRiskEvent(event)).rejects.toThrow(PermanentError);
    expect(createNotification).not.toHaveBeenCalled();
  });

  it("does NOT create a recursive email outbox event", async () => {
    findMembership.mockResolvedValue({ id: "membership-1" });
    findTicket.mockResolvedValue({ id: "ticket-1" });

    const event = makeEvent();
    await handleSlaAtRiskEvent(event);

    expect(mockNotifications).toHaveLength(1);
    expect(mockNotifications[0].type).toBe("SLA_AT_RISK");
  });

  it("does NOT use getCurrentMembership or session context", async () => {
    findMembership.mockResolvedValue({ id: "membership-1" });
    findTicket.mockResolvedValue({ id: "ticket-1" });

    const event = makeEvent();
    await handleSlaAtRiskEvent(event);

    expect(findMembership).toHaveBeenCalledWith({
      where: { userId: "assignee-1", workspaceId: "workspace-1" },
      select: { id: true },
    });
  });

  it("throws PermanentError for invalid payload", async () => {
    const event = makeEvent({ payload: { invalid: "data" } });

    await expect(handleSlaAtRiskEvent(event)).rejects.toThrow(PermanentError);
  });

  describe("idempotency", () => {
    it("creates exactly one notification on first processing", async () => {
      findMembership.mockResolvedValue({ id: "membership-1" });
      findTicket.mockResolvedValue({ id: "ticket-1" });

      const event = makeEvent();
      await handleSlaAtRiskEvent(event);

      expect(mockNotifications).toHaveLength(1);
      expect(mockNotifications[0].outboxEventId).toBe("outbox-1");
    });

    it("does not create a duplicate notification when the same OutboxEvent is processed twice", async () => {
      findMembership.mockResolvedValue({ id: "membership-1" });
      findTicket.mockResolvedValue({ id: "ticket-1" });

      // Track which outboxEventIds have been seen to simulate P2002
      const seenOutboxEvents = new Set<string>();
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const mockImpl = async ({ data }: { data: any }) => {
        if (data.outboxEventId && seenOutboxEvents.has(data.outboxEventId)) {
          const error = new Error("Unique constraint failed") as Error & { code: string };
          error.code = "P2002";
          throw error;
        }
        if (data.outboxEventId) {
          seenOutboxEvents.add(data.outboxEventId);
        }
        const created: NotificationRow = {
          id: `notif-${mockNotifications.length + 1}`,
          userId: data.userId,
          workspaceId: data.workspaceId,
          ticketId: data.ticketId,
          type: data.type,
          title: data.title,
          body: data.body,
          outboxEventId: data.outboxEventId,
        };
        mockNotifications.push(created);
        return created;
      };
      createNotification.mockImplementation(mockImpl);

      const event = makeEvent();

      // First processing: creates notification
      const result1 = await handleSlaAtRiskEvent(event);
      expect(result1).toEqual({ status: "success" });
      expect(mockNotifications).toHaveLength(1);

      // Second processing (simulated retry): should NOT create another notification
      const result2 = await handleSlaAtRiskEvent(event);
      expect(result2).toEqual({ status: "success" });
      expect(mockNotifications).toHaveLength(1);
    });

    it("allows different OutboxEvent IDs to create separate notifications", async () => {
      findMembership.mockResolvedValue({ id: "membership-1" });
      findTicket.mockResolvedValue({ id: "ticket-1" });

      const eventA = makeEvent({ id: "outbox-A" });
      const eventB = makeEvent({ id: "outbox-B" });

      await handleSlaAtRiskEvent(eventA);
      await handleSlaAtRiskEvent(eventB);

      expect(mockNotifications).toHaveLength(2);
      expect(mockNotifications[0].outboxEventId).toBe("outbox-A");
      expect(mockNotifications[1].outboxEventId).toBe("outbox-B");
    });

    it("rethrows non-unique-constraint errors (temporary DB failure remains retryable)", async () => {
      findMembership.mockResolvedValue({ id: "membership-1" });
      findTicket.mockResolvedValue({ id: "ticket-1" });

      createNotification.mockRejectedValueOnce(new Error("Connection reset"));

      const event = makeEvent();

      await expect(handleSlaAtRiskEvent(event)).rejects.toThrow("Connection reset");
      expect(mockNotifications).toHaveLength(0);
    });

    it("includes outboxEventId in the notification data", async () => {
      findMembership.mockResolvedValue({ id: "membership-1" });
      findTicket.mockResolvedValue({ id: "ticket-1" });

      const event = makeEvent({ id: "outbox-specific-id" });
      await handleSlaAtRiskEvent(event);

      expect(createNotification).toHaveBeenCalledWith({
        data: expect.objectContaining({
          outboxEventId: "outbox-specific-id",
        }),
      });
    });
  });
});
