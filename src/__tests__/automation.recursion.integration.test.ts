import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { PrismaClient } from '@/generated/prisma';
import { PrismaPg } from '@prisma/adapter-pg';
import { getTestDatabaseUrl } from '@/lib/test/db';
import { shouldEvaluateEvent } from '@/lib/automation/evaluator';

/**
 * Integration test for automation recursion prevention.
 *
 * Verifies that the evaluator skips events whose automationContext carries
 * causedByAutomation = true — the flag that automation action handlers set
 * on the downstream AUTOMATION_EVALUATION events they emit.
 */

function createPrismaClient() {
  const connectionString = getTestDatabaseUrl();
  const adapter = new PrismaPg(connectionString);
  return new PrismaClient({ adapter });
}

describe('automation recursion prevention', () => {
  let prisma: PrismaClient;
  const createdWorkspaceIds: string[] = [];
  const createdEventIds: string[] = [];

  beforeAll(() => {
    prisma = createPrismaClient();
  });

  afterAll(async () => {
    // Clean up all data created by this test file at the very end.
    await prisma.outboxEvent.deleteMany({ where: { id: { in: createdEventIds } } });
    await prisma.workspace.deleteMany({ where: { id: { in: createdWorkspaceIds } } });
    await prisma.$disconnect();
  });

  it('shouldEvaluateEvent rejects events with causedByAutomation=true', () => {
    expect(shouldEvaluateEvent({ causedByAutomation: true })).toBe(false);
  });

  it('shouldEvaluateEvent accepts events with causedByAutomation=false', () => {
    expect(shouldEvaluateEvent({ causedByAutomation: false })).toBe(true);
  });

  it('rejects a real outbox event flagged as automation-originated', async () => {
    // Simulate the payload an automation action handler would emit.
    // We create the event in a transaction to ensure it's durable before
    // any concurrent test file's afterAll cleanup runs.
    const eventId = `evt-recursion-${Date.now()}-${Math.random().toString(16).slice(2, 10)}`;
    const created = await prisma.$transaction(async (tx) => {
      return tx.outboxEvent.create({
        data: {
          id: eventId,
          eventType: 'AUTOMATION_EVALUATION',
          aggregateType: 'Ticket',
          aggregateId: 'ticket-dummy',
          payload: {
            triggerType: 'ticket.assigned',
            triggerPayload: { assigneeId: 'user-1' },
            automationContext: {
              causedByAutomation: true,
              ruleId: 'rule-1',
              executionId: 'exec-1',
              actionIndex: 0,
              actorId: null,
            },
            workspaceId: 'workspace-dummy',
            ticketId: 'ticket-dummy',
            actorId: null,
          },
        },
      });
    });
    createdEventIds.push(created.id);

    const fetched = await prisma.outboxEvent.findUnique({ where: { id: created.id } });
    expect(fetched).not.toBeNull();

    const payload = fetched!.payload as { automationContext: { causedByAutomation: boolean } };
    expect(shouldEvaluateEvent(payload.automationContext)).toBe(false);
  });

  it('accepts a real outbox event flagged as user-originated', async () => {
    // Simulate the payload a normal domain mutation would emit.
    const eventId = `evt-recursion-user-${Date.now()}-${Math.random().toString(16).slice(2, 10)}`;
    const created = await prisma.$transaction(async (tx) => {
      return tx.outboxEvent.create({
        data: {
          id: eventId,
          eventType: 'AUTOMATION_EVALUATION',
          aggregateType: 'Ticket',
          aggregateId: 'ticket-dummy-user',
          payload: {
            triggerType: 'ticket.assigned',
            triggerPayload: { assigneeId: 'user-1' },
            automationContext: {
              causedByAutomation: false,
              actorId: 'user-1',
            },
            workspaceId: 'workspace-dummy-user',
            ticketId: 'ticket-dummy-user',
            actorId: 'user-1',
          },
        },
      });
    });
    createdEventIds.push(created.id);

    const fetched = await prisma.outboxEvent.findUnique({ where: { id: created.id } });
    expect(fetched).not.toBeNull();

    const payload = fetched!.payload as { automationContext: { causedByAutomation: boolean } };
    expect(shouldEvaluateEvent(payload.automationContext)).toBe(true);
  });
});
