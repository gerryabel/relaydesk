import { describe, it, expect, vi, beforeEach } from 'vitest';

/**
 * Unit tests for the action execution service.
 *
 * Mocks the Prisma client via vi.mock(). The mock object is accessed inside
 * each test via dynamic import of @/lib/db/prisma (vitest returns the mocked
 * module). State-maps (_actions, _executions) are reset in beforeEach.
 */

interface MockActionExecution {
  id: string;
  executionId: string;
  actionIndex: number;
  actionType: string;
  actionConfig: unknown;
  status: string;
  error: string | null;
  startedAt: Date | null;
  completedAt: Date | null;
}

interface MockExecution {
  id: string;
  workspaceId: string;
  ticketId: string | null;
  ruleId: string;
  status: string;
}

interface MockPrisma {
  automationActionExecution: {
    findUnique: ReturnType<typeof vi.fn>;
    findFirst: ReturnType<typeof vi.fn>;
    findMany: ReturnType<typeof vi.fn>;
    update: ReturnType<typeof vi.fn>;
    updateMany: ReturnType<typeof vi.fn>;
  };
  automationExecution: {
    findUnique: ReturnType<typeof vi.fn>;
    updateMany: ReturnType<typeof vi.fn>;
  };
  outboxEvent: {
    create: ReturnType<typeof vi.fn>;
  };
  $transaction: ReturnType<typeof vi.fn>;
  _actions: Map<string, MockActionExecution>;
  _executions: Map<string, MockExecution>;
}

function makeMockPrisma(): MockPrisma {
  const actions = new Map<string, MockActionExecution>();
  const executions = new Map<string, MockExecution>();

  const mock: MockPrisma = {
    automationActionExecution: {
      findUnique: vi.fn(async ({ where }: { where: { executionId_actionIndex?: { executionId: string; actionIndex: number }; id?: string } }) => {
        if (where.executionId_actionIndex) {
          const key = `${where.executionId_actionIndex.executionId}:${where.executionId_actionIndex.actionIndex}`;
          return actions.get(key) ?? null;
        }
        if (where.id) {
          for (const action of actions.values()) {
            if (action.id === where.id) return action;
          }
        }
        return null;
      }),
      findFirst: vi.fn(async ({ where }: { where: { executionId?: string; actionIndex?: number; status?: string } }) => {
        for (const action of actions.values()) {
          if (where.executionId && action.executionId !== where.executionId) continue;
          if (where.actionIndex !== undefined && action.actionIndex !== where.actionIndex) continue;
          if (where.status && action.status !== where.status) continue;
          return action;
        }
        return null;
      }),
      findMany: vi.fn(async ({ where }: { where: { executionId?: string } }) => {
        return Array.from(actions.values()).filter(
          (a) => !where.executionId || a.executionId === where.executionId,
        );
      }),
      update: vi.fn(async ({ where, data }: { where: { id?: string }; data: Partial<MockActionExecution> }) => {
        let action: MockActionExecution | undefined;
        if (where.id) {
          for (const a of actions.values()) {
            if (a.id === where.id) {
              action = a;
              break;
            }
          }
        }
        if (!action) return { count: 0 };
        Object.assign(action, data);
        return action;
      }),
      updateMany: vi.fn(async () => ({ count: 0 })),
    },
    automationExecution: {
      findUnique: vi.fn(async ({ where }: { where: { id: string } }) => {
        return executions.get(where.id) ?? null;
      }),
      updateMany: vi.fn(async ({ where, data }: { where: { id?: string; status?: string }; data: Partial<MockExecution> }) => {
        const exec = executions.get(where.id ?? '');
        if (!exec) return { count: 0 };
        if (where.status && exec.status !== where.status) return { count: 0 };
        Object.assign(exec, data);
        return { count: 1 };
      }),
    },
    outboxEvent: {
      create: vi.fn(async () => ({ id: `outbox-${Date.now()}` })),
    },
    $transaction: vi.fn(),
    _actions: actions,
    _executions: executions,
  };

  return mock;
}

