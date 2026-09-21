import { describe, it, expect, vi, beforeEach } from 'vitest';
import { RuleValidationError } from '@/lib/automation/rules';

// vi.hoisted gives us references that are available inside vi.mock factories,
// which are hoisted above all other statements (including the const
// declarations below). Without this, the factory would observe the
// declarations in their temporal dead zone. The entire prismaMock object is
// built here so the vi.mock factory can reference it without TDZ issues.
// Helper to simulate Prisma's P2002 unique-constraint error.
function uniqueConstraintError(): Error {
  return Object.assign(new Error('Unique constraint failed'), { code: 'P2002' });
}

const hoisted = vi.hoisted(() => {
  const executions = new Map<string, StoredExecution>();
  const findManyMock = vi.fn((): Promise<unknown[]> => Promise.resolve([]));
  const completeHandoffMock = vi.fn();

  const prismaMock = {
    automationRule: {
      findMany: findManyMock,
    },
    automationExecution: {
      create: vi.fn((args: { data: Omit<StoredExecution, 'id'> }) => {
        const { data } = args;
        for (const existing of executions.values()) {
          if (existing.sourceEventId === data.sourceEventId && existing.ruleId === data.ruleId) {
            throw uniqueConstraintError();
          }
        }
        const id = `exec-${executions.size + 1}`;
        const row: StoredExecution = { id, ...data };
        executions.set(id, row);
        return Promise.resolve(row);
      }),
      findFirst: vi.fn((args: { where: { sourceEventId: string; ruleId: string } }) => {
        for (const existing of executions.values()) {
          if (existing.sourceEventId === args.where.sourceEventId && existing.ruleId === args.where.ruleId) {
            return Promise.resolve(existing);
          }
        }
        return Promise.resolve(null);
      }),
      updateMany: vi.fn((args: { where: Record<string, unknown>; data: Record<string, unknown> }) => {
        const id = args.where.id as string | undefined;
        if (!id) return Promise.resolve({ count: 0 });
        const row = executions.get(id);
        if (!row) return Promise.resolve({ count: 0 });

        const where = args.where as {
          leasedBy?: string;
          leasedAt?: { gt?: Date; lte?: Date };
          status?: { in?: string[] };
          OR?: Array<Record<string, unknown>>;
        };

        if (where.status?.in && !where.status.in.includes(row.status)) {
          return Promise.resolve({ count: 0 });
        }
        if (where.leasedBy !== undefined && where.leasedBy !== row.leasedBy) {
          return Promise.resolve({ count: 0 });
        }
        if (where.leasedAt?.gt !== undefined && !(row.leasedAt && row.leasedAt > where.leasedAt.gt)) {
          return Promise.resolve({ count: 0 });
        }
        if (where.OR) {
          const orMatches = where.OR.some((clause) => {
            if ('leasedBy' in clause && clause.leasedBy === null && row.leasedBy === null) return true;
            if ('leasedAt' in clause && clause.leasedAt === null && row.leasedAt === null) return true;
            if (
              'leasedAt' in clause &&
              typeof clause.leasedAt === 'object' &&
              clause.leasedAt !== null &&
              'lte' in clause.leasedAt &&
              row.leasedAt !== null &&
              row.leasedAt <= (clause.leasedAt as { lte: Date }).lte
            ) {
              return true;
            }
            return false;
          });
          if (!orMatches) return Promise.resolve({ count: 0 });
        }

        Object.assign(row, args.data);
        return Promise.resolve({ count: 1 });
      }),
    },
  };

  return { executions, findManyMock, completeHandoffMock, prismaMock };
});

// ---------------------------------------------------------------------------
// Unit tests for the multi-rule evaluator orchestration and the
// retry/idempotency reclaim logic in
// src/lib/queue/handlers/automation.ts.
//
// These tests run against a mocked Prisma client (no DB required) and prove
// the exact scenario from the bug report:
//   1. execution is created
//   2. handoff fails transiently
//   3. handler returns retryable
//   4. source-event retry reuses/reclaims the existing execution
//   5. handoff succeeds on retry
//   6. already-completed execution remains skipped and is not duplicated
// ---------------------------------------------------------------------------

