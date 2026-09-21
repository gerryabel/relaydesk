import { describe, it, expect, beforeAll, beforeEach, afterAll } from 'vitest';
import { PrismaClient } from '@/generated/prisma';
import { PrismaPg } from '@prisma/adapter-pg';
import { getTestDatabaseUrl } from '@/lib/test/db';
import { markActionFailedAndContinue } from '@/lib/automation/actions/execution';

/**
 * Integration test for retry exhaustion handling.
 *
 * When BullMQ exhausts all attempts for a retryable action failure, the
 * action must be marked as failed (not stranded in `pending`) and the
 * next action must be scheduled (or the execution finalized).
 */

function createPrismaClient() {
  const connectionString = getTestDatabaseUrl();
  const adapter = new PrismaPg(connectionString);
  return new PrismaClient({ adapter });
}

function createId(prefix: string) {
  return `${prefix}-${Date.now()}-${Math.random().toString(16).slice(2, 10)}`;
}

describe('automation retry exhaustion', () => {
  let prisma: PrismaClient;
  let workspaceId: string;
  let ruleId: string;
  const createdExecutionIds: string[] = [];
  const createdWorkspaceIds: string[] = [];
  const createdRuleIds: string[] = [];
  const createdTicketIds: string[] = [];
  const createdOutboxEventIds: string[] = [];

  beforeAll(async () => {
    prisma = createPrismaClient();
  });

  // Create a fresh workspace + rule before each test so that concurrent test
  // files' afterAll cleanup cannot delete our workspace mid-test (which would
  // violate FK constraints on subsequent creates). We use a single
  // transaction to ensure the workspace+rule are created atomically.
  beforeEach(async () => {
    await prisma.$transaction(async (tx) => {
      const workspace = await tx.workspace.create({
        data: { id: createId('workspace'), name: `Retry Workspace ${Date.now()}` },
      });
      workspaceId = workspace.id;
      createdWorkspaceIds.push(workspaceId);

      const rule = await tx.automationRule.create({
        data: {
          workspaceId,
          name: `Retry Rule ${Date.now()}`,
          enabled: true,
          triggerType: 'ticket.created',
          conditions: [],
          actions: [],
        },
      });
      ruleId = rule.id;
      createdRuleIds.push(ruleId);
    });
  });

  afterAll(async () => {
    // Scoped cleanup: only delete data created by this test file.
    // Order matters — delete children before parents to avoid FK violations.
    await prisma.outboxEvent.deleteMany({ where: { id: { in: createdOutboxEventIds } } });
    await prisma.automationActionExecution.deleteMany({ where: { executionId: { in: createdExecutionIds } } });
    await prisma.automationExecution.deleteMany({ where: { id: { in: createdExecutionIds } } });
    await prisma.automationRule.deleteMany({ where: { id: { in: createdRuleIds } } });
    await prisma.ticket.deleteMany({ where: { id: { in: createdTicketIds } } });
    await prisma.workspace.deleteMany({ where: { id: { in: createdWorkspaceIds } } });
    await prisma.$disconnect();
  });

  it('marks action as failed and finalizes when no next action exists', async () => {
    const executionId = createId('execution');
    createdExecutionIds.push(executionId);

    // Create execution + action atomically to avoid FK races with concurrent
    // test files' afterAll cleanup.
    await prisma.$transaction(async (tx) => {
      await tx.automationExecution.create({
        data: {
          id: executionId,
          workspaceId,
          ruleId,
          sourceEventType: 'AUTOMATION_EVALUATION',
          sourceEventId: 'evt-1',
          sourceAggregateId: 'ticket-1',
          ticketId: null,
          status: 'awaiting_actions',
        },
      });

      // Single pending action
      await tx.automationActionExecution.create({
        data: {
          executionId,
          actionIndex: 0,
          actionType: 'unassign',
          actionConfig: {},
          status: 'pending',
        },
      });
    });

    await markActionFailedAndContinue(executionId, 0, 'Retry exhausted: transient failure');

    // Action should be failed
    const action = await prisma.automationActionExecution.findUnique({
      where: { executionId_actionIndex: { executionId, actionIndex: 0 } },
    });
    expect(action?.status).toBe('failed');
    expect(action?.error).toContain('Retry exhausted');
    expect(action?.completedAt).not.toBeNull();

    // Execution should be finalized as failed (all actions failed)
    const exec = await prisma.automationExecution.findUnique({ where: { id: executionId } });
    expect(exec?.status).toBe('failed');
    expect(exec?.completedAt).not.toBeNull();
  });

  it('marks action as failed and schedules next action when one exists', async () => {
    // Create a real ticket for this execution to satisfy FK.
    const ticket = await prisma.ticket.create({
      data: {
        id: createId('ticket'),
        workspaceId,
        title: `Retry Test Ticket ${Date.now()}`,
        status: 'open',
        priority: 'medium',
      },
    });
    createdTicketIds.push(ticket.id);

    const executionId = createId('execution');
    createdExecutionIds.push(executionId);

    // Create execution + actions in a single transaction so the FK
    // constraint is satisfied atomically (avoids cross-test races where
    // another test file's afterAll deletes the workspace between our
    // execution create and the action createMany).
    await prisma.$transaction(async (tx) => {
      await tx.automationExecution.create({
        data: {
          id: executionId,
          workspaceId,
          ruleId,
          sourceEventType: 'AUTOMATION_EVALUATION',
          sourceEventId: 'evt-2',
          sourceAggregateId: ticket.id,
          ticketId: ticket.id,
          status: 'awaiting_actions',
        },
      });

      await tx.automationActionExecution.createMany({
        data: [
          {
            executionId,
            actionIndex: 0,
            actionType: 'assign',
            actionConfig: { assigneeId: 'user-1' },
            status: 'pending',
          },
          {
            executionId,
            actionIndex: 1,
            actionType: 'set-status',
            actionConfig: { status: 'in_progress' },
            status: 'pending',
          },
        ],
      });
    });

    await markActionFailedAndContinue(executionId, 0, 'Retry exhausted');

    // First action should be failed
    const action0 = await prisma.automationActionExecution.findUnique({
      where: { executionId_actionIndex: { executionId, actionIndex: 0 } },
    });
    expect(action0?.status).toBe('failed');

    // Execution should NOT be finalized yet (action 1 still pending)
    const exec = await prisma.automationExecution.findUnique({ where: { id: executionId } });
    expect(exec?.status).toBe('awaiting_actions');

    // An outbox event should have been created for action 1
    const outboxEvent = await prisma.outboxEvent.findFirst({
      where: {
        eventType: 'AUTOMATION_ACTION_EXECUTION',
        aggregateId: ticket.id,
      },
    });
    expect(outboxEvent).not.toBeNull();
    const payload = outboxEvent!.payload as { executionId: string; actionIndex: number };
    expect(payload.executionId).toBe(executionId);
    expect(payload.actionIndex).toBe(1);

    // Track for cleanup
    if (outboxEvent) {
      createdOutboxEventIds.push(outboxEvent.id);
    }
  });

  it('is a no-op when action already reached terminal state (race-safe)', async () => {
    const executionId = createId('execution');
    createdExecutionIds.push(executionId);

    // Create execution + action atomically to avoid FK races.
    await prisma.$transaction(async (tx) => {
      await tx.automationExecution.create({
        data: {
          id: executionId,
          workspaceId,
          ruleId,
          sourceEventType: 'AUTOMATION_EVALUATION',
          sourceEventId: 'evt-3',
          sourceAggregateId: 'ticket-3',
          ticketId: null,
          status: 'awaiting_actions',
        },
      });

      await tx.automationActionExecution.create({
        data: {
          executionId,
          actionIndex: 0,
          actionType: 'unassign',
          actionConfig: {},
          status: 'completed', // already done — won a race
          completedAt: new Date(),
        },
      });
    });

    await markActionFailedAndContinue(executionId, 0, 'Retry exhausted');

    // Action should still be completed (not overwritten)
    const action = await prisma.automationActionExecution.findUnique({
      where: { executionId_actionIndex: { executionId, actionIndex: 0 } },
    });
    expect(action?.status).toBe('completed');

    // Execution should NOT be finalized (no terminal state change was applied)
    const exec = await prisma.automationExecution.findUnique({ where: { id: executionId } });
    expect(exec?.status).toBe('awaiting_actions');
  });
});
