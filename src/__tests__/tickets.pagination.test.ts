import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { prisma as sharedPrisma } from '@/lib/db/prisma';
import { getTickets } from '@/lib/tickets/server';
import { getCurrentMembership } from '@/lib/workspace/server';

vi.mock('@/lib/workspace/server', () => ({
  getCurrentMembership: vi.fn(),
}));

const mockedGetCurrentMembership = vi.mocked(getCurrentMembership);

const fakeMembership = {
  userId: 'user-123',
  workspaceId: 'workspace-123',
  workspace: {
    id: 'workspace-123',
    name: 'Workspace 123',
    createdAt: new Date('2025-01-01T00:00:00Z'),
    updatedAt: new Date('2025-01-01T00:00:00Z'),
  },
} as const;

const fakeTicket = {
  id: 'ticket-1',
  workspaceId: 'workspace-123',
  createdById: 'user-123',
  title: 'Judul Tiket',
  description: 'Deskripsi',
  status: 'open',
  priority: 'medium',
  createdAt: new Date('2025-01-01T00:00:00Z'),
  updatedAt: new Date('2025-01-01T00:00:00Z'),
  responseSlaDeadline: new Date('2025-01-01T12:00:00Z'),
  resolutionSlaDeadline: new Date('2025-01-02T00:00:00Z'),
  firstResponseAt: null,
  resolvedAt: null,
  createdBy: {
    id: 'user-123',
    email: 'user@example.com',
    emailVerified: true,
    name: 'User 123',
    image: null,
    createdAt: new Date('2025-01-01T00:00:00Z'),
    updatedAt: new Date('2025-01-01T00:00:00Z'),
  },
};

describe('ticket pagination edge cases', () => {
  beforeEach(() => {
    vi.mocked(getCurrentMembership).mockResolvedValue(fakeMembership as never);
  });

  afterEach(() => {
    vi.resetAllMocks();
  });

  it('rejects page 0 as invalid pagination input', async () => {
    await expect(getTickets({ page: 0, limit: 10 })).rejects.toThrow();
  });

  it('rejects negative page as invalid pagination input', async () => {
    await expect(getTickets({ page: -5, limit: 10 })).rejects.toThrow();
  });

  it('rejects zero limit as invalid pagination input', async () => {
    await expect(getTickets({ page: 1, limit: 0 })).rejects.toThrow();
  });

  it('rejects negative limit as invalid pagination input', async () => {
    await expect(getTickets({ page: 1, limit: -10 })).rejects.toThrow();
  });

  it('clamps requested page beyond totalPages to the last valid page', async () => {
    const findManySpy = vi
      .spyOn(sharedPrisma.ticket, 'findMany')
      .mockResolvedValue([fakeTicket] as never);
    const countSpy = vi.spyOn(sharedPrisma.ticket, 'count').mockResolvedValue(3 as never);

    try {
      const result = await getTickets({ page: 10, limit: 2 });

      expect(countSpy).toHaveBeenCalledWith({ where: { workspaceId: 'workspace-123' } });
      expect(findManySpy).toHaveBeenCalledWith({
        where: { workspaceId: 'workspace-123' },
        include: { createdBy: true },
        orderBy: { createdAt: 'desc' },
        skip: 2,
        take: 2,
      });
      expect(result.page).toBe(2);
      expect(result.totalPages).toBe(2);
      expect(result.hasPreviousPage).toBe(true);
      expect(result.hasNextPage).toBe(false);
    } finally {
      findManySpy.mockRestore();
      countSpy.mockRestore();
    }
  });

  it('recalculates pagination metadata when a status filter reduces the dataset', async () => {
    const findManySpy = vi
      .spyOn(sharedPrisma.ticket, 'findMany')
      .mockResolvedValue([fakeTicket] as never);
    const countSpy = vi.spyOn(sharedPrisma.ticket, 'count').mockResolvedValue(1 as never);

    try {
      const result = await getTickets({ status: 'open', page: 2, limit: 10 });

      expect(countSpy).toHaveBeenCalledWith({
        where: { workspaceId: 'workspace-123', status: 'open' },
      });
      expect(findManySpy).toHaveBeenCalledWith({
        where: { workspaceId: 'workspace-123', status: 'open' },
        include: { createdBy: true },
        orderBy: { createdAt: 'desc' },
        skip: 0,
        take: 10,
      });
      expect(result.total).toBe(1);
      expect(result.totalPages).toBe(1);
      expect(result.page).toBe(1);
      expect(result.hasNextPage).toBe(false);
    } finally {
      findManySpy.mockRestore();
      countSpy.mockRestore();
    }
  });

  it('recalculates pagination metadata when search reduces the dataset', async () => {
    const findManySpy = vi
      .spyOn(sharedPrisma.ticket, 'findMany')
      .mockResolvedValue([fakeTicket] as never);
    const countSpy = vi.spyOn(sharedPrisma.ticket, 'count').mockResolvedValue(1 as never);

    try {
      const result = await getTickets({ search: { q: 'Judul Tiket' }, page: 3, limit: 10 });

      expect(countSpy).toHaveBeenCalledWith({
        where: {
          workspaceId: 'workspace-123',
          OR: [
            { title: { contains: 'Judul Tiket', mode: 'insensitive' } },
            { description: { contains: 'Judul Tiket', mode: 'insensitive' } },
            { createdBy: { name: { contains: 'Judul Tiket', mode: 'insensitive' } } },
            { assignedTo: { name: { contains: 'Judul Tiket', mode: 'insensitive' } } },
          ],
        },
      });
      expect(findManySpy).toHaveBeenCalledWith({
        where: {
          workspaceId: 'workspace-123',
          OR: [
            { title: { contains: 'Judul Tiket', mode: 'insensitive' } },
            { description: { contains: 'Judul Tiket', mode: 'insensitive' } },
            { createdBy: { name: { contains: 'Judul Tiket', mode: 'insensitive' } } },
            { assignedTo: { name: { contains: 'Judul Tiket', mode: 'insensitive' } } },
          ],
        },
        include: { createdBy: true },
        orderBy: { createdAt: 'desc' },
        skip: 0,
        take: 10,
      });
      expect(result.total).toBe(1);
      expect(result.totalPages).toBe(1);
      expect(result.page).toBe(1);
    } finally {
      findManySpy.mockRestore();
      countSpy.mockRestore();
    }
  });
});
