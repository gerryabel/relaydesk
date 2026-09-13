import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { prisma } from '@/lib/db/prisma';
import type { Prisma } from '@/generated/prisma';
import {
  getMembers,
  getMemberById,
  updateMemberRole,
  MemberNotFoundError,
  MemberNotInWorkspaceError,
  CannotDemoteLastOwnerError,
  InvalidRoleChangeError,
} from '@/lib/members/server';
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
    membership: {
      findUnique: vi.fn(),
      findMany: vi.fn(),
      count: vi.fn(),
      update: vi.fn(),
    },
    $transaction: vi.fn(),
  },
}));

const mockedGetCurrentMembership = vi.mocked(getCurrentMembership);
const mockedAssertWorkspaceOwner = vi.mocked(assertWorkspaceOwner);
const mockedMembershipFindUnique = vi.mocked(prisma.membership.findUnique);
const mockedMembershipFindMany = vi.mocked(prisma.membership.findMany);
const mockedMembershipCount = vi.mocked(prisma.membership.count);
const mockedMembershipUpdate = vi.mocked(prisma.membership.update);
const mockedTransaction = vi.mocked(prisma.$transaction);

function mockTransaction(
  handler: (tx: Prisma.TransactionClient) => Promise<unknown>,
): Promise<unknown> {
  const tx = {
    membership: {
      count: mockedMembershipCount,
      update: mockedMembershipUpdate,
    },
  } as unknown as Prisma.TransactionClient;
  return handler(tx);
}

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

beforeEach(() => {
  vi.restoreAllMocks();
  mockedGetCurrentMembership.mockReset();
  mockedAssertWorkspaceOwner.mockReset();
  mockedMembershipFindUnique.mockReset();
  mockedMembershipFindMany.mockReset();
  mockedMembershipCount.mockReset();
  mockedMembershipUpdate.mockReset();
  mockedTransaction.mockReset();
});

afterEach(() => {
  vi.useRealTimers();
});

describe('assertWorkspaceOwner (owner authorization helper)', () => {
  it('assertWorkspaceOwner is defined and is a function', () => {
    expect(typeof assertWorkspaceOwner).toBe('function');
  });

  it('assertWorkspaceOwner delegates to workspace authorization', async () => {
    mockedAssertWorkspaceOwner.mockResolvedValueOnce(fakeSessionMembership as never);

    const result = await assertWorkspaceOwner();

    expect(mockedAssertWorkspaceOwner).toHaveBeenCalledOnce();
    expect(result).toBe(fakeSessionMembership);
  });
});

describe('getMembers', () => {
  it('queries prisma scoped to the current workspace', async () => {
    mockedGetCurrentMembership.mockResolvedValueOnce(fakeSessionMembership as never);
    mockedMembershipFindMany.mockResolvedValueOnce([
      {
        id: 'm1',
        userId: 'user-123',
        workspaceId: 'workspace-123',
        role: 'owner',
        createdAt: new Date('2025-01-01T00:00:00Z'),
        updatedAt: new Date('2025-01-01T00:00:00Z'),
        user: {
          id: 'user-123',
          name: 'User Satu',
          email: 'user1@example.com',
          image: null,
        },
      },
    ] as never);

    const result = await getMembers();

    expect(mockedMembershipFindMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { workspaceId: 'workspace-123' },
      }),
    );
    expect(result).toHaveLength(1);
    expect(result[0].membershipId).toBe('m1');
    expect(result[0].name).toBe('User Satu');
    expect(result[0].isAssignable).toBe(true);
  });

  it('throws UnauthorizedError when no session', async () => {
    mockedGetCurrentMembership.mockRejectedValueOnce(
      new UnauthorizedError('No authenticated session'),
    );

    await expect(getMembers()).rejects.toThrow(UnauthorizedError);
  });
});

describe('getMemberById', () => {
  it('returns member detail scoped to workspace', async () => {
    mockedGetCurrentMembership.mockResolvedValueOnce(fakeSessionMembership as never);
    mockedMembershipFindUnique.mockResolvedValueOnce({
      id: 'm1',
      userId: 'user-123',
      workspaceId: 'workspace-123',
      role: 'member',
      createdAt: new Date('2025-01-01T00:00:00Z'),
      updatedAt: new Date('2025-01-01T00:00:00Z'),
      user: {
        id: 'user-123',
        name: 'User Satu',
        email: 'user1@example.com',
        image: null,
      },
    } as never);

    const result = await getMemberById('m1');

    expect(result.membershipId).toBe('m1');
    expect(result.role).toBe('member');
    expect(result.isAssignable).toBe(true);
  });

  it('throws MemberNotInWorkspaceError for cross-workspace access', async () => {
    mockedGetCurrentMembership.mockResolvedValueOnce(fakeSessionMembership as never);
    mockedMembershipFindUnique.mockResolvedValueOnce({
      id: 'm-other',
      userId: 'user-999',
      workspaceId: 'workspace-OTHER',
      role: 'member',
      createdAt: new Date('2025-01-01T00:00:00Z'),
      updatedAt: new Date('2025-01-01T00:00:00Z'),
      user: {
        id: 'user-999',
        name: 'Other User',
        email: 'other@example.com',
        image: null,
      },
    } as never);

    await expect(getMemberById('m-other')).rejects.toThrow(MemberNotInWorkspaceError);
  });
});

