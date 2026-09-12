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
};

const mockNotifications: NotificationRow[] = [];

vi.mock("@/lib/db/prisma", () => {
  const mockPrisma = {
    membership: {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      findFirst: vi.fn(async () => null) as any,
    },
    ticket: {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      findFirst: vi.fn(async () => null) as any,
    },
    notification: {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      create: vi.fn(async ({ data }: { data: Omit<NotificationRow, "id"> }) => {
        const created: NotificationRow = { id: `notif-${mockNotifications.length + 1}`, ...data };
        mockNotifications.push(created);
        return created;
      }) as any,
    },
  };

  return { prisma: mockPrisma };
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
});
