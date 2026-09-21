import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { PrismaClient } from '@/generated/prisma';
import { PrismaPg } from '@prisma/adapter-pg';
import { getTestDatabaseUrl } from '@/lib/test/db';
import { executeAction } from '@/lib/automation/actions/execution';

/**
 * Integration tests for the internal-note and notification action types.
 *
 * These actions were added in Phase 8 Task 3. The internal-note action
 * requires a real authorId (workspace member); the notification action
 * requires a recipientId (workspace member).
 */

function createPrismaClient() {
  const connectionString = getTestDatabaseUrl();
  const adapter = new PrismaPg(connectionString);
  return new PrismaClient({ adapter });
}

function createId(prefix: string) {
  return `${prefix}-${Date.now()}-${Math.random().toString(16).slice(2, 10)}`;
}

describe('internal-note and notification actions', () => {
  let prisma: PrismaClient;
  let workspaceId: string;
  let actorId: string;
  let recipientId: string;
  let ruleId: string;
  let ticketId: string;
  const createdWorkspaceIds: string[] = [];
  const createdUserIds: string[] = [];
  const createdRuleIds: string[] = [];
  const createdTicketIds: string[] = [];
  const createdExecutionIds: string[] = [];

  beforeAll(async () => {
    prisma = createPrismaClient();

    const workspace = await prisma.workspace.create({
      data: { id: createId('workspace'), name: `Action Types ${Date.now()}` },
    });
    workspaceId = workspace.id;
    createdWorkspaceIds.push(workspaceId);

    const actor = await prisma.user.create({
      data: { id: createId('actor'), email: `actor-${Date.now()}@example.com`, name: 'Actor' },
    });
    actorId = actor.id;
    createdUserIds.push(actorId);

    const recipient = await prisma.user.create({
      data: { id: createId('recipient'), email: `recipient-${Date.now()}@example.com`, name: 'Recipient' },
    });
    recipientId = recipient.id;
    createdUserIds.push(recipientId);

    await prisma.membership.createMany({
      data: [
        { id: createId('membership'), workspaceId, userId: actorId, role: 'owner' },
        { id: createId('membership'), workspaceId, userId: recipientId, role: 'member' },
      ],
    });

    const ticket = await prisma.ticket.create({
      data: {
        id: createId('ticket'),
        workspaceId,
        title: 'Note Test Ticket',
        createdById: actorId,
        status: 'open',
        priority: 'medium',
      },
    });
    ticketId = ticket.id;
    createdTicketIds.push(ticketId);

    const rule = await prisma.automationRule.create({
      data: {
        workspaceId,
        name: `Note Rule ${Date.now()}`,
        enabled: true,
        triggerType: 'ticket.created',
        conditions: [],
        actions: JSON.stringify([]),
      },
    });
    ruleId = rule.id;
    createdRuleIds.push(ruleId);
  });

  afterAll(async () => {
    // Scoped cleanup: only delete data created by this test file.
    // Order matters — delete children before parents to avoid FK violations.
    await prisma.outboxEvent.deleteMany({ where: { aggregateType: 'Ticket', aggregateId: { in: createdTicketIds } } });
    await prisma.ticketActivity.deleteMany({ where: { ticketId: { in: createdTicketIds } } });
    await prisma.internalNote.deleteMany({ where: { ticketId: { in: createdTicketIds } } });
    await prisma.notification.deleteMany({ where: { workspaceId: { in: createdWorkspaceIds } } });
    await prisma.automationActionExecution.deleteMany({ where: { executionId: { in: createdExecutionIds } } });
    await prisma.automationExecution.deleteMany({ where: { id: { in: createdExecutionIds } } });
    await prisma.automationRule.deleteMany({ where: { id: { in: createdRuleIds } } });
    await prisma.ticket.deleteMany({ where: { id: { in: createdTicketIds } } });
    await prisma.membership.deleteMany({ where: { workspaceId: { in: createdWorkspaceIds } } });
    await prisma.user.deleteMany({ where: { id: { in: createdUserIds } } });
    await prisma.workspace.deleteMany({ where: { id: { in: createdWorkspaceIds } } });
    await prisma.$disconnect();
  });

  it('creates an internal note with automation-origin marker', async () => {
    const execution = await prisma.automationExecution.create({
      data: {
        workspaceId,
        ruleId,
        ruleNameSnapshot: 'Test Rule',
        sourceEventType: 'AUTOMATION_EVALUATION',
        sourceEventId: 'evt-note-1',
        sourceAggregateId: ticketId,
        ticketId,
        status: 'awaiting_actions',
      },
    });
    createdExecutionIds.push(execution.id);

    await prisma.automationActionExecution.create({
      data: {
        executionId: execution.id,
        actionIndex: 0,
        actionType: 'internal-note',
        actionConfig: { body: 'Review required', authorId: actorId },
        status: 'pending',
      },
    });

    const result = await executeAction(execution.id, 0);

    expect(result.terminal).toBe(true);
    if (result.terminal) {
      expect(result.outcome).toBe('completed');
    }

    // Note should exist with automation prefix
    const note = await prisma.internalNote.findFirst({
      where: { ticketId, authorId: actorId },
      orderBy: { createdAt: 'desc' },
    });
    expect(note).not.toBeNull();
    expect(note!.body).toBe('[Automation] Review required');
    expect(note!.automationDedupeKey).toBe(`${execution.id}:0`);
  });

  it('creates an in-app notification with automation-origin marker', async () => {
    const execution = await prisma.automationExecution.create({
      data: {
        workspaceId,
        ruleId,
        ruleNameSnapshot: 'Test Rule',
        sourceEventType: 'AUTOMATION_EVALUATION',
        sourceEventId: 'evt-notif-1',
        sourceAggregateId: ticketId,
        ticketId,
        status: 'awaiting_actions',
      },
    });
    createdExecutionIds.push(execution.id);

    await prisma.automationActionExecution.create({
      data: {
        executionId: execution.id,
        actionIndex: 0,
        actionType: 'notification',
        actionConfig: { recipientId, title: 'SLA Warning', body: 'Response overdue' },
        status: 'pending',
      },
    });

    const result = await executeAction(execution.id, 0);

    expect(result.terminal).toBe(true);
    if (result.terminal) {
      expect(result.outcome).toBe('completed');
    }

    // Notification should exist with automation prefix
    const notification = await prisma.notification.findFirst({
      where: { userId: recipientId, workspaceId },
      orderBy: { createdAt: 'desc' },
    });
    expect(notification).not.toBeNull();
    expect(notification!.title).toBe('[Automation] SLA Warning');
    expect(notification!.body).toBe('Response overdue');
    expect(notification!.automationDedupeKey).toBe(`${execution.id}:0`);
  });
});
