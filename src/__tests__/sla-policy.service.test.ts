import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { prisma } from '@/lib/db/prisma';
import type { Prisma } from '@/generated/prisma';
import {
  getWorkspaceSlaPolicies,
  updateWorkspaceSlaPolicies,
  getWorkspaceSlaPolicy,
  buildDefaultSlaPolicyData,
  SlaPolicyNotFoundError,
  SlaPolicyInvariantError,
} from '@/lib/workspace/sla-policy';
import {
  assertWorkspaceOwner,
  getCurrentMembership,
  ForbiddenError,
  UnauthorizedError,
} from '@/lib/workspace/server';

vi.mock('@/lib/auth/session', () => ({
  getServerAuthSession: vi.fn(),
}));

vi.mock('@/lib/workspace/server', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/workspace/server')>();
  return {
    ...actual,
    getCurrentMembership: vi.fn(),
    assertWorkspaceOwner: vi.fn(),
  };
});

vi.mock('@/lib/db/prisma', () => ({
  prisma: {
    workspaceSlaPolicy: {
      findMany: vi.fn(),
      update: vi.fn(),
      findUnique: vi.fn(),
      createMany: vi.fn(),
    },
    $transaction: vi.fn(),
  },
}));

const mockedGetCurrentMembership = vi.mocked(getCurrentMembership);
const mockedAssertWorkspaceOwner = vi.mocked(assertWorkspaceOwner);
const mockedFindMany = vi.mocked(prisma.workspaceSlaPolicy.findMany);
const mockedUpdate = vi.mocked(prisma.workspaceSlaPolicy.update);
const mockedFindUnique = vi.mocked(prisma.workspaceSlaPolicy.findUnique);
const mockedTransaction = vi.mocked(prisma.$transaction);

const fakeSessionMembership = {
  id: 'membership-self',
  userId: 'user-123',
  workspaceId: 'workspace-123',
  role: 'owner' as const,
  createdAt: new Date('2025-01-01T00:00:00Z'),
  updatedAt: new Date('2025-01-01T00:00:00Z'),
  workspace: {
    id: 'workspace-123',
    name: 'Workspace 123',
    createdAt: new Date('2025-01-01T00:00:00Z'),
    updatedAt: new Date('2025-01-01T00:00:00Z'),
  },
};

function mockFourPolicies(workspaceId: string, overrides: Record<string, { response: number; resolution: number }> = {}) {
  const defaults: Record<string, { response: number; resolution: number }> = {
    low: { response: 1440, resolution: 7200 },
    medium: { response: 480, resolution: 4320 },
    high: { response: 240, resolution: 1440 },
    urgent: { response: 60, resolution: 240 },
  };
  return (['low', 'medium', 'high', 'urgent'] as const).map((priority) => ({
    priority,
    responseMinutes: overrides[priority]?.response ?? defaults[priority].response,
    resolutionMinutes: overrides[priority]?.resolution ?? defaults[priority].resolution,
    workspaceId,
  }));
}

beforeEach(() => {
  vi.restoreAllMocks();
  mockedGetCurrentMembership.mockReset();
  mockedAssertWorkspaceOwner.mockReset();
  mockedFindMany.mockReset();
  mockedUpdate.mockReset();
  mockedFindUnique.mockReset();
  mockedTransaction.mockReset();
});

afterEach(() => {
  vi.useRealTimers();
});

describe('getWorkspaceSlaPolicies — read', () => {
  it('member can read own workspace policy', async () => {
    mockedGetCurrentMembership.mockResolvedValueOnce(fakeSessionMembership as never);
    mockedFindMany.mockResolvedValueOnce(mockFourPolicies('workspace-123') as never);

    const result = await getWorkspaceSlaPolicies();

    expect(mockedFindMany).toHaveBeenCalledWith({
      where: { workspaceId: 'workspace-123' },
      select: { priority: true, responseMinutes: true, resolutionMinutes: true },
    });
    expect(result).toHaveLength(4);
    expect(result.map((row) => row.priority)).toEqual(['low', 'medium', 'high', 'urgent']);
  });

  it('rejects unauthenticated read', async () => {
    mockedGetCurrentMembership.mockRejectedValueOnce(
      new UnauthorizedError('No authenticated session'),
    );

    await expect(getWorkspaceSlaPolicies()).rejects.toThrow(UnauthorizedError);
    expect(mockedFindMany).not.toHaveBeenCalled();
  });

  it('rejects read when no workspace membership', async () => {
    mockedGetCurrentMembership.mockRejectedValueOnce(
      new ForbiddenError('No workspace membership found'),
    );

    await expect(getWorkspaceSlaPolicies()).rejects.toThrow(ForbiddenError);
    expect(mockedFindMany).not.toHaveBeenCalled();
  });

  it('throws invariant error when a policy row is missing — no silent fallback', async () => {
    mockedGetCurrentMembership.mockResolvedValueOnce(fakeSessionMembership as never);
    const incomplete = mockFourPolicies('workspace-123').slice(0, 3);
    mockedFindMany.mockResolvedValueOnce(incomplete as never);

    await expect(getWorkspaceSlaPolicies()).rejects.toThrow(SlaPolicyInvariantError);
  });

  it('throws invariant error when an extra row exists', async () => {
    mockedGetCurrentMembership.mockResolvedValueOnce(fakeSessionMembership as never);
    const extra = [
      ...mockFourPolicies('workspace-123'),
      { priority: 'low', responseMinutes: 1, resolutionMinutes: 1, workspaceId: 'workspace-123' },
    ];
    mockedFindMany.mockResolvedValueOnce(extra as never);

    await expect(getWorkspaceSlaPolicies()).rejects.toThrow(SlaPolicyInvariantError);
  });

  it('reads the authenticated user workspace — never a client id', async () => {
    mockedGetCurrentMembership.mockResolvedValueOnce(fakeSessionMembership as never);
    mockedFindMany.mockResolvedValueOnce(mockFourPolicies('workspace-123') as never);

    await getWorkspaceSlaPolicies();

    expect(mockedFindMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { workspaceId: 'workspace-123' } }),
    );
  });
});

