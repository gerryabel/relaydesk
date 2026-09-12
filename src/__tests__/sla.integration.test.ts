import { describe, it, expect, beforeAll, afterAll, beforeEach } from "vitest";
import { PrismaClient } from "@/generated/prisma";
import { PrismaPg } from "@prisma/adapter-pg";
import { getTestDatabaseUrl } from "@/lib/test/db";
import { runSlaEvaluation } from "@/lib/sla/evaluation";
import { handleSlaAtRiskEvent } from "@/lib/queue/handlers/sla";
import type { OutboxEventRecord } from "@/lib/outbox/types";
// No direct imports from duplicate-suppression needed; the evaluator
// exercises the full suppression flow internally.

function createPrismaClient() {
  const connectionString = getTestDatabaseUrl();
  return new PrismaClient({ adapter: new PrismaPg(connectionString) });
}

describe("SLA evaluation integration", () => {
  let prisma: PrismaClient;
  let workspaceId: string;
  let assigneeId: string;

  beforeAll(async () => {
    prisma = createPrismaClient();

    // Create a workspace + user + membership for the integration test.
    // The test database may be empty, so we create our own test data.
    const workspace = await prisma.workspace.create({
      data: { name: "SLA-E2E-Test-Workspace" },
    });

    const userId = `user-${Date.now()}-${Math.random().toString(36).slice(2)}`;
    const user = await prisma.user.create({
      data: {
        id: userId,
        email: `sla-e2e-${Date.now()}@test.local`,
        name: "SLA E2E Test User",
      },
    });

    await prisma.membership.create({
      data: {
        id: `membership-${Date.now()}-${Math.random().toString(36).slice(2)}`,
        userId: user.id,
        workspaceId: workspace.id,
        role: "owner",
      },
    });

    assigneeId = user.id;
    workspaceId = workspace.id;
  });

  afterAll(async () => {
    // Clean up the test workspace and user
    await prisma.workspace.deleteMany({
      where: { id: workspaceId },
    });
    await prisma.user.deleteMany({
      where: { id: assigneeId },
    });
    await prisma.$disconnect();
  });

  beforeEach(async () => {
    // Clean up test data
    // Delete SLA notifications for tickets in this workspace
    const workspaceTickets = await prisma.ticket.findMany({
      where: { workspaceId, title: { startsWith: "SLA-E2E-" } },
      select: { id: true },
    });
    const ticketIds = workspaceTickets.map((t) => t.id);

    await prisma.sentSlaNotification.deleteMany({
      where: { ticketId: { in: ticketIds } },
    });
    await prisma.outboxEvent.deleteMany({
      where: { aggregateType: "Ticket", aggregateId: { in: ticketIds } },
    });
    await prisma.notification.deleteMany({
      where: { workspaceId, type: "SLA_AT_RISK" },
    });
    await prisma.ticket.deleteMany({
      where: { workspaceId, title: { startsWith: "SLA-E2E-" } },
    });
  });

  it("creates SLA_AT_RISK outbox event and suppression record for at-risk ticket", async () => {
    const now = new Date();

    // Create a ticket with response SLA in at-risk state
    // Duration = 10 hours, created 9 hours ago = 90% elapsed = at_risk
    const durationMs = 10 * 60 * 60 * 1000;
    const createdAt = new Date(now.getTime() - 9 * 60 * 60 * 1000);
    const responseDeadline = new Date(createdAt.getTime() + durationMs);

    const ticket = await prisma.ticket.create({
      data: {
        workspaceId,
        title: "SLA-E2E-response-at-risk",
        createdById: assigneeId,
        assignedToId: assigneeId,
        status: "open",
        priority: "medium",
        createdAt,
        responseSlaDeadline: responseDeadline,
      },
    });

    const summary = await runSlaEvaluation(now);

    // Verify at-risk was detected
    expect(summary.atRisk.length).toBeGreaterThanOrEqual(1);
    const atRiskResult = summary.atRisk.find(
      (r) => r.ticketId === ticket.id && r.slaType === "response",
    );
    expect(atRiskResult).toBeDefined();

    // Verify outbox event was created
    const outboxEvent = await prisma.outboxEvent.findFirst({
      where: { aggregateId: ticket.id, eventType: "SLA_AT_RISK" },
    });
    expect(outboxEvent).not.toBeNull();
    expect(outboxEvent?.payload).toMatchObject({
      ticketId: ticket.id,
      slaType: "response",
      workspaceId,
      assignedToId: assigneeId,
    });

    // Verify suppression record was created
    const suppression = await prisma.sentSlaNotification.findUnique({
      where: {
        ticketId_slaType: { ticketId: ticket.id, slaType: "response" },
      },
    });
    expect(suppression).not.toBeNull();
  });

  it("does not create duplicate event within suppression window", async () => {
    const now = new Date();
    const durationMs = 10 * 60 * 60 * 1000;
    const createdAt = new Date(now.getTime() - 9 * 60 * 60 * 1000);
    const responseDeadline = new Date(createdAt.getTime() + durationMs);

    const ticket = await prisma.ticket.create({
      data: {
        workspaceId,
        title: "SLA-E2E-suppression",
        createdById: assigneeId,
        assignedToId: assigneeId,
        status: "open",
        priority: "medium",
        createdAt,
        responseSlaDeadline: responseDeadline,
      },
    });

    // First evaluation
    const summary1 = await runSlaEvaluation(now);
    expect(summary1.atRisk.length).toBeGreaterThanOrEqual(1);

    // Second evaluation within window (1 hour later)
    const later = new Date(now.getTime() + 60 * 60 * 1000);
    const summary2 = await runSlaEvaluation(later);

    // Should be suppressed — no new at-risk result for this ticket
    const duplicateAtRisk = summary2.atRisk.filter(
      (r) => r.ticketId === ticket.id,
    );
    expect(duplicateAtRisk).toHaveLength(0);

    // Only one outbox event should exist
    const events = await prisma.outboxEvent.findMany({
      where: { aggregateId: ticket.id, eventType: "SLA_AT_RISK" },
    });
    expect(events).toHaveLength(1);
  });

  it("creates events after suppression window expires", async () => {
    const now = new Date();
    // Use a long SLA duration so the ticket remains at-risk even after
    // the 25-hour window expires (doesn't cross into breached).
    // Duration = 200h, created 170h ago = 85% elapsed = at_risk.
    // After 25h more: 195/200 = 97.5% = still at_risk.
    const durationMs = 200 * 60 * 60 * 1000;
    const createdAt = new Date(now.getTime() - 170 * 60 * 60 * 1000);
    const responseDeadline = new Date(createdAt.getTime() + durationMs);

    const ticket = await prisma.ticket.create({
      data: {
        workspaceId,
        title: "SLA-E2E-window-expiry",
        createdById: assigneeId,
        assignedToId: assigneeId,
        status: "open",
        priority: "medium",
        createdAt,
        responseSlaDeadline: responseDeadline,
      },
    });

    // First evaluation
    await runSlaEvaluation(now);

    // Second evaluation after window expires (25 hours later)
    const later = new Date(now.getTime() + 25 * 60 * 60 * 1000);
    const summary2 = await runSlaEvaluation(later);

    // Should create new event (window expired)
    const atRiskAfterExpiry = summary2.atRisk.filter(
      (r) => r.ticketId === ticket.id,
    );
    expect(atRiskAfterExpiry.length).toBeGreaterThanOrEqual(1);

    // Two outbox events should exist
    const events = await prisma.outboxEvent.findMany({
      where: { aggregateId: ticket.id, eventType: "SLA_AT_RISK" },
    });
    expect(events).toHaveLength(2);
  });

  it("skips resolved and closed tickets", async () => {
    const now = new Date();
    const durationMs = 10 * 60 * 60 * 1000;
    const createdAt = new Date(now.getTime() - 9 * 60 * 60 * 1000);
    const deadline = new Date(createdAt.getTime() + durationMs);

    // Create resolved ticket
    await prisma.ticket.create({
      data: {
        workspaceId,
        title: "SLA-E2E-resolved",
        createdById: assigneeId,
        assignedToId: assigneeId,
        status: "resolved",
        priority: "medium",
        createdAt,
        responseSlaDeadline: deadline,
      },
    });

    // Create closed ticket
    await prisma.ticket.create({
      data: {
        workspaceId,
        title: "SLA-E2E-closed",
        createdById: assigneeId,
        assignedToId: assigneeId,
        status: "closed",
        priority: "medium",
        createdAt,
        responseSlaDeadline: deadline,
      },
    });

    const summary = await runSlaEvaluation(now);

    // No at-risk events for resolved/closed tickets
    expect(summary.atRisk).toHaveLength(0);
  });

  it("clears suppression when SLA becomes breached", async () => {
    const now = new Date();
    const durationMs = 10 * 60 * 60 * 1000;
    const createdAt = new Date(now.getTime() - 9 * 60 * 60 * 1000);
    const responseDeadline = new Date(createdAt.getTime() + durationMs);

    const ticket = await prisma.ticket.create({
      data: {
        workspaceId,
        title: "SLA-E2E-breached",
        createdById: assigneeId,
        assignedToId: assigneeId,
        status: "open",
        priority: "medium",
        createdAt,
        responseSlaDeadline: responseDeadline,
      },
    });

    // First evaluation: at-risk
    await runSlaEvaluation(now);

    // Verify suppression exists
    let suppression = await prisma.sentSlaNotification.findUnique({
      where: {
        ticketId_slaType: { ticketId: ticket.id, slaType: "response" },
      },
    });
    expect(suppression).not.toBeNull();

    // Update ticket to be breached (deadline in the past)
    const breachedDeadline = new Date(now.getTime() - 1000);
    await prisma.ticket.update({
      where: { id: ticket.id },
      data: {
        createdAt: new Date(now.getTime() - 48 * 60 * 60 * 1000),
        responseSlaDeadline: breachedDeadline,
      },
    });

    // Second evaluation: should clear suppression (breached)
    await runSlaEvaluation(now);

    // Suppression should be cleared
    suppression = await prisma.sentSlaNotification.findUnique({
      where: {
        ticketId_slaType: { ticketId: ticket.id, slaType: "response" },
      },
    });
    expect(suppression).toBeNull();
  });

  describe("handler idempotency", () => {
    it("retry of the same OutboxEvent does not create a duplicate notification", async () => {
      const now = new Date();
      const durationMs = 10 * 60 * 60 * 1000;
      const createdAt = new Date(now.getTime() - 9 * 60 * 60 * 1000);
      const responseDeadline = new Date(createdAt.getTime() + durationMs);

      const ticket = await prisma.ticket.create({
        data: {
          workspaceId,
          title: "SLA-E2E-idempotency-retry",
          createdById: assigneeId,
          assignedToId: assigneeId,
          status: "open",
          priority: "medium",
          createdAt,
          responseSlaDeadline: responseDeadline,
        },
      });

      // Create an outbox event manually to simulate the evaluator output
      const outboxEvent = await prisma.outboxEvent.create({
        data: {
          eventType: "SLA_AT_RISK",
          aggregateType: "Ticket",
          aggregateId: ticket.id,
          payload: {
            ticketId: ticket.id,
            slaType: "response",
            workspaceId,
            assignedToId: assigneeId,
          },
        },
      });

      const eventRecord: OutboxEventRecord = {
        ...outboxEvent,
        payload: outboxEvent.payload as Record<string, unknown>,
      } as OutboxEventRecord;

      // First processing: creates notification
      const result1 = await handleSlaAtRiskEvent(eventRecord);
      expect(result1).toEqual({ status: "success" });

      const notificationsAfterFirst = await prisma.notification.findMany({
        where: { ticketId: ticket.id, type: "SLA_AT_RISK" },
      });
      expect(notificationsAfterFirst).toHaveLength(1);

      // Simulate retry (e.g., crash between notification creation and markOutboxEventProcessed)
      const result2 = await handleSlaAtRiskEvent(eventRecord);
      expect(result2).toEqual({ status: "success" });

      // Should still be exactly one notification
      const notificationsAfterRetry = await prisma.notification.findMany({
        where: { ticketId: ticket.id, type: "SLA_AT_RISK" },
      });
      expect(notificationsAfterRetry).toHaveLength(1);
      expect(notificationsAfterRetry[0].outboxEventId).toBe(outboxEvent.id);
    });

    it("concurrent processing of the same OutboxEvent creates exactly one notification", async () => {
      const now = new Date();
      const durationMs = 10 * 60 * 60 * 1000;
      const createdAt = new Date(now.getTime() - 9 * 60 * 60 * 1000);
      const responseDeadline = new Date(createdAt.getTime() + durationMs);

      const ticket = await prisma.ticket.create({
        data: {
          workspaceId,
          title: "SLA-E2E-idempotency-concurrent",
          createdById: assigneeId,
          assignedToId: assigneeId,
          status: "open",
          priority: "medium",
          createdAt,
          responseSlaDeadline: responseDeadline,
        },
      });

      const outboxEvent = await prisma.outboxEvent.create({
        data: {
          eventType: "SLA_AT_RISK",
          aggregateType: "Ticket",
          aggregateId: ticket.id,
          payload: {
            ticketId: ticket.id,
            slaType: "response",
            workspaceId,
            assignedToId: assigneeId,
          },
        },
      });

      const eventRecord: OutboxEventRecord = {
        ...outboxEvent,
        payload: outboxEvent.payload as Record<string, unknown>,
      } as OutboxEventRecord;

      // Simulate two workers processing the same event concurrently
      const results = await Promise.allSettled([
        handleSlaAtRiskEvent(eventRecord),
        handleSlaAtRiskEvent(eventRecord),
      ]);

      // At least one should succeed, the other should either succeed (P2002 handled) or fail with P2002
      const succeeded = results.filter((r) => r.status === "fulfilled");
      expect(succeeded.length).toBeGreaterThanOrEqual(1);

      // Exactly one notification should exist
      const notifications = await prisma.notification.findMany({
        where: { ticketId: ticket.id, type: "SLA_AT_RISK" },
      });
      expect(notifications).toHaveLength(1);
    });

    it("different OutboxEvent IDs for the same ticket create separate notifications", async () => {
      const now = new Date();
      const durationMs = 10 * 60 * 60 * 1000;
      const createdAt = new Date(now.getTime() - 9 * 60 * 60 * 1000);
      const responseDeadline = new Date(createdAt.getTime() + durationMs);

      const ticket = await prisma.ticket.create({
        data: {
          workspaceId,
          title: "SLA-E2E-idempotency-separate",
          createdById: assigneeId,
          assignedToId: assigneeId,
          status: "open",
          priority: "medium",
          createdAt,
          responseSlaDeadline: responseDeadline,
        },
      });

      // Create two separate outbox events (simulating two evaluations after suppression window)
      const eventA = await prisma.outboxEvent.create({
        data: {
          eventType: "SLA_AT_RISK",
          aggregateType: "Ticket",
          aggregateId: ticket.id,
          payload: {
            ticketId: ticket.id,
            slaType: "response",
            workspaceId,
            assignedToId: assigneeId,
          },
        },
      });

      const eventB = await prisma.outboxEvent.create({
        data: {
          eventType: "SLA_AT_RISK",
          aggregateType: "Ticket",
          aggregateId: ticket.id,
          payload: {
            ticketId: ticket.id,
            slaType: "response",
            workspaceId,
            assignedToId: assigneeId,
          },
        },
      });

      const recordA: OutboxEventRecord = {
        ...eventA,
        payload: eventA.payload as Record<string, unknown>,
      } as OutboxEventRecord;

      const recordB: OutboxEventRecord = {
        ...eventB,
        payload: eventB.payload as Record<string, unknown>,
      } as OutboxEventRecord;

      await handleSlaAtRiskEvent(recordA);
      await handleSlaAtRiskEvent(recordB);

      // Two separate notifications should exist (different outboxEventId)
      const notifications = await prisma.notification.findMany({
        where: { ticketId: ticket.id, type: "SLA_AT_RISK" },
      });
      expect(notifications).toHaveLength(2);

      const outboxEventIds = notifications.map((n) => n.outboxEventId).sort();
      expect(outboxEventIds).toEqual([eventA.id, eventB.id].sort());
    });
  });
});
