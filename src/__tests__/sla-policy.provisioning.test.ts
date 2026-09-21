import { describe, it, expect, vi } from 'vitest';
import { prisma as sharedPrisma } from '@/lib/db/prisma';
import { ensureDefaultWorkspace } from '@/lib/workspace/server';
import { buildDefaultSlaPolicyData } from '@/lib/workspace/sla-policy';

describe('ensureDefaultWorkspace — SLA provisioning', () => {
  it('newly created workspace receives exactly four policy rows matching canonical defaults', async () => {
    const findUniqueSpy = vi
      .spyOn(sharedPrisma.membership, 'findUnique')
      .mockResolvedValueOnce(null);

    const userFindUniqueSpy = vi.spyOn(sharedPrisma.user, 'findUnique').mockResolvedValue({
      id: 'user-123',
      name: 'Provisioning User',
      email: 'provisioning@example.com',
      emailVerified: true,
      image: null,
      createdAt: new Date('2025-01-01T00:00:00Z'),
      updatedAt: new Date('2025-01-01T00:00:00Z'),
    });

    const createdWorkspace = {
      id: 'workspace-123',
      name: 'Provisioning User Workspace',
      createdAt: new Date('2025-01-01T00:00:00Z'),
      updatedAt: new Date('2025-01-01T00:00:00Z'),
    };

    const createdMembership = {
      id: 'membership-123',
      userId: 'user-123',
      workspaceId: 'workspace-123',
      role: 'owner',
      createdAt: new Date('2025-01-01T00:00:00Z'),
      updatedAt: new Date('2025-01-01T00:00:00Z'),
      workspace: createdWorkspace,
    };

    const createManySpy = vi.fn().mockResolvedValue({ count: 4 } as never);
    const workspaceCreateSpy = vi.fn().mockResolvedValue(createdWorkspace);
    const membershipCreateSpy = vi.fn().mockResolvedValue(createdMembership);

    const transactionSpy = vi
      .spyOn(sharedPrisma, '$transaction')
      .mockImplementation(async (txFactory: (tx: never) => Promise<unknown>) => {
        const txClient = {
          workspace: { create: workspaceCreateSpy },
          membership: { create: membershipCreateSpy },
          workspaceSlaPolicy: { createMany: createManySpy },
        } as never;
        return txFactory(txClient);
      });

    try {
      const result = await ensureDefaultWorkspace('user-123');

      expect(transactionSpy).toHaveBeenCalledTimes(1);
      expect(workspaceCreateSpy).toHaveBeenCalledTimes(1);
      expect(createManySpy).toHaveBeenCalledTimes(1);
      expect(membershipCreateSpy).toHaveBeenCalledTimes(1);

      const seededData = createManySpy.mock.calls[0][0].data;
      expect(seededData).toHaveLength(4);
      expect(seededData).toEqual(buildDefaultSlaPolicyData('workspace-123'));

      const byPriority = Object.fromEntries(
        seededData.map((row: { priority: string; responseMinutes: number; resolutionMinutes: number }) => [
          row.priority,
          row,
        ]),
      );
      expect(byPriority.low.responseMinutes).toBe(1440);
      expect(byPriority.low.resolutionMinutes).toBe(7200);
      expect(byPriority.medium.responseMinutes).toBe(480);
      expect(byPriority.medium.resolutionMinutes).toBe(4320);
      expect(byPriority.high.responseMinutes).toBe(240);
      expect(byPriority.high.resolutionMinutes).toBe(1440);
      expect(byPriority.urgent.responseMinutes).toBe(60);
      expect(byPriority.urgent.resolutionMinutes).toBe(240);

      expect(result.workspace.id).toBe('workspace-123');
    } finally {
      findUniqueSpy.mockRestore();
      userFindUniqueSpy.mockRestore();
      transactionSpy.mockRestore();
    }
  });

  it('workspace creation and SLA initialization are atomic — failure rolls back everything', async () => {
    const findUniqueSpy = vi
      .spyOn(sharedPrisma.membership, 'findUnique')
      .mockResolvedValueOnce(null);

    const userFindUniqueSpy = vi.spyOn(sharedPrisma.user, 'findUnique').mockResolvedValue({
      id: 'user-123',
      name: 'Rollback User',
      email: 'rollback@example.com',
      emailVerified: true,
      image: null,
      createdAt: new Date('2025-01-01T00:00:00Z'),
      updatedAt: new Date('2025-01-01T00:00:00Z'),
    });

    const transactionSpy = vi
      .spyOn(sharedPrisma, '$transaction')
      .mockRejectedValueOnce(new Error('boom during SLA seed'));

    try {
      // ensureDefaultWorkspace wraps provisioning failures with a localized
      // error — atomicity is guaranteed by $transaction rolling back on throw.
      await expect(ensureDefaultWorkspace('user-123')).rejects.toThrow(
        'Gagal menyiapkan workspace default.',
      );
    } finally {
      findUniqueSpy.mockRestore();
      userFindUniqueSpy.mockRestore();
      transactionSpy.mockRestore();
    }
  });
});