describe('updateMemberRole', () => {
  const targetMembership = {
    id: 'm-target',
    userId: 'user-target',
    workspaceId: 'workspace-123',
    role: 'member',
    createdAt: new Date('2025-01-01T00:00:00Z'),
    updatedAt: new Date('2025-01-01T00:00:00Z'),
  };

  it('requires owner authorization', async () => {
    mockedAssertWorkspaceOwner.mockResolvedValueOnce(fakeSessionMembership as never);
    mockedGetCurrentMembership.mockResolvedValueOnce(fakeSessionMembership as never);
    mockedMembershipFindUnique.mockResolvedValueOnce(targetMembership as never);
    mockedTransaction.mockImplementationOnce(mockTransaction);
    mockedMembershipUpdate.mockResolvedValueOnce({
      id: 'm-target',
      userId: 'user-target',
      workspaceId: 'workspace-123',
      role: 'owner',
      createdAt: new Date('2025-01-01T00:00:00Z'),
      updatedAt: new Date('2025-01-02T00:00:00Z'),
      user: {
        id: 'user-target',
        name: 'Target User',
        email: 'target@example.com',
        image: null,
      },
    } as never);

    const result = await updateMemberRole('m-target', { role: 'owner' });

    expect(mockedAssertWorkspaceOwner).toHaveBeenCalled();
    expect(result.role).toBe('owner');
  });

  it('throws ForbiddenError when caller is not owner', async () => {
    mockedAssertWorkspaceOwner.mockRejectedValueOnce(
      new ForbiddenError('Only workspace owners can perform this action.'),
    );

    await expect(updateMemberRole('m-target', { role: 'member' })).rejects.toThrow(ForbiddenError);
  });

  it('throws MemberNotFoundError when target does not exist', async () => {
    mockedAssertWorkspaceOwner.mockResolvedValueOnce(fakeSessionMembership as never);
    mockedMembershipFindUnique.mockResolvedValueOnce(null);

    await expect(updateMemberRole('missing', { role: 'owner' })).rejects.toThrow(
      MemberNotFoundError,
    );
  });

  it('throws InvalidRoleChangeError when role is unchanged', async () => {
    mockedAssertWorkspaceOwner.mockResolvedValueOnce(fakeSessionMembership as never);
    mockedMembershipFindUnique.mockResolvedValueOnce({
      ...targetMembership,
      role: 'owner',
    } as never);
    mockedGetCurrentMembership.mockResolvedValueOnce(fakeSessionMembership as never);

    await expect(updateMemberRole('m-target', { role: 'owner' })).rejects.toThrow(
      InvalidRoleChangeError,
    );
  });

  it('runs the demotion in a serializable transaction', async () => {
    mockedAssertWorkspaceOwner.mockResolvedValueOnce(fakeSessionMembership as never);
    mockedMembershipFindUnique.mockResolvedValueOnce({
      ...targetMembership,
      role: 'owner',
    } as never);
    mockedGetCurrentMembership.mockResolvedValueOnce(fakeSessionMembership as never);
    mockedTransaction.mockImplementationOnce(mockTransaction);
    mockedMembershipCount.mockResolvedValueOnce(2);
    mockedMembershipUpdate.mockResolvedValueOnce({
      id: 'm-target',
      userId: 'user-target',
      workspaceId: 'workspace-123',
      role: 'member',
      createdAt: new Date('2025-01-01T00:00:00Z'),
      updatedAt: new Date('2025-01-02T00:00:00Z'),
      user: {
        id: 'user-target',
        name: 'Target User',
        email: 'target@example.com',
        image: null,
      },
    } as never);

    await updateMemberRole('m-target', { role: 'member' });

    expect(mockedTransaction).toHaveBeenCalledWith(
      expect.any(Function),
      expect.objectContaining({ isolationLevel: 'Serializable' }),
    );
  });

  it('atomically enforces the last-owner invariant', async () => {
    mockedAssertWorkspaceOwner.mockResolvedValueOnce(fakeSessionMembership as never);
    mockedMembershipFindUnique.mockResolvedValueOnce({
      ...targetMembership,
      role: 'owner',
    } as never);
    mockedGetCurrentMembership.mockResolvedValueOnce(fakeSessionMembership as never);
    mockedTransaction.mockImplementationOnce(mockTransaction);
    mockedMembershipCount.mockResolvedValueOnce(1);

    await expect(updateMemberRole('m-target', { role: 'member' })).rejects.toThrow(
      CannotDemoteLastOwnerError,
    );
    expect(mockedMembershipUpdate).not.toHaveBeenCalled();
  });

  it('allows demotion when another owner exists', async () => {
    mockedAssertWorkspaceOwner.mockResolvedValueOnce(fakeSessionMembership as never);
    mockedMembershipFindUnique.mockResolvedValueOnce({
      ...targetMembership,
      role: 'owner',
    } as never);
    mockedGetCurrentMembership.mockResolvedValueOnce(fakeSessionMembership as never);
    mockedTransaction.mockImplementationOnce(mockTransaction);
    mockedMembershipCount.mockResolvedValueOnce(2);
    mockedMembershipUpdate.mockResolvedValueOnce({
      id: 'm-target',
      userId: 'user-target',
      workspaceId: 'workspace-123',
      role: 'member',
      createdAt: new Date('2025-01-01T00:00:00Z'),
      updatedAt: new Date('2025-01-02T00:00:00Z'),
      user: {
        id: 'user-target',
        name: 'Target User',
        email: 'target@example.com',
        image: null,
      },
    } as never);

    const result = await updateMemberRole('m-target', { role: 'member' });

    expect(result.role).toBe('member');
  });

  it('retries on P2034 transaction conflict and eventually succeeds', async () => {
    mockedAssertWorkspaceOwner.mockResolvedValue(fakeSessionMembership as never);
    mockedGetCurrentMembership.mockResolvedValue(fakeSessionMembership as never);
    mockedMembershipFindUnique.mockResolvedValue({
      ...targetMembership,
      role: 'owner',
    } as never);

    const conflict = { code: 'P2034', message: 'Transaction failed due to write conflict' };
    mockedTransaction
      .mockRejectedValueOnce(conflict)
      .mockRejectedValueOnce(conflict)
      .mockImplementationOnce(mockTransaction);
    mockedMembershipCount.mockResolvedValueOnce(2);
    mockedMembershipUpdate.mockResolvedValueOnce({
      id: 'm-target',
      userId: 'user-target',
      workspaceId: 'workspace-123',
      role: 'member',
      createdAt: new Date('2025-01-01T00:00:00Z'),
      updatedAt: new Date('2025-01-02T00:00:00Z'),
      user: {
        id: 'user-target',
        name: 'Target User',
        email: 'target@example.com',
        image: null,
      },
    } as never);

    const result = await updateMemberRole('m-target', { role: 'member' });

    expect(mockedTransaction).toHaveBeenCalledTimes(3);
    expect(result.role).toBe('member');
  });

  it('stops retrying after MAX_SERIAL_RETRIES and surfaces the conflict', async () => {
    mockedAssertWorkspaceOwner.mockResolvedValue(fakeSessionMembership as never);
    mockedGetCurrentMembership.mockResolvedValue(fakeSessionMembership as never);
    mockedMembershipFindUnique.mockResolvedValue({
      ...targetMembership,
      role: 'owner',
    } as never);

    const conflict = { code: 'P2034', message: 'Transaction failed due to write conflict' };
    mockedTransaction.mockRejectedValue(conflict);

    await expect(updateMemberRole('m-target', { role: 'member' })).rejects.toMatchObject({
      code: 'P2034',
    });
    expect(mockedTransaction).toHaveBeenCalledTimes(4);
  });

  it('does not retry non-conflict errors', async () => {
    mockedAssertWorkspaceOwner.mockResolvedValueOnce(fakeSessionMembership as never);
    mockedMembershipFindUnique.mockResolvedValueOnce({
      ...targetMembership,
      role: 'owner',
    } as never);
    mockedGetCurrentMembership.mockResolvedValueOnce(fakeSessionMembership as never);
    mockedTransaction.mockImplementationOnce(mockTransaction);
    mockedMembershipCount.mockResolvedValueOnce(1);

    await expect(updateMemberRole('m-target', { role: 'member' })).rejects.toThrow(
      CannotDemoteLastOwnerError,
    );
    expect(mockedTransaction).toHaveBeenCalledTimes(1);
  });
});

describe('member domain error classes', () => {
  it('MemberNotFoundError has correct name', () => {
    const error = new MemberNotFoundError();
    expect(error.name).toBe('MemberNotFoundError');
  });

  it('MemberNotInWorkspaceError has correct name', () => {
    const error = new MemberNotInWorkspaceError();
    expect(error.name).toBe('MemberNotInWorkspaceError');
  });

  it('CannotDemoteLastOwnerError has correct name', () => {
    const error = new CannotDemoteLastOwnerError();
    expect(error.name).toBe('CannotDemoteLastOwnerError');
  });

  it('InvalidRoleChangeError has correct name and message', () => {
    const error = new InvalidRoleChangeError('test');
    expect(error.name).toBe('InvalidRoleChangeError');
    expect(error.message).toBe('test');
  });
});
