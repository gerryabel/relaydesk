import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import type { OutboxEventRecord } from '@/lib/outbox/types';

interface ExecutionRecord {
  id: string;
  status: string;
  skipReason: string | null;
  leasedBy: string | null;
  leasedAt: Date | null;
  sourceEventId: string;
  ruleId: string;
}

interface MockPrisma {
  automationRule: {
    findMany: ReturnType<typeof vi.fn>;
  };
  automationExecution: {
    create: ReturnType<typeof vi.fn>;
    updateMany: ReturnType<typeof vi.fn>;
    findUnique: ReturnType<typeof vi.fn>;
  };
  automationActionExecution: {
    createMany: ReturnType<typeof vi.fn>;
    count: ReturnType<typeof vi.fn>;
  };
  $transaction: ReturnType<typeof vi.fn>;
  _executions: Map<string, ExecutionRecord>;
  _resetExecutions: () => void;
}

function makeEvent(overrides: Partial<OutboxEventRecord> = {}): OutboxEventRecord {
  return {
    id: 'outbox-1',
    eventType: 'AUTOMATION_EVALUATION',
    aggregateType: 'Ticket',
    aggregateId: 'ticket-1',
    payload: {
      triggerType: 'ticket.created',
      triggerPayload: { priority: 'high' },
      automationContext: {
        causedByAutomation: false,
        actorId: 'user-1',
      },
      workspaceId: 'workspace-1',
      ticketId: 'ticket-1',
      actorId: 'user-1',
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

vi.mock('@/lib/db/prisma', () => {
  const executions = new Map<string, ExecutionRecord>();
  let executionCounter = 0;

  const mockPrisma: MockPrisma = {
    automationRule: {
      findMany: vi.fn(async () => []),
    },
    automationExecution: {
      create: vi.fn(async ({ data }: { data: { sourceEventId: string; ruleId: string; status: string; leasedBy: string; leasedAt: Date } }) => {
        executionCounter += 1;
        const id = `exec-${executionCounter}`;
        const record: ExecutionRecord = {
          id,
          status: data.status,
          skipReason: null,
          leasedBy: data.leasedBy,
          leasedAt: data.leasedAt,
          sourceEventId: data.sourceEventId,
          ruleId: data.ruleId,
        };
        executions.set(id, record);
        return record;
      }),
      updateMany: vi.fn(async ({ where, data }: { where: { id: string; status: string; leasedBy: string; leasedAt: { gt: Date } }; data: { status: string; skipReason?: string; leasedBy: null; leasedAt: null } }) => {
        const record = executions.get(where.id);
        if (!record) return { count: 0 };
        if (record.status !== where.status) return { count: 0 };
        if (record.leasedBy !== where.leasedBy) return { count: 0 };
        if (!record.leasedAt || record.leasedAt.getTime() <= where.leasedAt.gt.getTime()) return { count: 0 };
        record.status = data.status;
        if (data.skipReason !== undefined) record.skipReason = data.skipReason;
        record.leasedBy = data.leasedBy;
        record.leasedAt = data.leasedAt;
        executions.set(where.id, record);
        return { count: 1 };
      }),
      findUnique: vi.fn(async ({ where }: { where: { id: string } }) => {
        return executions.get(where.id) ?? null;
      }),
    },
    automationActionExecution: {
      createMany: vi.fn(async () => { return { count: 0 }; }),
      count: vi.fn(async () => 0),
    },
    $transaction: vi.fn(async (fn: (tx: unknown) => Promise<unknown>) => {
      return fn(mockPrisma);
    }),
    _executions: executions,
    _resetExecutions: () => {
      executions.clear();
      executionCounter = 0;
    },
  };

  return { prisma: mockPrisma as unknown as typeof import('@/generated/prisma').PrismaClient };
});

describe('handleAutomationEvaluation', () => {
  let findManyRules: ReturnType<typeof vi.fn>;
  let createExecution: ReturnType<typeof vi.fn>;
  let updateManyExecution: ReturnType<typeof vi.fn>;
  let findUniqueExecution: ReturnType<typeof vi.fn>;

  beforeEach(async () => {
    const prismaModule = await import('@/lib/db/prisma');
    const mockPrisma = prismaModule.prisma as unknown as MockPrisma;
    findManyRules = mockPrisma.automationRule.findMany;
    createExecution = mockPrisma.automationExecution.create;
    updateManyExecution = mockPrisma.automationExecution.updateMany;
    findUniqueExecution = mockPrisma.automationExecution.findUnique;

    findManyRules.mockClear();
    createExecution.mockClear();
    updateManyExecution.mockClear();
    findUniqueExecution.mockClear();
    mockPrisma._resetExecutions();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('skips events caused by automation (recursion prevention)', async () => {
    const { handleAutomationEvaluation } = await import('@/lib/queue/handlers/automation');
    const event = makeEvent({
      payload: {
        triggerType: 'ticket.created',
        triggerPayload: {},
        automationContext: {
          causedByAutomation: true,
          ruleId: 'rule-1',
          executionId: 'exec-1',
          actionIndex: 0,
          actorId: 'user-1',
        },
        workspaceId: 'workspace-1',
        ticketId: 'ticket-1',
        actorId: 'user-1',
      },
    });

    const result = await handleAutomationEvaluation(event);

    expect(result).toEqual({ status: 'success' });
    expect(findManyRules).not.toHaveBeenCalled();
    expect(createExecution).not.toHaveBeenCalled();
  });

  it('returns success when no rules match the trigger type', async () => {
    findManyRules.mockResolvedValue([]);

    const { handleAutomationEvaluation } = await import('@/lib/queue/handlers/automation');
    const event = makeEvent();

    const result = await handleAutomationEvaluation(event);

    expect(result).toEqual({ status: 'success' });
    expect(findManyRules).toHaveBeenCalledTimes(1);
    expect(createExecution).not.toHaveBeenCalled();
  });

  it('skips matching rule with zero actions and sets skipReason=no_actions', async () => {
    findManyRules.mockResolvedValue([
      {
        id: 'rule-1',
        workspaceId: 'workspace-1',
        name: 'Zero-Action Rule',
        enabled: true,
        triggerType: 'ticket.created',
        conditions: [{ field: 'priority', operator: 'equals', value: 'high' }],
        actions: [],
      },
    ]);

    const { handleAutomationEvaluation } = await import('@/lib/queue/handlers/automation');
    const event = makeEvent();

    const result = await handleAutomationEvaluation(event);

    expect(result).toEqual({ status: 'success' });
    expect(createExecution).toHaveBeenCalledTimes(1);
    expect(updateManyExecution).toHaveBeenCalledTimes(1);

    // Verify the update was to skip with no_actions reason
    const updateCall = updateManyExecution.mock.calls[0][0];
    expect(updateCall.data.status).toBe('skipped');
    expect(updateCall.data.skipReason).toBe('no_actions');
    expect(updateCall.data.leasedBy).toBeNull();
    expect(updateCall.data.leasedAt).toBeNull();
  });

  it('zero-action execution never enters awaiting_actions', async () => {
    findManyRules.mockResolvedValue([
      {
        id: 'rule-1',
        workspaceId: 'workspace-1',
        name: 'Zero-Action Rule',
        enabled: true,
        triggerType: 'ticket.created',
        conditions: [{ field: 'priority', operator: 'equals', value: 'high' }],
        actions: [],
      },
    ]);

    const { handleAutomationEvaluation } = await import('@/lib/queue/handlers/automation');
    const event = makeEvent();

    await handleAutomationEvaluation(event);

    // Check that updateMany was never called with status=awaiting_actions
    for (const call of updateManyExecution.mock.calls) {
      if (call[0]?.data?.status) {
        expect(call[0].data.status).not.toBe('awaiting_actions');
      }
    }

    // Verify the final execution state from internal map
    const prismaModule = await import('@/lib/db/prisma');
    const mockPrisma = prismaModule.prisma as unknown as MockPrisma;
    const execs = mockPrisma._executions;
    const allStates = Array.from(execs.values()).map(e => e.status);
    expect(allStates).toContain('skipped');
    expect(allStates).not.toContain('awaiting_actions');
  });

  it('zero-action execution lease is released after skip', async () => {
    findManyRules.mockResolvedValue([
      {
        id: 'rule-1',
        workspaceId: 'workspace-1',
        name: 'Zero-Action Rule',
        enabled: true,
        triggerType: 'ticket.created',
        conditions: [{ field: 'priority', operator: 'equals', value: 'high' }],
        actions: [],
      },
    ]);

    const { handleAutomationEvaluation } = await import('@/lib/queue/handlers/automation');
    const event = makeEvent();

    await handleAutomationEvaluation(event);

    const updateCall = updateManyExecution.mock.calls[0][0];
    expect(updateCall.data.leasedBy).toBeNull();
    expect(updateCall.data.leasedAt).toBeNull();
  });

  it('expired/stale evaluator cannot perform the skip transition', async () => {
    findManyRules.mockResolvedValue([
      {
        id: 'rule-1',
        workspaceId: 'workspace-1',
        name: 'Zero-Action Rule',
        enabled: true,
        triggerType: 'ticket.created',
        conditions: [{ field: 'priority', operator: 'equals', value: 'high' }],
        actions: [],
      },
    ]);

    // Make updateMany simulate an expired/stale lease (count = 0)
    updateManyExecution.mockResolvedValue({ count: 0 });

    const { handleAutomationEvaluation } = await import('@/lib/queue/handlers/automation');
    const event = makeEvent();

    // The handler catches skipExecution failure and returns retryable failure
    const result = await handleAutomationEvaluation(event);
    expect(result).toEqual({
      status: 'failure',
      error: {
        message: expect.stringContaining('Cannot skip execution'),
        retryable: true,
      },
    });

    // Verify updateMany was attempted with lease fence
    const updateCall = updateManyExecution.mock.calls[0][0];
    expect(updateCall.where.status).toBe('evaluating');
    expect(updateCall.where.leasedAt).toEqual({ gt: expect.any(Date) });
  });
});