describe('updateWorkspaceSlaPolicies — authorization', () => {
  it('rejects unauthenticated update', async () => {
    mockedAssertWorkspaceOwner.mockRejectedValueOnce(
      new UnauthorizedError('No authenticated session'),
    );

    await expect(
      updateWorkspaceSlaPolicies([
        { priority: 'low', responseMinutes: 1440, resolutionMinutes: 7200 },
        { priority: 'medium', responseMinutes: 480, resolutionMinutes: 4320 },
        { priority: 'high', responseMinutes: 240, resolutionMinutes: 1440 },
        { priority: 'urgent', responseMinutes: 60, resolutionMinutes: 240 },
      ]),
    ).rejects.toThrow(UnauthorizedError);
    expect(mockedTransaction).not.toHaveBeenCalled();
  });

  it('rejects non-owner update', async () => {
    mockedAssertWorkspaceOwner.mockRejectedValueOnce(
      new ForbiddenError('Only workspace owners can perform this action.'),
    );

    await expect(
      updateWorkspaceSlaPolicies([
        { priority: 'low', responseMinutes: 1440, resolutionMinutes: 7200 },
        { priority: 'medium', responseMinutes: 480, resolutionMinutes: 4320 },
        { priority: 'high', responseMinutes: 240, resolutionMinutes: 1440 },
        { priority: 'urgent', responseMinutes: 60, resolutionMinutes: 240 },
      ]),
    ).rejects.toThrow(ForbiddenError);
    expect(mockedTransaction).not.toHaveBeenCalled();
  });

  it('allows owner update', async () => {
    mockedAssertWorkspaceOwner.mockResolvedValueOnce(fakeSessionMembership as never);
    mockedTransaction.mockImplementation(async (worker: (tx: Prisma.TransactionClient) => Promise<unknown>) => {
      const tx = {
        workspaceSlaPolicy: {
          update: vi.fn().mockResolvedValue({} as never),
        },
      };
      return worker(tx as unknown as Prisma.TransactionClient);
    });

    await updateWorkspaceSlaPolicies([
      { priority: 'low', responseMinutes: 1440, resolutionMinutes: 7200 },
      { priority: 'medium', responseMinutes: 480, resolutionMinutes: 4320 },
      { priority: 'high', responseMinutes: 240, resolutionMinutes: 1440 },
      { priority: 'urgent', responseMinutes: 60, resolutionMinutes: 240 },
    ]);

    expect(mockedTransaction).toHaveBeenCalledTimes(1);
  });

  it('client workspaceId cannot cross tenant boundary — uses membership workspace only', async () => {
    mockedAssertWorkspaceOwner.mockResolvedValueOnce(fakeSessionMembership as never);
    const updateSpy = vi.fn().mockResolvedValue({} as never);
    mockedTransaction.mockImplementation(async (worker: (tx: Prisma.TransactionClient) => Promise<unknown>) => {
      const tx = { workspaceSlaPolicy: { update: updateSpy } };
      return worker(tx as unknown as Prisma.TransactionClient);
    });

    await updateWorkspaceSlaPolicies([
      { priority: 'low', responseMinutes: 1440, resolutionMinutes: 7200 },
      { priority: 'medium', responseMinutes: 480, resolutionMinutes: 4320 },
      { priority: 'high', responseMinutes: 240, resolutionMinutes: 1440 },
      { priority: 'urgent', responseMinutes: 60, resolutionMinutes: 240 },
    ]);

    expect(updateSpy).toHaveBeenCalledTimes(4);
    for (const call of updateSpy.mock.calls) {
      expect(call[0]).toEqual(
        expect.objectContaining({
          where: expect.objectContaining({
            workspaceId_priority: expect.objectContaining({ workspaceId: 'workspace-123' }),
          }),
        }),
      );
    }
  });

  it('updates all four policies atomically inside a single transaction', async () => {
    mockedAssertWorkspaceOwner.mockResolvedValueOnce(fakeSessionMembership as never);
    mockedTransaction.mockImplementation(async (worker: (tx: Prisma.TransactionClient) => Promise<unknown>) => {
      const tx = {
        workspaceSlaPolicy: {
          update: vi.fn().mockResolvedValue({} as never),
        },
      };
      return worker(tx as unknown as Prisma.TransactionClient);
    });

    await updateWorkspaceSlaPolicies([
      { priority: 'low', responseMinutes: 2880, resolutionMinutes: 14400 },
      { priority: 'medium', responseMinutes: 960, resolutionMinutes: 8640 },
      { priority: 'high', responseMinutes: 480, resolutionMinutes: 2880 },
      { priority: 'urgent', responseMinutes: 120, resolutionMinutes: 480 },
    ]);

    expect(mockedTransaction).toHaveBeenCalledTimes(1);
  });
});

