import { describe, it, expect, vi } from 'vitest';
import { prisma as sharedPrisma } from '@/lib/db/prisma';
import { ensureDefaultWorkspace } from '@/lib/workspace/server';
import { Prisma } from '@/generated/prisma';

function makeUniqueMembershipError(message: string) {
  return new Prisma.PrismaClientKnownRequestError(message, {
    code: 'P2002',
    meta: { target: ['userId'], modelName: 'Membership' },
    clientVersion: 'test',
  });
}

describe('ensureDefaultWorkspace recovery', () => {
  it('recovers deterministically from P2002 by loading and returning existing membership', async () => {
    const fakeMembership = {
      id: 'membership-123',
      userId: 'user-123',
      workspaceId: 'workship-123',
      role: 'owner',
      createdAt: new Date('2025-01-01T00:00:00Z'),
      updatedAt: new Date('2025-01-01T00:00:00Z'),
      workspace: {
        id: 'workspace-123',
        name: 'Workspace Recovery',
        createdAt: new Date('2025-01-01T00:00:00Z'),
        updatedAt: new Date('2025-01-01T00:00:00Z'),
      },
    } as const;

    const findUniqueSpy = vi
      .spyOn(sharedPrisma.membership, 'findUnique')
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce(fakeMembership);

    const fakeWorkspace = {
      id: 'workspace-123',
      name: 'Workspace Recovery',
      createdAt: new Date('2025-01-01T00:00:00Z'),
      updatedAt: new Date('2025-01-01T00:00:00Z'),
    } as const;

    const txClient = {
      workspace: {
        create: vi.fn().mockResolvedValue(fakeWorkspace),
      },
      membership: {
        create: vi.fn().mockRejectedValue(
          makeUniqueMembershipError('Unique constraint failed on the fields: (`userId`)'),
        ),
      },
    };

    const transactionSpy = vi
      .spyOn(sharedPrisma, '$transaction')
      .mockImplementation(async (txFactory: (tx: Prisma.TransactionClient) => Promise<unknown>) =>
        txFactory(txClient as unknown as Prisma.TransactionClient),
      );

    try {
      const result = await ensureDefaultWorkspace('user-123');

      expect(findUniqueSpy).toHaveBeenCalledTimes(2);
      expect(transactionSpy).toHaveBeenCalledTimes(1);

      expect(result.id).toBe('membership-123');
      expect(result.workspace.id).toBe('workspace-123');
    } finally {
      findUniqueSpy.mockRestore();
      transactionSpy.mockRestore();
    }
  });

  it('does not retry when findUnique returns an existing membership immediately', async () => {
    const fakeMembership = {
      id: 'membership-456',
      userId: 'user-456',
      workspaceId: 'workspace-456',
      role: 'owner',
      createdAt: new Date('2025-01-01T00:00:00Z'),
      updatedAt: new Date('2025-01-01T00:00:00Z'),
      workspace: {
        id: 'workspace-456',
        name: 'Existing Workspace',
        createdAt: new Date('2025-01-01T00:00:00Z'),
        updatedAt: new Date('2025-01-01T00:00:00Z'),
      },
    } as const;

    const findUniqueSpy = vi
      .spyOn(sharedPrisma.membership, 'findUnique')
      .mockResolvedValueOnce(fakeMembership);

    const transactionSpy = vi.spyOn(sharedPrisma, '$transaction');

    try {
      const result = await ensureDefaultWorkspace('user-456');

      expect(findUniqueSpy).toHaveBeenCalledTimes(1);
      expect(transactionSpy).not.toHaveBeenCalled();
      expect(result.id).toBe('membership-456');
    } finally {
      findUniqueSpy.mockRestore();
      transactionSpy.mockRestore();
    }
  });
});