vi.mock('@/lib/db/prisma', () => {
  const mock = makeMockPrisma();
  mock.$transaction.mockImplementation(async (fn: (tx: MockPrisma) => Promise<unknown>) => fn(mock));
  return { prisma: mock as unknown as typeof import('@/generated/prisma').PrismaClient };
});

async function getMock(): Promise<MockPrisma> {
  const mod = await import('@/lib/db/prisma');
  return mod.prisma as unknown as MockPrisma;
}

async function seedExecution(id: string, workspaceId: string, ticketId: string, ruleId: string) {
  const mock = await getMock();
  mock._executions.set(id, { id, workspaceId, ticketId, ruleId, status: 'awaiting_actions' });
}

async function seedAction(
  executionId: string,
  actionIndex: number,
  actionType: string,
  actionConfig: unknown,
  status: string,
) {
  const mock = await getMock();
  mock._actions.set(`${executionId}:${actionIndex}`, {
    id: `${executionId}:action:${actionIndex}`,
    executionId,
    actionIndex,
    actionType,
    actionConfig,
    status,
    error: null,
    startedAt: null,
    completedAt: null,
  });
}

describe('executeAction', () => {
  beforeEach(async () => {
    const mock = await getMock();
    mock._actions.clear();
    mock._executions.clear();
    vi.clearAllMocks();
    // Restore $transaction implementation after clearAllMocks.
    mock.$transaction.mockImplementation(async (fn: (tx: MockPrisma) => Promise<unknown>) => fn(mock));
  });

  it('returns already-completed on redelivery (idempotency)', async () => {
    await seedExecution('exec-1', 'workspace-1', 'ticket-1', 'rule-1');
    await seedAction('exec-1', 0, 'assign', { assigneeId: 'user-1' }, 'completed');

    const { executeAction } = await import('@/lib/automation/actions/execution');
    const result = await executeAction('exec-1', 0);

    expect(result.terminal).toBe(true);
    if (result.terminal) {
      expect(result.outcome).toBe('completed');
      expect(result.detail).toBe('already-completed');
    }
    const mock = await getMock();
    expect(mock.outboxEvent.create).not.toHaveBeenCalled();
  });

  it('returns already-failed on redelivery of failed action', async () => {
    await seedExecution('exec-1', 'workspace-1', 'ticket-1', 'rule-1');
    await seedAction('exec-1', 0, 'assign', { assigneeId: 'user-1' }, 'failed');
    const mock = await getMock();
    const stored = mock._actions.get('exec-1:0')!;
    stored.error = 'some previous error';

    const { executeAction } = await import('@/lib/automation/actions/execution');
    const result = await executeAction('exec-1', 0);

    expect(result.terminal).toBe(true);
    if (result.terminal) {
      expect(result.outcome).toBe('failed');
    }
  });

  it('finalizes execution as completed when all actions succeed', async () => {
    await seedExecution('exec-1', 'workspace-1', 'ticket-1', 'rule-1');
    await seedAction('exec-1', 0, 'unassign', {}, 'pending');

    // Mock getActionHandler via vi.spyOn on the module's exports.
    const handlersMod = await import('@/lib/automation/actions/handlers');
    const spy = vi.spyOn(handlersMod, 'getActionHandler').mockReturnValue(
      async () => ({ status: 'completed', summary: 'done' }),
    );

    try {
      const { executeAction } = await import('@/lib/automation/actions/execution');
      const result = await executeAction('exec-1', 0);

      expect(result.terminal).toBe(true);
      if (result.terminal) {
        expect(result.outcome).toBe('completed');
      }

      const mock = await getMock();
      const execution = mock._executions.get('exec-1');
      expect(execution?.status).toBe('completed');
    } finally {
      spy.mockRestore();
    }
  });

  it('finalizes execution as failed when all actions fail', async () => {
    await seedExecution('exec-1', 'workspace-1', 'ticket-1', 'rule-1');
    await seedAction('exec-1', 0, 'assign', { assigneeId: 'user-x' }, 'pending');

    const handlersMod = await import('@/lib/automation/actions/handlers');
    const spy = vi.spyOn(handlersMod, 'getActionHandler').mockReturnValue(
      async () => ({ status: 'failed', error: 'not found' }),
    );

    try {
      const { executeAction } = await import('@/lib/automation/actions/execution');
      const result = await executeAction('exec-1', 0);

      expect(result.terminal).toBe(true);
      if (result.terminal) {
        expect(result.outcome).toBe('failed');
      }

      const mock = await getMock();
      const execution = mock._executions.get('exec-1');
      expect(execution?.status).toBe('failed');
    } finally {
      spy.mockRestore();
    }
  });

  it('finalizes as partial_failure when some actions fail and some succeed', async () => {
    await seedExecution('exec-1', 'workspace-1', 'ticket-1', 'rule-1');
    await seedAction('exec-1', 0, 'assign', {}, 'completed');
    await seedAction('exec-1', 1, 'set-status', { status: 'open' }, 'failed');
    await seedAction('exec-1', 2, 'unassign', {}, 'pending');

    const handlersMod = await import('@/lib/automation/actions/handlers');
    const spy = vi.spyOn(handlersMod, 'getActionHandler').mockReturnValue(
      async () => ({ status: 'completed', summary: 'done' }),
    );

    try {
      const { executeAction } = await import('@/lib/automation/actions/execution');
      const result = await executeAction('exec-1', 2);

      expect(result.terminal).toBe(true);
      if (result.terminal) {
        expect(result.outcome).toBe('completed');
      }

      const mock = await getMock();
      const execution = mock._executions.get('exec-1');
      expect(execution?.status).toBe('partial_failure');
    } finally {
      spy.mockRestore();
    }
  });

  it('schedules next action after current action completes', async () => {
    await seedExecution('exec-1', 'workspace-1', 'ticket-1', 'rule-1');
    await seedAction('exec-1', 0, 'unassign', {}, 'pending');
    await seedAction('exec-1', 1, 'set-status', { status: 'in_progress' }, 'pending');

    const handlersMod = await import('@/lib/automation/actions/handlers');
    const spy = vi.spyOn(handlersMod, 'getActionHandler').mockReturnValue(
      async () => ({ status: 'completed', summary: 'done' }),
    );

    try {
      const { executeAction } = await import('@/lib/automation/actions/execution');
      const result = await executeAction('exec-1', 0);

      expect(result.terminal).toBe(true);
      const mock = await getMock();
      expect(mock.outboxEvent.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            eventType: 'AUTOMATION_ACTION_EXECUTION',
            payload: expect.objectContaining({
              executionId: 'exec-1',
              actionIndex: 1,
            }),
          }),
        }),
      );
    } finally {
      spy.mockRestore();
    }
  });

  it('does not schedule next action before current reaches terminal state', async () => {
    await seedExecution('exec-1', 'workspace-1', 'ticket-1', 'rule-1');
    await seedAction('exec-1', 0, 'unassign', {}, 'pending');
    await seedAction('exec-1', 1, 'set-status', { status: 'in_progress' }, 'pending');

    const handlersMod = await import('@/lib/automation/actions/handlers');
    const spy = vi.spyOn(handlersMod, 'getActionHandler').mockReturnValue(
      async () => ({ status: 'retryable', error: 'transient' }),
    );

    try {
      const { executeAction } = await import('@/lib/automation/actions/execution');
      const result = await executeAction('exec-1', 0);

      expect(result.terminal).toBe(false);
      const mock = await getMock();
      expect(mock.outboxEvent.create).not.toHaveBeenCalled();
    } finally {
      spy.mockRestore();
    }
  });

  it('permanent failure of action N does not prevent action N+1', async () => {
    await seedExecution('exec-1', 'workspace-1', 'ticket-1', 'rule-1');
    await seedAction('exec-1', 0, 'assign', { assigneeId: 'user-x' }, 'pending');
    await seedAction('exec-1', 1, 'unassign', {}, 'pending');

    const handlersMod = await import('@/lib/automation/actions/handlers');
    const spy = vi.spyOn(handlersMod, 'getActionHandler').mockReturnValue(
      async () => ({ status: 'failed', error: 'not found' }),
    );

    try {
      const { executeAction } = await import('@/lib/automation/actions/execution');
      const result = await executeAction('exec-1', 0);

      expect(result.terminal).toBe(true);
      if (result.terminal) {
        expect(result.outcome).toBe('failed');
      }

      const mock = await getMock();
      expect(mock.outboxEvent.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            eventType: 'AUTOMATION_ACTION_EXECUTION',
            payload: expect.objectContaining({
              executionId: 'exec-1',
              actionIndex: 1,
            }),
          }),
        }),
      );
    } finally {
      spy.mockRestore();
    }
  });
});

