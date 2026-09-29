import { describe, it, expect, beforeEach, afterAll, vi } from 'vitest';
import { z } from 'zod';
import type { Prisma } from '@/generated/prisma';
import { prisma } from '@/lib/db/prisma';
import { ForbiddenError } from '@/lib/workspace/server';
import { createOutboxEvent } from '@/lib/outbox/outbox';
import { executeAction } from '@/lib/automation/actions/execution';
import { ExecutionNotFoundError } from '@/lib/automation/execution-service';
import {
  listAutomationExecutions,
  getAutomationExecutionById,
  retryFailedFinalAction,
  ActionNotFoundError,
  ExecutionNotRetryableError,
  ExecutionRetryConflictError,
} from '@/lib/automation/executions';

/**
 * Integration coverage for the automation operations surface: workspace-scoped
 * execution history, execution detail, and manual retry of the final failed
 * action.
 *
 * Every database query is a real Prisma call against the test database — only
 * workspace identity is mocked, so workspace isolation is genuinely exercised
 * rather than asserted about a stub.
 */

const membershipState = vi.hoisted(() => ({
  current: {
    userId: 'user-1' as string,
    workspaceId: 'workspace-placeholder',
    role: 'owner' as 'owner' | 'member',
  },
}));

vi.mock('@/lib/workspace/server', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/workspace/server')>();
  return {
    ...actual,
    getCurrentMembership: vi.fn(async () => membershipState.current),
    assertWorkspaceOwner: vi.fn(async () => {
      if (membershipState.current.role !== 'owner') {
        throw new actual.ForbiddenError('Only workspace owners can perform this action.');
      }
      return membershipState.current;
    }),
  };
});

vi.mock('@/lib/outbox/outbox', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/outbox/outbox')>();
  return { ...actual, createOutboxEvent: vi.fn(actual.createOutboxEvent) };
});

const createOutboxEventMock = vi.mocked(createOutboxEvent);

const client = prisma;

const createdWorkspaceIds: string[] = [];
const createdRuleIds: string[] = [];
const createdTicketIds: string[] = [];
const createdExecutionIds: string[] = [];

let workspaceId: string;
let otherWorkspaceId: string;
let ruleId: string;
let deletedRuleId: string;
let ticketId: string;
let otherTicketId: string;

function createId(prefix: string) {
  return `${prefix}-${Date.now()}-${Math.random().toString(16).slice(2, 10)}`;
}

async function createWorkspace(name: string) {
  const workspace = await client.workspace.create({ data: { id: createId('ws'), name } });
  createdWorkspaceIds.push(workspace.id);
  return workspace.id;
}

async function createRule(wsId: string, name: string) {
  const rule = await client.automationRule.create({
    data: {
      workspaceId: wsId,
      name,
      enabled: true,
      triggerType: 'ticket.created',
      conditions: [],
      actions: [{ actionType: 'unassign', actionConfig: {} }],
    },
  });
  createdRuleIds.push(rule.id);
  return rule.id;
}

async function createTicket(wsId: string, title: string) {
  const ticket = await client.ticket.create({
    data: { id: createId('ticket'), workspaceId: wsId, title, status: 'open', priority: 'medium' },
  });
  createdTicketIds.push(ticket.id);
  return ticket.id;
}

async function createSourceEvent(wsId: string, aggregateId: string) {
  const event = await client.outboxEvent.create({
    data: {
      eventType: 'AUTOMATION_EVALUATION',
      aggregateType: 'Ticket',
      aggregateId,
      payload: { workspaceId: wsId, ticketId: aggregateId, triggerType: 'ticket.created' },
    },
  });
  return event.id;
}

type SeedAction = {
  actionIndex: number;
  actionType: string;
  actionConfig?: Record<string, unknown>;
  status?: 'pending' | 'completed' | 'failed' | 'skipped';
  error?: string | null;
  startedAt?: Date | null;
  completedAt?: Date | null;
};

type SeedExecutionInput = {
  wsId?: string;
  /** `undefined` uses the default rule; `null` simulates a deleted rule. */
  rule?: string | null;
  ruleNameSnapshot?: string;
  status?:
    | 'pending'
    | 'evaluating'
    | 'awaiting_actions'
    | 'executing'
    | 'completed'
    | 'partial_failure'
    | 'failed'
    | 'skipped';
  ticket?: string | null;
  sourceEventType?: string;
  sourceEventId?: string;
  createdAt?: Date;
  completedAt?: Date | null;
  evaluatedConditions?: boolean;
  skipReason?: string | null;
  error?: string | null;
  actions?: SeedAction[];
};

