import { describe, it, expect, vi, afterEach } from 'vitest';
import { bulkUpdateTickets, normalizeBulkTicketIds } from '@/lib/tickets/bulk';
import type { BulkUpdateResult } from '@/lib/tickets/bulk';
import { getCurrentMembership } from '@/lib/workspace/server';

const { mockedPrisma } = vi.hoisted(() => ({
  mockedPrisma: {
    ticket: { findMany: vi.fn(), update: vi.fn(), findFirst: vi.fn() },
    membership: { findFirst: vi.fn() },
    ticketActivity: { create: vi.fn() },
    ticketTag: { findFirst: vi.fn(), delete: vi.fn(), create: vi.fn() },
    notification: { create: vi.fn() },
    tag: { findFirst: vi.fn() },
    $transaction: vi.fn(),
  },
}));

vi.mock('@/lib/db/prisma', async () => ({
  prisma: mockedPrisma,
}));

vi.mock('@/lib/workspace/server', () => ({
  getCurrentMembership: vi.fn(() => Promise.resolve({
    userId: 'user-123',
    workspaceId: 'workspace-123',
    workspace: {
      id: 'workspace-123',
      name: 'Workspace 123',
      createdAt: new Date('2025-01-01T00:00:00Z'),
      updatedAt: new Date('2025-01-01T00:00:00Z'),
    },
  })),
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

const fakeTicket = (overrides: Partial<{ id: string; status: string; priority: string; assignedToId: string | null; resolvedAt: Date | null; title: string }> = {}) => ({
  id: overrides.id ?? 'ticket-1',
  workspaceId: 'workspace-123',
  status: overrides.status ?? 'open',
  priority: overrides.priority ?? 'medium',
  assignedToId: overrides.assignedToId ?? null,
  resolvedAt: overrides.resolvedAt ?? null,
  title: overrides.title ?? 'Judul Tiket',
});

function mockBulkPrisma(overrides: {
  findManyResult?: Array<{ id: string }>;
  membershipFindFirst?: unknown;
  ticketUpdate?: unknown;
  ticketTagFindFirst?: unknown;
  ticketTagDelete?: unknown;
  activityCreate?: unknown;
  notificationCreate?: unknown;
  tagFindFirst?: unknown;
} = {}) {
  mockedPrisma.ticket.findMany.mockImplementation(async () => (overrides.findManyResult ?? [fakeTicket()]) as never);
  mockedPrisma.membership.findFirst.mockImplementation(async () => (overrides.membershipFindFirst === undefined ? { id: 'membership-1' } : overrides.membershipFindFirst) as never);
  mockedPrisma.ticket.update.mockImplementation(async () => (overrides.ticketUpdate === undefined ? { ...fakeTicket(), updatedAt: new Date() } : overrides.ticketUpdate) as never);
  mockedPrisma.ticketTag.findFirst.mockImplementation(async () => (overrides.ticketTagFindFirst === undefined ? null : overrides.ticketTagFindFirst) as never);
  mockedPrisma.ticketTag.delete.mockImplementation(async () => (overrides.ticketTagDelete === undefined ? { ticketId: 'ticket-1', tagId: 'tag-1' } : overrides.ticketTagDelete) as never);
  mockedPrisma.ticketActivity.create.mockImplementation(async () => (overrides.activityCreate === undefined ? { id: 'activity-1' } : overrides.activityCreate) as never);
  mockedPrisma.notification.create.mockImplementation(async () => (overrides.notificationCreate === undefined ? { id: 'notification-1' } : overrides.notificationCreate) as never);
  mockedPrisma.tag.findFirst.mockImplementation(async () => (overrides.tagFindFirst === undefined ? { id: 'tag-1', workspaceId: 'workspace-123' } : overrides.tagFindFirst) as never);

  mockedPrisma.$transaction.mockImplementation(async (worker: (input: typeof mockedPrisma) => Promise<BulkUpdateResult>) => worker(mockedPrisma));
}

describe('ticket bulk service', () => {
  afterEach(() => {
    mockedGetCurrentMembership.mockResolvedValue(fakeMembership as never);
    mockedPrisma.ticket.findMany.mockReset();
    mockedPrisma.membership.findFirst.mockReset();
    mockedPrisma.ticket.update.mockReset();
    mockedPrisma.ticketTag.findFirst.mockReset();
    mockedPrisma.ticketTag.delete.mockReset();
    mockedPrisma.ticketActivity.create.mockReset();
    mockedPrisma.notification.create.mockReset();
    mockedPrisma.tag.findFirst.mockReset();
    mockedPrisma.$transaction.mockReset();
  });

  describe('normalizeBulkTicketIds', () => {
    it('rejects empty ticket IDs', () => {
      expect(() => normalizeBulkTicketIds([])).toThrow('Pilih minimal satu tiket.');
    });

    it('rejects duplicate IDs', () => {
      expect(() => normalizeBulkTicketIds(['ticket-1', 'ticket-1'])).toThrow('ID tiket tidak boleh duplikat.');
    });

    it('rejects IDs over 100', () => {
      expect(() => normalizeBulkTicketIds(Array.from({ length: 101 }, (_, index) => `ticket-${index}`))).toThrow('Maksimal 100 tiket.');
    });

    it('accepts up to 100 unique IDs', () => {
      const ids = Array.from({ length: 100 }, (_, index) => `ticket-${index}`);
      expect(normalizeBulkTicketIds(ids)).toHaveLength(100);
    });
  });

  describe('assignment', () => {
    it('assigns multiple tickets within one transaction', async () => {
      mockBulkPrisma({
        findManyResult: [fakeTicket(), fakeTicket({ id: 'ticket-2' })],
      });

      const result = await bulkUpdateTickets({
        ticketIds: ['ticket-1', 'ticket-2'],
        action: 'assign',
        value: 'user-456',
      });

      expect(mockedPrisma.$transaction).toHaveBeenCalledTimes(1);
      expect(result).toEqual({ updatedCount: 2, noOpCount: 0 });
    });

    it('is a no-op when assignee is already the same', async () => {
      mockBulkPrisma({
        findManyResult: [fakeTicket({ assignedToId: 'user-456' })],
      });

      const result = await bulkUpdateTickets({
        ticketIds: ['ticket-1'],
        action: 'assign',
        value: 'user-456',
      });

      expect(mockedPrisma.$transaction).toHaveBeenCalledTimes(1);
      expect(result).toEqual({ updatedCount: 0, noOpCount: 1 });
    });

    it('rejects when assignee is not in the workspace', async () => {
      mockedPrisma.ticket.findMany.mockImplementationOnce(async () => [fakeTicket()]);
      mockedPrisma.membership.findFirst.mockImplementationOnce(async () => null);
      mockedPrisma.ticket.update.mockImplementationOnce(async () => ({ ...fakeTicket(), updatedAt: new Date() }));
      mockedPrisma.ticketTag.findFirst.mockImplementationOnce(async () => null);
      mockedPrisma.ticketTag.delete.mockImplementationOnce(async () => ({ ticketId: 'ticket-1', tagId: 'tag-1' }));
      mockedPrisma.ticketActivity.create.mockImplementationOnce(async () => ({ id: 'activity-1' }));
      mockedPrisma.notification.create.mockImplementationOnce(async () => ({ id: 'notification-1' }));
      mockedPrisma.tag.findFirst.mockImplementationOnce(async () => ({ id: 'tag-1', workspaceId: 'workspace-123' }));
      mockedPrisma.$transaction.mockImplementationOnce(async (worker: (input: typeof mockedPrisma) => Promise<BulkUpdateResult>) => worker(mockedPrisma));

      await expect(
        bulkUpdateTickets({
          ticketIds: ['ticket-1'],
          action: 'assign',
          value: 'user-999',
        }),
      ).rejects.toThrow('Assignee bukan member workspace ini.');

      expect(mockedPrisma.$transaction).not.toHaveBeenCalled();
    });
  });

  describe('status', () => {
    it('rejects an invalid transition across the whole batch', async () => {
      mockBulkPrisma({
        findManyResult: [fakeTicket({ status: 'closed' })],
      });

      await expect(
        bulkUpdateTickets({
          ticketIds: ['ticket-1'],
          action: 'status',
          value: 'resolved',
        }),
      ).rejects.toThrow('Invalid status transition from closed to resolved');

      expect(mockedPrisma.$transaction).not.toHaveBeenCalled();
    });

    it('is a no-op for tickets already at the requested status', async () => {
      mockBulkPrisma({
        findManyResult: [fakeTicket({ status: 'in_progress' })],
      });

      const result = await bulkUpdateTickets({
        ticketIds: ['ticket-1'],
        action: 'status',
        value: 'in_progress',
      });

      expect(mockedPrisma.$transaction).toHaveBeenCalledTimes(1);
      expect(result).toEqual({ updatedCount: 0, noOpCount: 1 });
    });
  });

  describe('priority', () => {
    it('creates PRIORITY_CHANGED activity per changed ticket', async () => {
      mockBulkPrisma({
        findManyResult: [fakeTicket()],
        ticketUpdate: { ...fakeTicket(), priority: 'high' },
      });

      const result = await bulkUpdateTickets({
        ticketIds: ['ticket-1'],
        action: 'priority',
        value: 'high',
      });

      expect(mockedPrisma.$transaction).toHaveBeenCalledTimes(1);
      expect(result).toEqual({ updatedCount: 1, noOpCount: 0 });
      expect(mockedPrisma.ticketActivity.create).toHaveBeenCalledWith({
        data: {
          ticketId: 'ticket-1',
          actorId: 'user-123',
          type: 'PRIORITY_CHANGED',
          metadata: { from: 'medium', to: 'high' },
        },
      });
    });
  });

  describe('tags', () => {
    it('adds a tag to multiple tickets', async () => {
      mockBulkPrisma({
        findManyResult: [fakeTicket(), fakeTicket({ id: 'ticket-2' })],
        ticketTagFindFirst: null,
      });

      const result = await bulkUpdateTickets({
        ticketIds: ['ticket-1', 'ticket-2'],
        action: 'add_tag',
        value: 'tag-1',
      });

      expect(mockedPrisma.$transaction).toHaveBeenCalledTimes(1);
      expect(result.updatedCount).toBe(2);
    });

    it('does not remove if tag is already missing', async () => {
      mockBulkPrisma({
        findManyResult: [fakeTicket()],
        ticketTagFindFirst: null,
      });

      const result = await bulkUpdateTickets({
        ticketIds: ['ticket-1'],
        action: 'remove_tag',
        value: 'tag-1',
      });

      expect(mockedPrisma.$transaction).toHaveBeenCalledTimes(1);
      expect(result).toEqual({ updatedCount: 0, noOpCount: 1 });
    });
  });

  describe('atomicity', () => {
    it('rejects the entire request when a ticket is missing', async () => {
      mockBulkPrisma({
        findManyResult: [fakeTicket()],
      });

      await expect(
        bulkUpdateTickets({
          ticketIds: ['ticket-1', 'missing'],
          action: 'assign',
          value: 'user-456',
        }),
      ).rejects.toThrow('Satu atau lebih tiket tidak ditemukan.');

      expect(mockedPrisma.$transaction).not.toHaveBeenCalled();
    });

    it('rolls back the entire operation when notification creation fails', async () => {
      mockBulkPrisma({
        findManyResult: [fakeTicket({ status: 'open' })],
        ticketUpdate: { ...fakeTicket({ status: 'in_progress' }), assignedToId: 'user-456' },
        notificationCreate: { id: 'notification-1' },
      });

      mockedPrisma.ticket.findFirst.mockImplementationOnce(async () =>
        fakeTicket({ status: 'in_progress', assignedToId: 'user-456' }),
      );

      mockedPrisma.notification.create.mockImplementationOnce(async () => {
        throw new Error('notification failed');
      });

      await expect(
        bulkUpdateTickets({
          ticketIds: ['ticket-1'],
          action: 'status',
          value: 'in_progress',
        }),
      ).rejects.toThrow('notification failed');

      expect(mockedPrisma.$transaction).toHaveBeenCalledTimes(1);
    });

    it('validates the current database status and rejects invalid transitions', async () => {
      mockBulkPrisma({
        findManyResult: [fakeTicket({ status: 'closed' })],
      });

      await expect(
        bulkUpdateTickets({
          ticketIds: ['ticket-1'],
          action: 'status',
          value: 'resolved',
        }),
      ).rejects.toThrow('Invalid status transition from closed to resolved');

      expect(mockedPrisma.$transaction).not.toHaveBeenCalled();
    });
  });
});