describe('finalizeExecution', () => {
  beforeEach(async () => {
    const mock = await getMock();
    mock._actions.clear();
    mock._executions.clear();
    vi.clearAllMocks();
    mock.$transaction.mockImplementation(async (fn: (tx: MockPrisma) => Promise<unknown>) => fn(mock));
  });

  it('aggregates completed when all actions completed', async () => {
    await seedExecution('exec-1', 'workspace-1', 'ticket-1', 'rule-1');
    await seedAction('exec-1', 0, 'unassign', {}, 'completed');
    await seedAction('exec-1', 1, 'set-status', {}, 'completed');

    const { finalizeExecution } = await import('@/lib/automation/actions/execution');
    const mock = await getMock();
    const result = await finalizeExecution(mock as never, 'exec-1');

    expect(result.finalized).toBe(true);
    expect(result.status).toBe('completed');
  });

  it('aggregates failed when all actions failed', async () => {
    await seedExecution('exec-1', 'workspace-1', 'ticket-1', 'rule-1');
    await seedAction('exec-1', 0, 'assign', {}, 'failed');
    await seedAction('exec-1', 1, 'set-status', {}, 'failed');

    const { finalizeExecution } = await import('@/lib/automation/actions/execution');
    const mock = await getMock();
    const result = await finalizeExecution(mock as never, 'exec-1');

    expect(result.finalized).toBe(true);
    expect(result.status).toBe('failed');
  });

  it('aggregates partial_failure when mixed', async () => {
    await seedExecution('exec-1', 'workspace-1', 'ticket-1', 'rule-1');
    await seedAction('exec-1', 0, 'assign', {}, 'completed');
    await seedAction('exec-1', 1, 'set-status', {}, 'failed');

    const { finalizeExecution } = await import('@/lib/automation/actions/execution');
    const mock = await getMock();
    const result = await finalizeExecution(mock as never, 'exec-1');

    expect(result.finalized).toBe(true);
    expect(result.status).toBe('partial_failure');
  });

  it('is race-safe: concurrent finalize calls only one succeed', async () => {
    await seedExecution('exec-1', 'workspace-1', 'ticket-1', 'rule-1');
    await seedAction('exec-1', 0, 'unassign', {}, 'completed');

    const { finalizeExecution } = await import('@/lib/automation/actions/execution');
    const mock = await getMock();

    const [r1, r2] = await Promise.all([
      finalizeExecution(mock as never, 'exec-1'),
      finalizeExecution(mock as never, 'exec-1'),
    ]);

    const finalized = [r1, r2].filter((r) => r.finalized);
    expect(finalized).toHaveLength(1);
  });
});