// In-memory store of automation executions keyed by id, so the mocked
// Prisma client can simulate P2002 on (sourceEventId, ruleId) and
// lease-fenced updateMany transitions.
type StoredExecution = {
  id: string;
  workspaceId: string;
  ruleId: string;
  ruleNameSnapshot: string;
  sourceEventType: string;
  sourceEventId: string;
  sourceAggregateId: string;
  ticketId: string;
  status: string;
  leasedBy: string | null;
  leasedAt: Date | null;
  error: string | null;
};

const executions = hoisted.executions;
const findManyMock = hoisted.findManyMock;
const completeHandoffMock = hoisted.completeHandoffMock;

function resetStore() {
  executions.clear();
}

// Reference hoisted.prismaMock directly: the vi.mock factory runs at hoist
// time, before `const` bindings below are initialized. Going through the
// hoisted object avoids the temporal dead zone.
vi.mock('@/lib/db/prisma', () => ({
  prisma: hoisted.prismaMock,
}));

// Mock execution-service so completeHandoff is controllable per-test.
vi.mock('@/lib/automation/execution-service', () => ({
  completeHandoff: (...args: unknown[]) => completeHandoffMock(...args),
  skipExecution: vi.fn((id: string) =>
    Promise.resolve({ id, status: 'skipped' }),
  ),
  DEFAULT_EXECUTION_LEASE_MS: 5 * 60 * 1000,
}));

