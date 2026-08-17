import { describe, it, expect, vi, afterEach } from 'vitest';
import { prisma } from '@/lib/db/prisma';
import {
  createTicketAssignedNotification,
  createTicketStatusChangedNotification,
} from '@/lib/notifications/server';
import { getCurrentMembership } from '@/lib/workspace/server';

vi.mock('@/lib/db/prisma', () => ({
  prisma: {
    membership: { findFirst: vi.fn() },
    ticket: { findFirst: vi.fn() },
    notification: { create: vi.fn() },
    $transaction: vi.fn(),
  },
}));

vi.mock('@/lib/workspace/server', () => ({
  getCurrentMembership: vi.fn(),
}));

const mockedMembershipFindFirst = vi.mocked(prisma.membership.findFirst);
const mockedTicketFindFirst = vi.mocked(prisma.ticket.findFirst);
const mockedNotificationCreate = vi.mocked(prisma.notification.create);
const mockedGetCurrentMembership = vi.mocked(getCurrentMembership);

const fakeTicket = { id: 'ticket-1', title: 'Judul Tiket' };

afterEach(() => {
  mockedMembershipFindFirst.mockReset();
  mockedTicketFindFirst.mockReset();
  mockedNotificationCreate.mockReset();
  mockedGetCurrentMembership.mockReset();
});

describe('notification creation service', () => {

  describe('createTicketAssignedNotification', () => {
    it('throws when assignee membership is missing', async () => {
      mockedMembershipFindFirst.mockResolvedValueOnce(null as never);
      mockedTicketFindFirst.mockResolvedValueOnce(fakeTicket as never);

      await expect(
        createTicketAssignedNotification({
          actorId: 'user-1',
          ticketId: 'ticket-1',
          assigneeId: 'user-456',
          previousAssigneeId: null,
          workspaceId: 'workspace-123',
          tx: prisma,
        }),
      ).rejects.toThrow('Assignee user-456 is not in workspace workspace-123');
    });

    it('throws when ticket is missing', async () => {
      mockedMembershipFindFirst.mockResolvedValueOnce({ id: 'membership-1' } as never);
      mockedTicketFindFirst.mockResolvedValueOnce(null as never);

      await expect(
        createTicketAssignedNotification({
          actorId: 'user-1',
          ticketId: 'ticket-1',
          assigneeId: 'user-456',
          previousAssigneeId: null,
          workspaceId: 'workspace-123',
          tx: prisma,
        }),
      ).rejects.toThrow('Ticket ticket-1 not found in workspace workspace-123');
    });

    it('creates notification for valid assignment', async () => {
      mockedMembershipFindFirst.mockResolvedValueOnce({ id: 'membership-1' } as never);
      mockedTicketFindFirst.mockResolvedValueOnce(fakeTicket as never);
      mockedNotificationCreate.mockResolvedValueOnce({ id: 'notification-1' } as never);

      await expect(
        createTicketAssignedNotification({
          actorId: 'user-1',
          ticketId: 'ticket-1',
          assigneeId: 'user-456',
          previousAssigneeId: null,
          workspaceId: 'workspace-123',
          tx: prisma,
        }),
      ).resolves.toBeUndefined();

      expect(mockedNotificationCreate).toHaveBeenCalledTimes(1);
    });

    it('does not notify on self-assignment', async () => {
      mockedMembershipFindFirst.mockResolvedValueOnce({ id: 'membership-1' } as never);

      await expect(
        createTicketAssignedNotification({
          actorId: 'user-1',
          ticketId: 'ticket-1',
          assigneeId: 'user-1',
          previousAssigneeId: null,
          workspaceId: 'workspace-123',
          tx: prisma,
        }),
      ).resolves.toBeUndefined();

      expect(mockedNotificationCreate).not.toHaveBeenCalled();
    });
  });

  describe('createTicketStatusChangedNotification', () => {
    it('throws when ticket is missing', async () => {
      mockedTicketFindFirst.mockResolvedValueOnce(null as never);

      await expect(
        createTicketStatusChangedNotification({
          actorId: 'user-1',
          ticketId: 'ticket-1',
          workspaceId: 'workspace-123',
          tx: prisma,
        }),
      ).rejects.toThrow('Ticket ticket-1 not found in workspace workspace-123');
    });

    it('does not notify when actor is the current assignee', async () => {
      mockedTicketFindFirst.mockResolvedValueOnce({ id: 'ticket-1', status: 'open', assignedToId: 'user-456' } as never);

      await expect(
        createTicketStatusChangedNotification({
          actorId: 'user-456',
          ticketId: 'ticket-1',
          workspaceId: 'workspace-123',
          tx: prisma,
        }),
      ).resolves.toBeUndefined();

      expect(mockedNotificationCreate).not.toHaveBeenCalled();
    });
  });
});