async function seedExecution(input: SeedExecutionInput) {
  const wsId = input.wsId ?? workspaceId;
  const resolvedTicket = input.ticket === undefined ? ticketId : input.ticket;
  const aggregateId = resolvedTicket ?? 'aggregate-missing';
  const sourceEventId = input.sourceEventId ?? (await createSourceEvent(wsId, aggregateId));

  const execution = await client.automationExecution.create({
    data: {
      id: createId('exec'),
      workspaceId: wsId,
      ruleId: input.rule === undefined ? ruleId : input.rule,
      ruleNameSnapshot: input.ruleNameSnapshot ?? 'History Rule',
      sourceEventType: input.sourceEventType ?? 'AUTOMATION_EVALUATION',
      sourceEventId,
      sourceAggregateId: aggregateId,
      ticketId: resolvedTicket,
      status: input.status ?? 'completed',
      evaluatedConditions: input.evaluatedConditions ?? false,
      skipReason: input.skipReason ?? null,
      error: input.error ?? null,
      ...(input.createdAt ? { createdAt: input.createdAt, startedAt: input.createdAt } : {}),
      ...(input.completedAt ? { completedAt: input.completedAt } : {}),
    },
  });
  createdExecutionIds.push(execution.id);

  if (input.actions?.length) {
    await client.automationActionExecution.createMany({
      data: input.actions.map((action) => ({
        executionId: execution.id,
        actionIndex: action.actionIndex,
        actionType: action.actionType,
        actionConfig: (action.actionConfig ?? {}) as Prisma.InputJsonValue,
        status: action.status ?? 'pending',
        error: action.error ?? null,
        startedAt: action.startedAt ?? null,
        completedAt: action.completedAt ?? null,
      })),
    });
  }

  return execution;
}

/** Only the retry-created events for our own executions, ignoring other suites. */
async function actionEventsFor(executionId: string) {
  const events = await client.outboxEvent.findMany({
    where: { eventType: 'AUTOMATION_ACTION_EXECUTION' },
  });
  return events.filter((event) => (event.payload as { executionId?: string }).executionId === executionId);
}

/** A two-step chain whose final action failed. */
async function seedFailedFinalAction(options?: { rule?: string | null; finalIndex?: number }) {
  const finalIndex = options?.finalIndex ?? 1;
  const actions: SeedAction[] = Array.from({ length: finalIndex + 1 }, (_, index) => ({
    actionIndex: index,
    actionType: 'unassign',
    actionConfig: { order: index },
    status: index === finalIndex ? 'failed' : 'completed',
    error: index === finalIndex ? 'boom' : null,
    startedAt: new Date('2026-01-01T00:00:00.000Z'),
    completedAt: index === finalIndex ? null : new Date('2026-01-01T00:00:01.000Z'),
  }));

  return seedExecution({
    ...(options?.rule !== undefined ? { rule: options.rule } : {}),
    status: finalIndex === 0 ? 'failed' : 'partial_failure',
    ruleNameSnapshot: 'Retry Rule',
    actions,
  });
}

beforeEach(async () => {
  createOutboxEventMock.mockClear();
  membershipState.current = { userId: 'user-1', workspaceId: 'workspace-placeholder', role: 'owner' };

  workspaceId = await createWorkspace(`Ops Workspace ${Date.now()}`);
  otherWorkspaceId = await createWorkspace(`Other Workspace ${Date.now()}`);
  ruleId = await createRule(workspaceId, `Ops Rule ${Date.now()}`);
  deletedRuleId = await createRule(workspaceId, `Doomed Rule ${Date.now()}`);
  ticketId = await createTicket(workspaceId, `Ops Ticket ${Date.now()}`);
  otherTicketId = await createTicket(workspaceId, `Second Ticket ${Date.now()}`);

  membershipState.current.workspaceId = workspaceId;
});

afterAll(async () => {
  const leakedEvents = await client.outboxEvent.findMany({
    where: { eventType: { in: ['AUTOMATION_ACTION_EXECUTION', 'AUTOMATION_EVALUATION'] } },
  });
  const leakedIds = leakedEvents
    .filter((event) => {
      const payload = event.payload as { executionId?: string; workspaceId?: string };
      return (
        createdExecutionIds.includes(payload.executionId ?? '') ||
        createdWorkspaceIds.includes(payload.workspaceId ?? '')
      );
    })
    .map((event) => event.id);

  await client.outboxEvent.deleteMany({ where: { id: { in: leakedIds } } });
  await client.automationActionExecution.deleteMany({
    where: { executionId: { in: createdExecutionIds } },
  });
  await client.automationExecution.deleteMany({ where: { id: { in: createdExecutionIds } } });
  await client.automationRule.deleteMany({ where: { id: { in: createdRuleIds } } });
  await client.ticket.deleteMany({ where: { id: { in: createdTicketIds } } });
  await client.workspace.deleteMany({ where: { id: { in: createdWorkspaceIds } } });
});