describe('automation evaluator multi-rule (unit)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    resetStore();
    // Default: one matching rule so the handler enters the per-rule loop.
    findManyMock.mockResolvedValue([
      {
        id: 'rule-1',
        workspaceId: 'w-1',
        name: 'Rule 1',
        enabled: true,
        triggerType: 'ticket.created',
        conditions: [{ field: 'priority', operator: 'equals', value: 'high' }],
        actions: [{ actionType: 'unassign', actionConfig: {} }],
      },
    ]);
  });

  it('findMatchingRules returns all matching rules', async () => {
    const { findMatchingRules } = await import('@/lib/automation/evaluator');
    const context = {
      triggerType: 'ticket.created' as const,
      triggerPayload: { priority: 'high' },
      ticketId: 't-1',
      workspaceId: 'w-1',
      actorId: null,
    };
    const rules = [
      {
        id: 'r1',
        workspaceId: 'w-1',
        name: 'Rule 1',
        enabled: true,
        triggerType: 'ticket.created',
        conditions: [{ field: 'priority', operator: 'equals', value: 'high' }],
        actions: [{ actionType: 'unassign', actionConfig: {} }],
      },
      {
        id: 'r2',
        workspaceId: 'w-1',
        name: 'Rule 2',
        enabled: true,
        triggerType: 'ticket.created',
        conditions: [{ field: 'priority', operator: 'equals', value: 'low' }],
        actions: [],
      },
    ];
    const matched = findMatchingRules(rules, context);
    expect(matched).toHaveLength(1);
    expect(matched[0].id).toBe('r1');
  });

  it('findMatchingRules returns empty when no rules match', async () => {
    const { findMatchingRules } = await import('@/lib/automation/evaluator');
    const context = {
      triggerType: 'ticket.created' as const,
      triggerPayload: { priority: 'low' },
      ticketId: 't-1',
      workspaceId: 'w-1',
      actorId: null,
    };
    const rules = [
      {
        id: 'r1',
        workspaceId: 'w-1',
        name: 'Rule 1',
        enabled: true,
        triggerType: 'ticket.created',
        conditions: [{ field: 'priority', operator: 'equals', value: 'high' }],
        actions: [],
      },
    ];
    const matched = findMatchingRules(rules, context);
    expect(matched).toHaveLength(0);
  });

  // -------------------------------------------------------------------------
  // Retry / idempotency reclaim tests (the bug-report scenario).
  // -------------------------------------------------------------------------

  it('reclaims a transient-failed execution on retry and hands off successfully', async () => {
    const { handleAutomationEvaluation } = await import('@/lib/queue/handlers/automation');

    const event = {
      id: 'evt-1',
      eventType: 'ticket.created',
      payload: {
        triggerType: 'ticket.created',
        triggerPayload: { priority: 'high' },
        automationContext: { causedByAutomation: false, actorId: null },
        workspaceId: 'w-1',
        ticketId: 't-1',
        actorId: null,
      },
    } as unknown as Parameters<typeof handleAutomationEvaluation>[0];

    // First attempt: handoff throws a transient error.
    completeHandoffMock.mockRejectedValueOnce(new Error('transient: connection reset'));

    const firstResult = await handleAutomationEvaluation(event);

    // 1+3. Handler returns retryable failure.
    expect(firstResult?.status).toBe('failure');
    expect(firstResult?.status === 'failure' && firstResult?.error.retryable).toBe(true);

    // 1. Exactly one execution row was created (no duplicate).
    expect(executions.size).toBe(1);
    const stored = [...executions.values()][0];
    expect(stored.status).toBe('failed');
    expect(stored.leasedBy).toBeNull();
    expect(stored.leasedAt).toBeNull();
    // Transient failure → no [permanent] prefix.
    expect(stored.error).not.toContain('[permanent]');

    // Second attempt (same event.id, simulating BullMQ retry): handoff succeeds.
    completeHandoffMock.mockResolvedValueOnce({ id: stored.id, status: 'awaiting_actions' });

    const secondResult = await handleAutomationEvaluation(event);

    // 5. Handoff succeeds on retry → overall success.
    expect(secondResult?.status).toBe('success');

    // 4. Still exactly one execution row — the existing one was reclaimed,
    //    not duplicated.
    expect(executions.size).toBe(1);
    expect(completeHandoffMock).toHaveBeenCalledTimes(2);
  });

  it('skips a permanent-failed execution on retry (does not reclaim)', async () => {
    const { handleAutomationEvaluation, classifyExistingExecution } = await import(
      '@/lib/queue/handlers/automation'
    );

    const event = {
      id: 'evt-2',
      eventType: 'ticket.created',
      payload: {
        triggerType: 'ticket.created',
        triggerPayload: { priority: 'high' },
        automationContext: { causedByAutomation: false, actorId: null },
        workspaceId: 'w-1',
        ticketId: 't-1',
        actorId: null,
      },
    } as unknown as Parameters<typeof handleAutomationEvaluation>[0];

    // First attempt: handoff throws a permanent (validation) error.
    completeHandoffMock.mockRejectedValueOnce(new RuleValidationError('invalid rule config', ['bad config']));

    const firstResult = await handleAutomationEvaluation(event);
    // Permanent failures are recorded on the execution but do NOT bubble up
    // as a retryable overall failure — the handler returns success (the
    // failure is terminal and observable on the execution row).
    expect(firstResult?.status).toBe('success');

    const stored = [...executions.values()][0];
    expect(stored.status).toBe('failed');
    expect(stored.error).toContain('[permanent]');

    // Sanity-check the classifier directly.
    expect(
      classifyExistingExecution({
        status: 'failed',
        leasedBy: null,
        leasedAt: null,
        error: stored.error,
      }),
    ).toBe('skip');

    // Second attempt: handoff would succeed if called — it must NOT be called.
    completeHandoffMock.mockResolvedValueOnce({ id: stored.id, status: 'awaiting_actions' });

    const secondResult = await handleAutomationEvaluation(event);

    // 6. Permanent failure remains terminal → success (nothing to do), no
    //    duplicate, handoff not re-invoked.
    expect(secondResult?.status).toBe('success');
    expect(executions.size).toBe(1);
    expect(completeHandoffMock).toHaveBeenCalledTimes(1); // only the first attempt
  });

  it('skips an already-completed execution on retry (idempotent)', async () => {
    const { handleAutomationEvaluation } = await import('@/lib/queue/handlers/automation');

    const event = {
      id: 'evt-3',
      eventType: 'ticket.created',
      payload: {
        triggerType: 'ticket.created',
        triggerPayload: { priority: 'high' },
        automationContext: { causedByAutomation: false, actorId: null },
        workspaceId: 'w-1',
        ticketId: 't-1',
        actorId: null,
      },
    } as unknown as Parameters<typeof handleAutomationEvaluation>[0];

    // First attempt: handoff succeeds.
    completeHandoffMock.mockResolvedValueOnce({ id: 'exec-1', status: 'awaiting_actions' });

    const firstResult = await handleAutomationEvaluation(event);
    expect(firstResult?.status).toBe('success');
    expect(executions.size).toBe(1);

    // Second attempt: the create hits P2002, the existing row is
    // 'awaiting_actions' → skip. completeHandoff must NOT be called again.
    completeHandoffMock.mockResolvedValueOnce({ id: 'exec-1', status: 'awaiting_actions' });

    const secondResult = await handleAutomationEvaluation(event);
    expect(secondResult?.status).toBe('success');
    expect(executions.size).toBe(1); // no duplicate
    expect(completeHandoffMock).toHaveBeenCalledTimes(1); // only the first attempt
  });

  it('skips an actively-leased evaluating execution (another worker owns it)', async () => {
    const { classifyExistingExecution } = await import('@/lib/queue/handlers/automation');

    // Pre-seed an execution held by another worker with a future lease.
    const futureLease = new Date(Date.now() + 60_000);
    executions.set('exec-pre', {
      id: 'exec-pre',
      workspaceId: 'w-1',
      ruleId: 'rule-1',
      ruleNameSnapshot: 'Rule 1',
      sourceEventType: 'ticket.created',
      sourceEventId: 'evt-4',
      sourceAggregateId: 't-1',
      ticketId: 't-1',
      status: 'evaluating',
      leasedBy: 'other-worker',
      leasedAt: futureLease,
      error: null,
    });

    expect(
      classifyExistingExecution({
        status: 'evaluating',
        leasedBy: 'other-worker',
        leasedAt: futureLease,
        error: null,
      }),
    ).toBe('skip');
  });

  it('classifyExistingExecution table: covers all status/lease/error combinations', async () => {
    const { classifyExistingExecution } = await import('@/lib/queue/handlers/automation');

    const future = new Date(Date.now() + 60_000);
    const past = new Date(Date.now() - 60_000);

    // Permanent failed → skip.
    expect(
      classifyExistingExecution({
        status: 'failed',
        leasedBy: null,
        leasedAt: null,
        error: '[permanent] bad config',
      }),
    ).toBe('skip');

    // Transient failed, no lease → reclaim.
    expect(
      classifyExistingExecution({
        status: 'failed',
        leasedBy: null,
        leasedAt: null,
        error: 'connection reset',
      }),
    ).toBe('reclaim');

    // Transient failed, expired lease → reclaim.
    expect(
      classifyExistingExecution({
        status: 'failed',
        leasedBy: 'old-worker',
        leasedAt: past,
        error: 'connection reset',
      }),
    ).toBe('reclaim');

    // Evaluating with active lease → skip.
    expect(
      classifyExistingExecution({
        status: 'evaluating',
        leasedBy: 'other-worker',
        leasedAt: future,
        error: null,
      }),
    ).toBe('skip');

    // Evaluating with expired lease → reclaim (stranded).
    expect(
      classifyExistingExecution({
        status: 'evaluating',
        leasedBy: 'old-worker',
        leasedAt: past,
        error: null,
      }),
    ).toBe('reclaim');

    // Evaluating with no lease → reclaim.
    expect(
      classifyExistingExecution({
        status: 'evaluating',
        leasedBy: null,
        leasedAt: null,
        error: null,
      }),
    ).toBe('reclaim');

    // Terminal success states → skip.
    for (const status of ['awaiting_actions', 'executing', 'completed', 'skipped'] as const) {
      expect(
        classifyExistingExecution({
          status,
          leasedBy: null,
          leasedAt: null,
          error: null,
        }),
      ).toBe('skip');
    }

    // Partial failure → skip.
    expect(
      classifyExistingExecution({
        status: 'partial_failure',
        leasedBy: null,
        leasedAt: null,
        error: null,
      }),
    ).toBe('skip');
  });
});
