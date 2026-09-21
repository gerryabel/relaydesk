import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { PrismaClient } from '@/generated/prisma';
import { PrismaPg } from '@prisma/adapter-pg';
import { getTestDatabaseUrl } from '@/lib/test/db';
import { executeAction } from '@/lib/automation/actions/execution';

/**
 * End-to-end integration test for the automation action execution flow.
 *
 * Exercises the full path: pending action → executeAction → handler →
  * domain mutation + outbox emission → next action scheduling → finalization.
 */

function createPrismaClient() {
  const connectionString = getTestDatabaseUrl();
  const adapter = new PrismaPg(connectionString);
  return new PrismaClient({ adapter });
}

function createId(prefix: string) {
  return `${prefix}-${Date.now()}-${Math.random().toString(16).slice(2, 10)}`;
}

describe('automation action execution E2E', () => {
  let prisma: PrismaClient;
  let workspaceId: string;
  let actorId: string;
  let assigneeId: string;
  let tagId: string;
  let ruleId: string;
  let ticketId: string;
  const createdWorkspaceIds: string[] = [];
  const createdUserIds: string[] = [];
  const createdRuleIds: string[] = [];
  const createdTicketIds: string[] = [];
  const createdTagIds: string[] = [];
  const createdExecutionIds: string[] = [];

  beforeAll(async () => {
    prisma = createPrismaClient();

    // Create all fixtures in a single transaction so that concurrent test
    // files' afterAll cleanup cannot delete our workspace mid-setup (which
    // would violate FK constraints on subsequent creates).
    await prisma.$transaction(async (tx) => {
      const workspace = await tx.workspace.create({
        data: { id: createId('workspace'), name: `E2E Workspace ${Date.now()}` },
      });
      workspaceId = workspace.id;
      createdWorkspaceIds.push(workspaceId);

      const actor = await tx.user.create({
        data: { id: createId('actor'), email: `e2e-actor-${Date.now()}@example.com`, name: 'E2E Actor' },
      });
      actorId = actor.id;
      createdUserIds.push(actorId);

      const assignee = await tx.user.create({
        data: { id: createId('assignee'), email: `e2e-assignee-${Date.now()}@example.com`, name: 'E2E Assignee' },
      });
      assigneeId = assignee.id;
      createdUserIds.push(assigneeId);

      await tx.membership.createMany({
        data: [
          { id: createId('membership'), workspaceId, userId: actorId, role: 'owner' },
          { id: createId('membership'), workspaceId, userId: assigneeId, role: 'member' },
        ],
      });

      const tag = await tx.tag.create({
        data: { workspaceId, name: 'e2e-tag', normalizedName: 'e2e-tag' },
      });
      tagId = tag.id;
      createdTagIds.push(tagId);

      const ticket = await tx.ticket.create({
        data: {
          id: createId('ticket'),
          workspaceId,
          title: 'E2E Test Ticket',
          createdById: actorId,
          status: 'open',
          priority: 'medium',
        },
      });
      ticketId = ticket.id;
      createdTicketIds.push(ticketId);

      const rule = await tx.automationRule.create({
        data: {
          workspaceId,
          name: `E2E Rule ${Date.now()}`,
          enabled: true,
          triggerType: 'ticket.created',
          conditions: [],
          actions: JSON.stringify([]),
        },
      });
      ruleId = rule.id;
      createdRuleIds.push(ruleId);
    });
  });

  afterAll(async () => {
    // Scoped cleanup: only delete data created by this test file.
    // Order matters — delete children before parents to avoid FK violations.
    await prisma.outboxEvent.deleteMany({ where: { aggregateType: 'Ticket', aggregateId: { in: createdTicketIds } } });
    await prisma.ticketActivity.deleteMany({ where: { ticketId: { in: createdTicketIds } } });
    await prisma.ticketTag.deleteMany({ where: { ticketId: { in: createdTicketIds } } });
    await prisma.internalNote.deleteMany({ where: { ticketId: { in: createdTicketIds } } });
    await prisma.notification.deleteMany({ where: { workspaceId: { in: createdWorkspaceIds } } });
    await prisma.automationActionExecution.deleteMany({ where: { executionId: { in: createdExecutionIds } } });
    await prisma.automationExecution.deleteMany({ where: { id: { in: createdExecutionIds } } });
    await prisma.automationRule.deleteMany({ where: { id: { in: createdRuleIds } } });
    await prisma.ticket.deleteMany({ where: { id: { in: createdTicketIds } } });
    await prisma.tag.deleteMany({ where: { id: { in: createdTagIds } } });
    await prisma.membership.deleteMany({ where: { workspaceId: { in: createdWorkspaceIds } } });
    await prisma.user.deleteMany({ where: { id: { in: createdUserIds } } });
    await prisma.workspace.deleteMany({ where: { id: { in: createdWorkspaceIds } } });
    await prisma.$disconnect();
  });

  it('executes a single assign action to completion and finalizes', async () => {
    // Create execution + action atomically to avoid FK races with concurrent
    // test files' afterAll cleanup.
    const executionId = createId('execution');
    createdExecutionIds.push(executionId);

    await prisma.$transaction(async (tx) => {
      await tx.automationExecution.create({
        data: {
          id: executionId,
          workspaceId,
          ruleId,
          sourceEventType: 'AUTOMATION_EVALUATION',
          sourceEventId: 'e2e-evt-1',
          sourceAggregateId: ticketId,
          ticketId,
          status: 'awaiting_actions',
        },
      });

      await tx.automationActionExecution.create({
        data: {
          executionId,
          actionIndex: 0,
          actionType: 'assign',
          actionConfig: { assigneeId },
          status: 'pending',
        },
      });
    });

    const result = await executeAction(executionId, 0);

    expect(result.terminal).toBe(true);
    if (result.terminal) {
      expect(result.outcome).toBe('completed');
    }

    // Ticket should be assigned
    const ticket = await prisma.ticket.findUnique({ where: { id: ticketId } });
    expect(ticket?.assignedToId).toBe(assigneeId);

    // Execution should be finalized as completed
    const exec = await prisma.automationExecution.findUnique({ where: { id: executionId } });
    expect(exec?.status).toBe('completed');
    expect(exec?.completedAt).not.toBeNull();
  });

  it('executes add-tag action and schedules next action', async () => {
    // Create a unique tag + execution + actions atomically to avoid FK races
    // with concurrent test files' afterAll cleanup.
    const uniqueTagName = `e2e-tag-${Date.now()}-${Math.random().toString(16).slice(2, 8)}`;

    const { tagId: addTagId, executionId: addExecId } = await prisma.$transaction(async (tx) => {
      const createdTag = await tx.tag.create({
        data: { workspaceId, name: uniqueTagName, normalizedName: uniqueTagName },
      });
      createdTagIds.push(createdTag.id);

      const createdExecution = await tx.automationExecution.create({
        data: {
          workspaceId,
          ruleId,
          sourceEventType: 'AUTOMATION_EVALUATION',
          sourceEventId: 'e2e-evt-2',
          sourceAggregateId: ticketId,
          ticketId,
          status: 'awaiting_actions',
        },
      });
      createdExecutionIds.push(createdExecution.id);

      await tx.automationActionExecution.createMany({
        data: [
          {
            executionId: createdExecution.id,
            actionIndex: 0,
            actionType: 'add-tag',
            actionConfig: { tagId: createdTag.id },
            status: 'pending',
          },
          {
            executionId: createdExecution.id,
            actionIndex: 1,
            actionType: 'set-priority',
            actionConfig: { priority: 'high' },
            status: 'pending',
          },
        ],
      });

      return { tagId: createdTag.id, executionId: createdExecution.id };
    });

    const result = await executeAction(addExecId, 0);

    expect(result.terminal).toBe(true);
    if (result.terminal) {
      expect(result.outcome).toBe('completed');
    }

    // Tag should be on ticket
    const ticketTag = await prisma.ticketTag.findUnique({
      where: { ticketId_tagId: { ticketId, tagId: addTagId } },
    });
    expect(ticketTag).not.toBeNull();

    // Execution should still be awaiting_actions (action 1 pending)
    const exec = await prisma.automationExecution.findUnique({ where: { id: addExecId } });
    expect(exec?.status).toBe('awaiting_actions');

    // Outbox event for action 1 should exist
    const outboxEvent = await prisma.outboxEvent.findFirst({
      where: {
        eventType: 'AUTOMATION_ACTION_EXECUTION',
        aggregateId: ticketId,
      },
      orderBy: { createdAt: 'desc' },
    });
    expect(outboxEvent).not.toBeNull();
    const payload = outboxEvent!.payload as { actionIndex: number };
    expect(payload.actionIndex).toBe(1);
  });

  it('executes the second action and finalizes', async () => {
    // Create a unique tag + execution + actions atomically to avoid FK races
    // with concurrent test files' afterAll cleanup.
    const uniqueTagName = `e2e-tag-final-${Date.now()}-${Math.random().toString(16).slice(2, 8)}`;

    let finalExecutionId: string = '';
    await prisma.$transaction(async (tx) => {
      const createdTag = await tx.tag.create({
        data: { workspaceId, name: uniqueTagName, normalizedName: uniqueTagName },
      });
      createdTagIds.push(createdTag.id);

      const createdExecution = await tx.automationExecution.create({
        data: {
          workspaceId,
          ruleId,
          sourceEventType: 'AUTOMATION_EVALUATION',
          sourceEventId: 'e2e-evt-3',
          sourceAggregateId: ticketId,
          ticketId,
          status: 'awaiting_actions',
        },
      });
      createdExecutionIds.push(createdExecution.id);
      finalExecutionId = createdExecution.id;

      await tx.automationActionExecution.createMany({
        data: [
          {
            executionId: createdExecution.id,
            actionIndex: 0,
            actionType: 'add-tag',
            actionConfig: { tagId: createdTag.id },
            status: 'pending',
          },
          {
            executionId: createdExecution.id,
            actionIndex: 1,
            actionType: 'set-priority',
            actionConfig: { priority: 'urgent' },
            status: 'pending',
          },
        ],
      });
    });

    // Execute action 0 — must complete before action 1 can run.
    const firstResult = await executeAction(finalExecutionId, 0);
    expect(firstResult.terminal).toBe(true);
    if (firstResult.terminal) {
      expect(firstResult.outcome).toBe('completed');
    }

    // Verify action 0 is persisted as completed before proceeding.
    const action0State = await prisma.automationActionExecution.findUnique({
      where: { executionId_actionIndex: { executionId: finalExecutionId, actionIndex: 0 } },
    });
    expect(action0State?.status).toBe('completed');

    // Execute action 1.
    const result = await executeAction(finalExecutionId, 1);

    expect(result.terminal).toBe(true);
    if (result.terminal) {
      expect(result.outcome).toBe('completed');
    }

    // Execution should be finalized.
    const exec = await prisma.automationExecution.findUnique({ where: { id: finalExecutionId } });
    expect(exec?.status).toBe('completed');
    expect(exec?.completedAt).not.toBeNull();
  });

  it('emits downstream AUTOMATION_EVALUATION with causedByAutomation=true', async () => {
    // Create execution + action atomically to avoid FK races.
    const executionId = createId('execution');
    createdExecutionIds.push(executionId);

    await prisma.$transaction(async (tx) => {
      await tx.automationExecution.create({
        data: {
          id: executionId,
          workspaceId,
          ruleId,
          sourceEventType: 'AUTOMATION_EVALUATION',
          sourceEventId: 'e2e-evt-4',
          sourceAggregateId: ticketId,
          ticketId,
          status: 'awaiting_actions',
        },
      });

      await tx.automationActionExecution.create({
        data: {
          executionId,
          actionIndex: 0,
          actionType: 'assign',
          actionConfig: { assigneeId: actorId },
          status: 'pending',
        },
      });
    });

    await executeAction(executionId, 0);

    // Find the AUTOMATION_EVALUATION event emitted by the assign handler
    const evalEvent = await prisma.outboxEvent.findFirst({
      where: {
        eventType: 'AUTOMATION_EVALUATION',
        aggregateId: ticketId,
      },
      orderBy: { createdAt: 'desc' },
    });

    expect(evalEvent).not.toBeNull();
    const payload = evalEvent!.payload as {
      automationContext: { causedByAutomation: boolean };
    };
    expect(payload.automationContext.causedByAutomation).toBe(true);
  });
});