describe('listAutomationExecutions', () => {
  it('returns only the current workspace executions', async () => {
    await seedExecution({ ruleNameSnapshot: 'Mine A' });
    await seedExecution({ ruleNameSnapshot: 'Mine B' });
    await seedExecution({ wsId: otherWorkspaceId, ruleNameSnapshot: 'Theirs' });

    const result = await listAutomationExecutions({ limit: 100 });

    expect(result.data).toHaveLength(2);
    expect(result.data.map((row) => row.ruleNameSnapshot).sort()).toEqual(['Mine A', 'Mine B']);
    expect(result.data.every((row) => row.workspaceId === workspaceId)).toBe(true);
  });

  it('orders by createdAt DESC then id DESC', async () => {
    const base = Date.now() - 60_000;
    await seedExecution({ ruleNameSnapshot: 'Oldest', createdAt: new Date(base) });
    await seedExecution({ ruleNameSnapshot: 'Newest', createdAt: new Date(base + 2_000) });
    await seedExecution({ ruleNameSnapshot: 'Middle', createdAt: new Date(base + 1_000) });

    const result = await listAutomationExecutions({ limit: 10 });

    expect(result.data.map((row) => row.ruleNameSnapshot)).toEqual(['Newest', 'Middle', 'Oldest']);
  });

  it('applies the documented defaults (page 1, limit 20)', async () => {
    await seedExecution({});

    const result = await listAutomationExecutions({});

    expect(result.page).toBe(1);
    expect(result.limit).toBe(20);
    expect(result.total).toBe(1);
    expect(result.totalPages).toBe(1);
    expect(result.hasPreviousPage).toBe(false);
    expect(result.hasNextPage).toBe(false);
  });

  it('rejects a page size above the 100 maximum', async () => {
    await expect(listAutomationExecutions({ limit: 5_000 })).rejects.toBeInstanceOf(z.ZodError);
  });

  it('clamps an out-of-range page to the last page', async () => {
    const base = Date.now() - 60_000;
    await seedExecution({ createdAt: new Date(base), ruleNameSnapshot: 'E1' });
    await seedExecution({ createdAt: new Date(base + 1_000), ruleNameSnapshot: 'E2' });
    await seedExecution({ createdAt: new Date(base + 2_000), ruleNameSnapshot: 'E3' });

    const result = await listAutomationExecutions({ page: 99, limit: 2 });

    expect(result.total).toBe(3);
    expect(result.totalPages).toBe(2);
    expect(result.page).toBe(2);
    expect(result.hasPreviousPage).toBe(true);
    expect(result.hasNextPage).toBe(false);
    expect(result.data).toHaveLength(1);
    expect(result.data[0]!.ruleNameSnapshot).toBe('E1');
  });

  it('paginates without overlap between pages', async () => {
    const base = Date.now() - 120_000;
    for (let i = 0; i < 5; i += 1) {
      await seedExecution({ createdAt: new Date(base + i * 1_000), ruleNameSnapshot: `E${i}` });
    }

    const first = await listAutomationExecutions({ page: 1, limit: 2 });
    const second = await listAutomationExecutions({ page: 2, limit: 2 });

    expect(first.page).toBe(1);
    expect(second.page).toBe(2);
    expect(first.hasNextPage).toBe(true);
    expect(second.hasPreviousPage).toBe(true);
    expect(first.total).toBe(5);
    expect(second.total).toBe(5);

    const firstIds = first.data.map((row) => row.id);
    const secondIds = second.data.map((row) => row.id);
    expect(firstIds.filter((id) => secondIds.includes(id))).toHaveLength(0);
    expect(new Set([...firstIds, ...secondIds]).size).toBe(4);
  });

  it('filters by execution status', async () => {
    await seedExecution({ status: 'failed', ruleNameSnapshot: 'Failed one' });
    await seedExecution({ status: 'completed', ruleNameSnapshot: 'Completed one' });
    await seedExecution({ status: 'skipped', ruleNameSnapshot: 'Skipped one' });

    const failed = await listAutomationExecutions({ status: 'failed' });
    const skipped = await listAutomationExecutions({ status: 'skipped' });

    expect(failed.data.map((row) => row.ruleNameSnapshot)).toEqual(['Failed one']);
    expect(skipped.data.map((row) => row.ruleNameSnapshot)).toEqual(['Skipped one']);
  });

  it('filters by rule', async () => {
    await seedExecution({ rule: ruleId, ruleNameSnapshot: 'By rule' });
    await seedExecution({ rule: deletedRuleId, ruleNameSnapshot: 'By other rule' });

    const result = await listAutomationExecutions({ ruleId });

    expect(result.data).toHaveLength(1);
    expect(result.data[0]!.ruleNameSnapshot).toBe('By rule');
  });

  it('keeps executions whose rule was deleted and reports ruleId = null', async () => {
    await seedExecution({ rule: null, ruleNameSnapshot: 'Historical Rule Name' });

    const result = await listAutomationExecutions({});

    expect(result.data).toHaveLength(1);
    expect(result.data[0]!.ruleId).toBeNull();
    expect(result.data[0]!.ruleNameSnapshot).toBe('Historical Rule Name');
  });

  it('filters by trigger / source event type', async () => {
    await seedExecution({ sourceEventType: 'TICKET_CREATED', ruleNameSnapshot: 'Created trigger' });
    await seedExecution({ sourceEventType: 'SLA_BREACHED', ruleNameSnapshot: 'SLA trigger' });

    const result = await listAutomationExecutions({ sourceEventType: 'SLA_BREACHED' });

    expect(result.data.map((row) => row.ruleNameSnapshot)).toEqual(['SLA trigger']);
  });

  it('filters by ticket', async () => {
    await seedExecution({ ticket: ticketId, ruleNameSnapshot: 'First ticket' });
    await seedExecution({ ticket: otherTicketId, ruleNameSnapshot: 'Second ticket' });

    const result = await listAutomationExecutions({ ticketId: otherTicketId });

    expect(result.data.map((row) => row.ruleNameSnapshot)).toEqual(['Second ticket']);
  });

  it('filters by a half-open [from, to) createdAt interval', async () => {
    const base = Date.UTC(2026, 0, 10, 12, 0, 0);
    await seedExecution({ createdAt: new Date(base - 1_000), ruleNameSnapshot: 'Before' });
    await seedExecution({ createdAt: new Date(base), ruleNameSnapshot: 'AtFrom' });
    await seedExecution({ createdAt: new Date(base + 1_000), ruleNameSnapshot: 'AtTo' });
    await seedExecution({ createdAt: new Date(base + 2_000), ruleNameSnapshot: 'After' });

    const result = await listAutomationExecutions({
      from: new Date(base),
      to: new Date(base + 1_000),
    });

    // `from` is inclusive, `to` is exclusive.
    expect(result.data.map((row) => row.ruleNameSnapshot)).toEqual(['AtFrom']);
  });

  it('combines multiple filters', async () => {
    await seedExecution({
      status: 'failed',
      rule: ruleId,
      ticket: ticketId,
      ruleNameSnapshot: 'Match',
    });
    await seedExecution({ status: 'failed', rule: ruleId, ruleNameSnapshot: 'Wrong ticket', ticket: otherTicketId });
    await seedExecution({ status: 'completed', rule: ruleId, ruleNameSnapshot: 'Wrong status' });

    const result = await listAutomationExecutions({
      status: 'failed',
      ruleId,
      ticketId,
    });

    expect(result.data.map((row) => row.ruleNameSnapshot)).toEqual(['Match']);
  });

  it('reports action counts and duration', async () => {
    const started = new Date('2026-01-05T10:00:00.000Z');
    await seedExecution({
      createdAt: started,
      completedAt: new Date('2026-01-05T10:00:02.500Z'),
      status: 'partial_failure',
      actions: [
        { actionIndex: 0, actionType: 'assign', status: 'completed' },
        { actionIndex: 1, actionType: 'set-status', status: 'failed' },
      ],
    });

    const [row] = (await listAutomationExecutions({})).data;

    expect(row!.actionCount).toBe(2);
    expect(row!.failedActionCount).toBe(1);
    expect(row!.isRetryable).toBe(true);
    expect(row!.durationMs).toBe(2_500);
  });

  it('never marks a successful execution as retryable', async () => {
    await seedExecution({
      status: 'completed',
      completedAt: new Date(),
      actions: [{ actionIndex: 0, actionType: 'unassign', status: 'completed' }],
    });

    const [row] = (await listAutomationExecutions({})).data;
    expect(row!.isRetryable).toBe(false);
  });

  /**
   * `isRetryable` means: the execution is in a retryable terminal status AND
   * its *final* action is failed. An earlier failed action is not retryable,
   * because only the final action may be replayed.
   */
  describe('isRetryable semantics', () => {
    it('is false for partial_failure when an earlier action failed and the final one completed', async () => {
      await seedExecution({
        status: 'partial_failure',
        actions: [
          { actionIndex: 0, actionType: 'unassign', status: 'failed', error: 'early failure' },
          { actionIndex: 1, actionType: 'set-status', status: 'completed' },
        ],
      });

      const [row] = (await listAutomationExecutions({})).data;

      // The failed action is still counted for triage purposes...
      expect(row!.failedActionCount).toBe(1);
      // ...but it is display-only, so nothing on the row is retryable.
      expect(row!.isRetryable).toBe(false);
    });

    it('is false for failed when an earlier action failed and the final one completed', async () => {
      await seedExecution({
        status: 'failed',
        actions: [
          { actionIndex: 0, actionType: 'unassign', status: 'failed' },
          { actionIndex: 1, actionType: 'set-status', status: 'completed' },
        ],
      });

      const [row] = (await listAutomationExecutions({})).data;
      expect(row!.isRetryable).toBe(false);
    });

    it('is true for partial_failure when the final action is failed', async () => {
      await seedExecution({
        status: 'partial_failure',
        actions: [
          { actionIndex: 0, actionType: 'unassign', status: 'completed' },
          { actionIndex: 1, actionType: 'set-status', status: 'failed' },
        ],
      });

      const [row] = (await listAutomationExecutions({})).data;
      expect(row!.isRetryable).toBe(true);
    });

    it('is true for failed when the final action is failed', async () => {
      await seedExecution({
        status: 'failed',
        actions: [{ actionIndex: 0, actionType: 'unassign', status: 'failed' }],
      });

      const [row] = (await listAutomationExecutions({})).data;
      expect(row!.isRetryable).toBe(true);
    });

    it('is false for a retryable status whose final action is pending or skipped', async () => {
      await seedExecution({
        status: 'partial_failure',
        actions: [
          { actionIndex: 0, actionType: 'unassign', status: 'completed' },
          { actionIndex: 1, actionType: 'set-status', status: 'pending' },
        ],
      });
      await seedExecution({
        status: 'failed',
        actions: [
          { actionIndex: 0, actionType: 'unassign', status: 'failed' },
          { actionIndex: 1, actionType: 'set-status', status: 'skipped' },
        ],
      });

      const rows = (await listAutomationExecutions({})).data;
      expect(rows).toHaveLength(2);
      expect(rows.every((row) => row.isRetryable === false)).toBe(true);
    });

    it('is false for an execution with no actions at all', async () => {
      await seedExecution({ status: 'failed', actions: [] });

      const [row] = (await listAutomationExecutions({})).data;
      expect(row!.actionCount).toBe(0);
      expect(row!.isRetryable).toBe(false);
    });

    it('flips to false once the retry reopens the execution', async () => {
      const execution = await seedFailedFinalAction();

      const before = (await listAutomationExecutions({})).data;
      expect(before[0]!.isRetryable).toBe(true);

      await retryFailedFinalAction(execution.id, 1);

      const after = (await listAutomationExecutions({})).data;
      expect(after[0]!.status).toBe('awaiting_actions');
      expect(after[0]!.isRetryable).toBe(false);
    });
  });

  it('is readable by a workspace member', async () => {
    await seedExecution({});

    membershipState.current = { userId: 'user-2', workspaceId, role: 'member' };
    const result = await listAutomationExecutions({});

    expect(result.data).toHaveLength(1);
  });
});