describe('getWorkspaceSlaPolicy — internal ticket-creation lookup', () => {
  it('returns the policy row for the requested priority', async () => {
    const row = { priority: 'high' as const, responseMinutes: 240, resolutionMinutes: 1440 };
    mockedFindUnique.mockResolvedValueOnce(row as never);

    const result = await getWorkspaceSlaPolicy(
      prisma,
      'workspace-123',
      'high',
    );

    expect(mockedFindUnique).toHaveBeenCalledWith({
      where: { workspaceId_priority: { workspaceId: 'workspace-123', priority: 'high' } },
    });
    expect(result.priority).toBe('high');
    expect(result.responseMinutes).toBe(240);
    expect(result.resolutionMinutes).toBe(1440);
  });

  it('throws SlaPolicyNotFoundError when the row is missing — no default fallback', async () => {
    mockedFindUnique.mockResolvedValueOnce(null as never);

    await expect(
      getWorkspaceSlaPolicy(prisma, 'workspace-123', 'medium'),
    ).rejects.toThrow(SlaPolicyNotFoundError);
  });

  it('uses the supplied transaction-capable client', async () => {
    const row = { priority: 'urgent' as const, responseMinutes: 60, resolutionMinutes: 240 };
    const txFindUnique = vi.fn().mockResolvedValue(row);

    const result = await getWorkspaceSlaPolicy(
      { workspaceSlaPolicy: { findUnique: txFindUnique } } as never,
      'workspace-123',
      'urgent',
    );

    expect(txFindUnique).toHaveBeenCalledWith({
      where: { workspaceId_priority: { workspaceId: 'workspace-123', priority: 'urgent' } },
    });
    expect(result.responseMinutes).toBe(60);
  });
});

describe('database error propagation', () => {
  it('propagates database errors on read instead of returning defaults', async () => {
    mockedGetCurrentMembership.mockResolvedValueOnce(fakeSessionMembership as never);
    mockedFindMany.mockRejectedValueOnce(new Error('connection reset'));

    await expect(getWorkspaceSlaPolicies()).rejects.toThrow('connection reset');
  });

  it('propagates database errors on update instead of returning defaults', async () => {
    mockedAssertWorkspaceOwner.mockResolvedValueOnce(fakeSessionMembership as never);
    mockedTransaction.mockRejectedValueOnce(new Error('deadlock detected'));

    await expect(
      updateWorkspaceSlaPolicies([
        { priority: 'low', responseMinutes: 1440, resolutionMinutes: 7200 },
        { priority: 'medium', responseMinutes: 480, resolutionMinutes: 4320 },
        { priority: 'high', responseMinutes: 240, resolutionMinutes: 1440 },
        { priority: 'urgent', responseMinutes: 60, resolutionMinutes: 240 },
      ]),
    ).rejects.toThrow('deadlock detected');
  });
});

describe('buildDefaultSlaPolicyData', () => {
  it('builds exactly four rows matching canonical defaults for a new workspace', () => {
    const data = buildDefaultSlaPolicyData('workspace-new');
    expect(data).toHaveLength(4);
    const byPriority = Object.fromEntries(data.map((row) => [row.priority, row]));
    expect(byPriority.low.responseMinutes).toBe(1440);
    expect(byPriority.low.resolutionMinutes).toBe(7200);
    expect(byPriority.medium.responseMinutes).toBe(480);
    expect(byPriority.medium.resolutionMinutes).toBe(4320);
    expect(byPriority.high.responseMinutes).toBe(240);
    expect(byPriority.high.resolutionMinutes).toBe(1440);
    expect(byPriority.urgent.responseMinutes).toBe(60);
    expect(byPriority.urgent.resolutionMinutes).toBe(240);
    expect(data.every((row) => row.workspaceId === 'workspace-new')).toBe(true);
    expect(data.every((row) => typeof row.id === 'string' && row.id.length > 0)).toBe(true);
  });
});