describe('getAutomationExecutionById', () => {
  it('returns execution metadata, action timeline and source event', async () => {
    const execution = await seedExecution({
      status: 'partial_failure',
      completedAt: new Date('2026-01-05T10:00:02.000Z'),
      evaluatedConditions: true,
      ruleNameSnapshot: 'Auto assign urgent',
      actions: [
        {
          actionIndex: 0,
          actionType: 'assign',
          actionConfig: { assigneeId: 'user-9' },
          status: 'completed',
          startedAt: new Date('2026-01-05T10:00:00.000Z'),
          completedAt: new Date('2026-01-05T10:00:01.000Z'),
        },
        {
          actionIndex: 1,
          actionType: 'internal-note',
          actionConfig: { body: 'Escalated', authorId: 'user-1' },
          status: 'failed',
          error: 'Author not a member',
        },
      ],
    });

    const detail = await getAutomationExecutionById(execution.id);

    expect(detail.execution.id).toBe(execution.id);
    expect(detail.execution.ruleNameSnapshot).toBe('Auto assign urgent');
    expect(detail.execution.ruleId).toBe(ruleId);
    expect(detail.execution.rule?.name).toBeTruthy();
    expect(detail.execution.status).toBe('partial_failure');
    expect(detail.execution.ticketId).toBe(ticketId);
    expect(detail.execution.evaluatedConditions).toBe(true);
    expect(detail.canRetry).toBe(true);

    expect(detail.actions).toHaveLength(2);
    expect(detail.actions.map((action) => action.actionIndex)).toEqual([0, 1]);
    expect(detail.actions[0]!.actionConfig).toEqual({ assigneeId: 'user-9' });
    expect(detail.actions[0]!.durationMs).toBe(1_000);
    expect(detail.actions[1]!.error).toBe('Author not a member');
    expect(detail.actions[0]!.isFinalAction).toBe(false);
    expect(detail.actions[1]!.isFinalAction).toBe(true);
    expect(detail.actions[0]!.isRetryable).toBe(false);
    expect(detail.actions[1]!.isRetryable).toBe(true);

    expect(detail.sourceEvent).not.toBeNull();
    expect(detail.sourceEvent!.eventType).toBe('AUTOMATION_EVALUATION');
    expect(detail.sourceEvent!.aggregateId).toBe(ticketId);
    expect(detail.sourceEvent!.payload).toMatchObject({ ticketId });
  });

  it('orders the timeline by actionIndex regardless of insertion order', async () => {
    const execution = await seedExecution({
      status: 'partial_failure',
      actions: [
        { actionIndex: 1, actionType: 'second', status: 'failed' },
        { actionIndex: 0, actionType: 'first', status: 'completed' },
      ],
    });

    const detail = await getAutomationExecutionById(execution.id);

    expect(detail.actions.map((action) => action.actionType)).toEqual(['first', 'second']);
    expect(detail.actions[1]!.isFinalAction).toBe(true);
  });

  it('preserves the historical action config after the rule is changed', async () => {
    const execution = await seedExecution({
      actions: [
        {
          actionIndex: 0,
          actionType: 'set-priority',
          actionConfig: { priority: 'urgent' },
          status: 'failed',
        },
      ],
    });

    // The live rule configuration now says something completely different.
    await client.automationRule.update({
      where: { id: ruleId },
      data: { actions: [{ actionType: 'set-priority', actionConfig: { priority: 'low' } }] },
    });

    const detail = await getAutomationExecutionById(execution.id);
    expect(detail.actions[0]!.actionConfig).toEqual({ priority: 'urgent' });
  });

  it('remains readable after the originating rule is deleted', async () => {
    const execution = await seedExecution({
      rule: deletedRuleId,
      ruleNameSnapshot: 'Deleted Rule Snapshot',
      status: 'failed',
      actions: [{ actionIndex: 0, actionType: 'unassign', status: 'failed' }],
    });

    await client.automationRule.delete({ where: { id: deletedRuleId } });

    const detail = await getAutomationExecutionById(execution.id);

    expect(detail.execution.rule).toBeNull();
    expect(detail.execution.ruleId).toBeNull();
    expect(detail.execution.ruleNameSnapshot).toBe('Deleted Rule Snapshot');
    expect(detail.actions).toHaveLength(1);
  });

  it('still renders when the source outbox event no longer exists', async () => {
    const execution = await seedExecution({
      sourceEventId: 'outbox-event-that-never-existed',
      actions: [{ actionIndex: 0, actionType: 'unassign', status: 'completed' }],
    });

    const detail = await getAutomationExecutionById(execution.id);

    expect(detail.sourceEvent).toBeNull();
    expect(detail.execution.id).toBe(execution.id);
    expect(detail.actions).toHaveLength(1);
  });

  it('exposes skip reason and error', async () => {
    const execution = await seedExecution({
      status: 'skipped',
      skipReason: 'no_actions',
      error: 'condition mismatch',
    });

    const detail = await getAutomationExecutionById(execution.id);

    expect(detail.execution.skipReason).toBe('no_actions');
    expect(detail.execution.error).toBe('condition mismatch');
  });

  it('is readable by a workspace member and reports canRetry = false', async () => {
    const execution = await seedExecution({
      status: 'failed',
      actions: [{ actionIndex: 0, actionType: 'unassign', status: 'failed' }],
    });

    membershipState.current = { userId: 'user-2', workspaceId, role: 'member' };
    const detail = await getAutomationExecutionById(execution.id);

    expect(detail.execution.id).toBe(execution.id);
    expect(detail.canRetry).toBe(false);
    // The action itself is still identified as the retryable one; only the
    // caller's permission differs.
    expect(detail.actions[0]!.isRetryable).toBe(true);
  });

  it('does not expose executions owned by another workspace', async () => {
    const execution = await seedExecution({ wsId: otherWorkspaceId });

    await expect(getAutomationExecutionById(execution.id)).rejects.toBeInstanceOf(
      ExecutionNotFoundError,
    );
  });

  it('throws ExecutionNotFoundError for an unknown id', async () => {
    await expect(getAutomationExecutionById('does-not-exist')).rejects.toBeInstanceOf(
      ExecutionNotFoundError,
    );
  });
});

describe('retryFailedFinalAction', () => {
  it('resets the final failed action, reopens the execution and enqueues exactly one event', async () => {
    const execution = await seedFailedFinalAction();

    const result = await retryFailedFinalAction(execution.id, 1);

    expect(result).toEqual({
      executionId: execution.id,
      actionIndex: 1,
      actionStatus: 'pending',
      executionStatus: 'awaiting_actions',
    });

    const action = await client.automationActionExecution.findUnique({
      where: { executionId_actionIndex: { executionId: execution.id, actionIndex: 1 } },
    });
    expect(action!.status).toBe('pending');
    expect(action!.error).toBeNull();
    expect(action!.startedAt).toBeNull();
    expect(action!.completedAt).toBeNull();
    // The historical config survives the retry untouched.
    expect(action!.actionConfig).toEqual({ order: 1 });

    const reopened = await client.automationExecution.findUnique({ where: { id: execution.id } });
    expect(reopened!.status).toBe('awaiting_actions');
    expect(reopened!.error).toBeNull();
    expect(reopened!.completedAt).toBeNull();
    expect(reopened!.leasedBy).toBeNull();
    expect(reopened!.leasedAt).toBeNull();

    expect(await actionEventsFor(execution.id)).toHaveLength(1);
    expect(createOutboxEventMock).toHaveBeenCalledTimes(1);
    const [outboxInput] = createOutboxEventMock.mock.calls[0]!;
    expect(outboxInput.eventType).toBe('AUTOMATION_ACTION_EXECUTION');
    expect(outboxInput.aggregateType).toBe('Ticket');
    expect(outboxInput.aggregateId).toBe(ticketId);
    expect(outboxInput.payload).toMatchObject({
      executionId: execution.id,
      actionIndex: 1,
      workspaceId,
      ticketId,
      automationContext: { ruleId, actorId: 'user-1' },
    });
  });

  it('leaves earlier completed actions untouched', async () => {
    const execution = await seedFailedFinalAction();

    await retryFailedFinalAction(execution.id, 1);

    const first = await client.automationActionExecution.findUnique({
      where: { executionId_actionIndex: { executionId: execution.id, actionIndex: 0 } },
    });
    expect(first!.status).toBe('completed');
    expect(first!.completedAt).not.toBeNull();
  });

  it('completes through the existing worker pipeline after a retry', async () => {
    const execution = await seedFailedFinalAction({ finalIndex: 0 });
    await retryFailedFinalAction(execution.id, 0);

    const outcome = await executeAction(execution.id, 0);

    expect(outcome.terminal).toBe(true);
    const finalized = await client.automationExecution.findUnique({ where: { id: execution.id } });
    expect(finalized!.status).toBe('completed');
  });

  it('rejects a retry for a workspace member', async () => {
    const execution = await seedFailedFinalAction();

    membershipState.current = { userId: 'user-2', workspaceId, role: 'member' };
    await expect(retryFailedFinalAction(execution.id, 1)).rejects.toBeInstanceOf(ForbiddenError);

    const action = await client.automationActionExecution.findUnique({
      where: { executionId_actionIndex: { executionId: execution.id, actionIndex: 1 } },
    });
    expect(action!.status).toBe('failed');
    expect(await actionEventsFor(execution.id)).toHaveLength(0);
    expect(createOutboxEventMock).not.toHaveBeenCalled();
  });

  it('rejects a retry for an execution owned by another workspace', async () => {
    const execution = await seedFailedFinalAction();
    membershipState.current.workspaceId = otherWorkspaceId;

    await expect(retryFailedFinalAction(execution.id, 1)).rejects.toBeInstanceOf(
      ExecutionNotFoundError,
    );
    expect(createOutboxEventMock).not.toHaveBeenCalled();
  });

  it('rejects a retry for an unknown execution', async () => {
    await expect(retryFailedFinalAction('missing-execution', 0)).rejects.toBeInstanceOf(
      ExecutionNotFoundError,
    );
  });

  it('rejects a retry for an action that does not belong to the execution', async () => {
    const execution = await seedFailedFinalAction();

    await expect(retryFailedFinalAction(execution.id, 7)).rejects.toBeInstanceOf(
      ActionNotFoundError,
    );
  });

  it('rejects retrying a non-final failed action', async () => {
    const execution = await seedExecution({
      status: 'partial_failure',
      actions: [
        { actionIndex: 0, actionType: 'unassign', status: 'failed', error: 'early failure' },
        { actionIndex: 1, actionType: 'unassign', status: 'completed' },
      ],
    });

    await expect(retryFailedFinalAction(execution.id, 0)).rejects.toBeInstanceOf(
      ExecutionNotRetryableError,
    );

    const untouched = await client.automationActionExecution.findUnique({
      where: { executionId_actionIndex: { executionId: execution.id, actionIndex: 0 } },
    });
    expect(untouched!.status).toBe('failed');
    expect(untouched!.error).toBe('early failure');
    expect(await actionEventsFor(execution.id)).toHaveLength(0);
  });

  it('rejects retrying an action that is not failed', async () => {
    const execution = await seedExecution({
      status: 'partial_failure',
      actions: [
        { actionIndex: 0, actionType: 'unassign', status: 'completed' },
        { actionIndex: 1, actionType: 'unassign', status: 'completed' },
      ],
    });

    await expect(retryFailedFinalAction(execution.id, 1)).rejects.toBeInstanceOf(
      ExecutionNotRetryableError,
    );
  });

  it.each(['pending', 'evaluating', 'awaiting_actions', 'executing'] as const)(
    'rejects retrying while the execution is %s',
    async (status) => {
      const execution = await seedExecution({
        status,
        actions: [{ actionIndex: 0, actionType: 'unassign', status: 'failed' }],
      });

      await expect(retryFailedFinalAction(execution.id, 0)).rejects.toBeInstanceOf(
        ExecutionNotRetryableError,
      );
      expect(createOutboxEventMock).not.toHaveBeenCalled();
    },
  );

  it('rejects retrying a skipped execution', async () => {
    const execution = await seedExecution({
      status: 'skipped',
      skipReason: 'no_actions',
      actions: [{ actionIndex: 0, actionType: 'unassign', status: 'failed' }],
    });

    await expect(retryFailedFinalAction(execution.id, 0)).rejects.toBeInstanceOf(
      ExecutionNotRetryableError,
    );
  });

  it('rejects retrying an execution with no ticket', async () => {
    const execution = await seedExecution({
      ticket: null,
      status: 'failed',
      actions: [{ actionIndex: 0, actionType: 'unassign', status: 'failed' }],
    });

    await expect(retryFailedFinalAction(execution.id, 0)).rejects.toBeInstanceOf(
      ExecutionNotRetryableError,
    );
    expect(await actionEventsFor(execution.id)).toHaveLength(0);
  });

  it('keeps a deleted rule retryable and preserves the historical action config', async () => {
    const execution = await seedExecution({
      rule: deletedRuleId,
      ruleNameSnapshot: 'Doomed Rule Snapshot',
      status: 'failed',
      actions: [
        {
          actionIndex: 0,
          actionType: 'add-tag',
          actionConfig: { tagId: 'tag-42' },
          status: 'failed',
          error: 'tag deleted',
        },
      ],
    });

    await client.automationRule.delete({ where: { id: deletedRuleId } });

    await retryFailedFinalAction(execution.id, 0);

    const action = await client.automationActionExecution.findUnique({
      where: { executionId_actionIndex: { executionId: execution.id, actionIndex: 0 } },
    });
    expect(action!.status).toBe('pending');
    expect(action!.actionConfig).toEqual({ tagId: 'tag-42' });

    const events = await actionEventsFor(execution.id);
    expect(events).toHaveLength(1);
    expect(events[0]!.payload).toMatchObject({ automationContext: { ruleId: null } });
  });

  it('reports a conflict for a second serialized retry, not a generic refusal', async () => {
    const execution = await seedFailedFinalAction();

    await retryFailedFinalAction(execution.id, 1);

    // A later request must be reported as a retry conflict, exactly like the
    // loser of a concurrent race — and must NOT fall back to
    // ExecutionNotRetryableError.
    const second = await retryFailedFinalAction(execution.id, 1).then(
      () => 'resolved',
      (error: unknown) => error,
    );

    expect(second).toBeInstanceOf(ExecutionRetryConflictError);
    expect(second).not.toBeInstanceOf(ExecutionNotRetryableError);
    expect((second as Error).name).toBe('ExecutionRetryConflictError');

    // No second outbox event, and the reopened state is untouched.
    expect(await actionEventsFor(execution.id)).toHaveLength(1);
    expect(createOutboxEventMock).toHaveBeenCalledTimes(1);

    const action = await client.automationActionExecution.findUnique({
      where: { executionId_actionIndex: { executionId: execution.id, actionIndex: 1 } },
    });
    expect(action!.status).toBe('pending');

    const executionAfter = await client.automationExecution.findUnique({
      where: { id: execution.id },
    });
    expect(executionAfter!.status).toBe('awaiting_actions');
  });

  it('reports the same conflict code for concurrent and serialized second retries', async () => {
    const concurrentExecution = await seedFailedFinalAction();
    const serializedExecution = await seedFailedFinalAction();

    const concurrent = await Promise.allSettled([
      retryFailedFinalAction(concurrentExecution.id, 1),
      retryFailedFinalAction(concurrentExecution.id, 1),
    ]);
    const concurrentReason = (concurrent.find((o) => o.status === 'rejected') as PromiseRejectedResult)
      .reason;

    await retryFailedFinalAction(serializedExecution.id, 1);
    const serializedReason = await retryFailedFinalAction(serializedExecution.id, 1).then(
      () => null,
      (error: unknown) => error,
    );

    expect(concurrentReason).toBeInstanceOf(ExecutionRetryConflictError);
    expect(serializedReason).toBeInstanceOf(ExecutionRetryConflictError);
    expect((concurrentReason as Error).name).toBe((serializedReason as Error).name);
  });

  it('does not report a conflict for unrelated invalid states', async () => {
    // Completed execution with a failed final action: invalid, but it was
    // never a retry, so it must not masquerade as a conflict.
    const completed = await seedExecution({
      status: 'completed',
      actions: [{ actionIndex: 0, actionType: 'unassign', status: 'failed' }],
    });
    // Failed execution whose final action completed.
    const alreadyCompleted = await seedExecution({
      status: 'failed',
      actions: [{ actionIndex: 0, actionType: 'unassign', status: 'completed' }],
    });
    // Failed execution whose final action is still pending (never retried).
    const pendingAction = await seedExecution({
      status: 'failed',
      actions: [{ actionIndex: 0, actionType: 'unassign', status: 'pending' }],
    });

    for (const id of [completed.id, alreadyCompleted.id, pendingAction.id]) {
      const reason = await retryFailedFinalAction(id, 0).then(
        () => null,
        (error: unknown) => error,
      );
      expect(reason).toBeInstanceOf(ExecutionNotRetryableError);
      expect(reason).not.toBeInstanceOf(ExecutionRetryConflictError);
    }
  });

  it('allows exactly one of two concurrent retries to win', async () => {
    const execution = await seedFailedFinalAction();

    const outcomes = await Promise.allSettled([
      retryFailedFinalAction(execution.id, 1),
      retryFailedFinalAction(execution.id, 1),
    ]);

    const fulfilled = outcomes.filter((outcome) => outcome.status === 'fulfilled');
    const rejected = outcomes.filter((outcome) => outcome.status === 'rejected');

    expect(fulfilled).toHaveLength(1);
    expect(rejected).toHaveLength(1);
    const reason = (rejected[0] as PromiseRejectedResult).reason;
    expect(reason).toBeInstanceOf(ExecutionRetryConflictError);
    expect(reason).not.toBeInstanceOf(ExecutionNotRetryableError);

    expect(await actionEventsFor(execution.id)).toHaveLength(1);
    expect(createOutboxEventMock).toHaveBeenCalledTimes(1);

    const action = await client.automationActionExecution.findUnique({
      where: { executionId_actionIndex: { executionId: execution.id, actionIndex: 1 } },
    });
    expect(action!.status).toBe('pending');
  });

  it('rolls the action and execution back when the outbox event cannot be created', async () => {
    const execution = await seedFailedFinalAction();
    createOutboxEventMock.mockRejectedValueOnce(new Error('outbox unavailable'));

    await expect(retryFailedFinalAction(execution.id, 1)).rejects.toThrow('outbox unavailable');

    const action = await client.automationActionExecution.findUnique({
      where: { executionId_actionIndex: { executionId: execution.id, actionIndex: 1 } },
    });
    expect(action!.status).toBe('failed');
    expect(action!.error).toBe('boom');

    const unchanged = await client.automationExecution.findUnique({ where: { id: execution.id } });
    expect(unchanged!.status).toBe('partial_failure');
    expect(await actionEventsFor(execution.id)).toHaveLength(0);
  });
});
