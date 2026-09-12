import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { prisma as sharedPrisma } from '@/lib/db/prisma';
import {
  createTicket,
  getTickets,
  getTicketById,
  updateTicket,
  closeTicket,
  assignTicket,
  unassignTicket,
  TicketNotFoundError,
  AssigneeNotInWorkspaceError,
} from '@/lib/tickets/server';
import { getCurrentMembership } from '@/lib/workspace/server';
import type { AssignTicketInput } from '@/lib/tickets/schema';

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

const fakeAssignee = {
  id: 'user-456',
  email: 'assignee@example.com',
  emailVerified: true,
  name: 'Assignee',
  image: null,
  createdAt: new Date('2025-01-01T00:00:00Z'),
  updatedAt: new Date('2025-01-01T00:00:00Z'),
};

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

vi.mock('@/lib/workspace/server', () => ({
  getCurrentMembership: vi.fn(),
}));

vi.mock('@/lib/notifications/server', () => ({
  createTicketAssignedNotification: vi.fn().mockResolvedValue(undefined),
  createTicketStatusChangedNotification: vi.fn().mockResolvedValue(undefined),
}));

describe('ticket assignment services', () => {
  beforeEach(() => {
    vi.mocked(getCurrentMembership).mockResolvedValue(fakeMembership as never);
  });

  afterEach(() => {
    vi.resetAllMocks();
  });

  it('assignTicket updates assignedToId within the current workspace', async () => {
    const findFirstSpy = vi
      .spyOn(sharedPrisma.ticket, 'findFirst')
      .mockResolvedValue({ id: 'ticket-1', assignedToId: null } as never);
    const membershipSpy = vi
      .spyOn(sharedPrisma.membership, 'findFirst')
      .mockResolvedValue({ id: 'membership-1' } as never);
    const transactionSpy = vi.spyOn(sharedPrisma, '$transaction').mockImplementation(async (worker) => {
      const txClient = {
        ticket: {
          update: vi.fn().mockResolvedValue({ ...fakeTicket, assignedToId: 'user-456', assignedTo: fakeAssignee } as never),
        },
        ticketActivity: {
          create: vi.fn().mockResolvedValue({ id: 'activity-1' } as never),
        },
        notification: {
          create: vi.fn().mockResolvedValue({
            id: 'notification-1',
            userId: 'user-456',
            workspaceId: 'workspace-123',
            ticketId: 'ticket-1',
            type: 'TICKET_ASSIGNED',
            title: 'Ticket assigned to you',
            body: 'Ticket #ticket-1 was assigned to you.',
            readAt: null,
            createdAt: new Date('2025-01-01T00:00:00Z'),
            updatedAt: new Date('2025-01-01T00:00:00Z'),
            ticket: {
              id: 'ticket-1',
              title: 'Judul Tiket',
              status: 'open',
            },
          } as never),
        },
        outboxEvent: {
          create: vi.fn().mockResolvedValue({ id: 'outbox-1' } as never),
        },
      } as never;

      return worker(txClient);
    });

    try {
      const ticket = await assignTicket('ticket-1', { assigneeId: 'user-456' } as AssignTicketInput);

      expect(findFirstSpy).toHaveBeenCalledWith({
        where: { id: 'ticket-1', workspaceId: 'workspace-123' },
        select: { id: true, assignedToId: true },
      });
      expect(membershipSpy).toHaveBeenCalledWith({
        where: { userId: 'user-456', workspaceId: 'workspace-123' },
        select: { id: true },
      });
      expect(transactionSpy).toHaveBeenCalledTimes(1);
      expect(ticket.assignedTo?.id).toBe('user-456');
    } finally {
      findFirstSpy.mockRestore();
      membershipSpy.mockRestore();
      transactionSpy.mockRestore();
    }
  });

  it('unassignTicket clears assignedToId within the current workspace', async () => {
    const findFirstSpy = vi
      .spyOn(sharedPrisma.ticket, 'findFirst')
      .mockResolvedValue({ id: 'ticket-1', assignedToId: 'user-456' } as never);
    const transactionSpy = vi.spyOn(sharedPrisma, '$transaction').mockImplementation(async (worker) => {
      const txClient = {
        ticket: {
          update: vi.fn().mockResolvedValue({ ...fakeTicket, assignedToId: null, assignedTo: null } as never),
        },
        ticketActivity: {
          create: vi.fn().mockResolvedValue({ id: 'activity-1' } as never),
        },
      } as never;

      return worker(txClient);
    });

    try {
      const ticket = await unassignTicket('ticket-1');

      expect(findFirstSpy).toHaveBeenCalledWith({
        where: { id: 'ticket-1', workspaceId: 'workspace-123' },
        select: { id: true, assignedToId: true },
      });
      expect(transactionSpy).toHaveBeenCalledTimes(1);
      expect(ticket.assignedTo).toBeNull();
    } finally {
      findFirstSpy.mockRestore();
      transactionSpy.mockRestore();
    }
  });

  it('assignTicket rejects assignee who is not in the workspace', async () => {
    const findFirstSpy = vi
      .spyOn(sharedPrisma.ticket, 'findFirst')
      .mockResolvedValue({ id: 'ticket-1' } as never);
    const membershipSpy = vi
      .spyOn(sharedPrisma.membership, 'findFirst')
      .mockResolvedValue(null as never);

    try {
      await expect(assignTicket('ticket-1', { assigneeId: 'user-999' } as AssignTicketInput)).rejects.toThrow(
        AssigneeNotInWorkspaceError,
      );

      expect(membershipSpy).toHaveBeenCalledWith({
        where: { userId: 'user-999', workspaceId: 'workspace-123' },
        select: { id: true },
      });
    } finally {
      findFirstSpy.mockRestore();
      membershipSpy.mockRestore();
    }
  });

  it('assignTicket throws TicketNotFoundError for ticket outside workspace', async () => {
    const findFirstSpy = vi
      .spyOn(sharedPrisma.ticket, 'findFirst')
      .mockResolvedValue(null as never);

    try {
      await expect(assignTicket('ticket-2', { assigneeId: 'user-456' } as AssignTicketInput)).rejects.toThrow(
        TicketNotFoundError,
      );
    } finally {
      findFirstSpy.mockRestore();
    }
  });

  it('assignTicket rejects invalid input', async () => {
    await expect(assignTicket('ticket-1', { assigneeId: '' } as AssignTicketInput)).rejects.toThrow();
  });

  it('unassignTicket throws TicketNotFoundError for missing ticket', async () => {
    const findFirstSpy = vi
      .spyOn(sharedPrisma.ticket, 'findFirst')
      .mockResolvedValue(null as never);

    try {
      await expect(unassignTicket('missing')).rejects.toThrow(TicketNotFoundError);
    } finally {
      findFirstSpy.mockRestore();
    }
  });

  it('preserves existing create/update/close/getTicketById behavior', async () => {
    const transactionSpy = vi.spyOn(sharedPrisma, '$transaction').mockImplementation(async (worker) => {
      const txClient = {
        ticket: {
          create: vi.fn().mockResolvedValue(fakeTicket as never),
          update: vi.fn().mockImplementation((args: never) => {
            const data = (args as { data?: Partial<typeof fakeTicket> }).data ?? {};
            return Promise.resolve({ ...fakeTicket, ...data } as never);
          }),
        },
        ticketActivity: {
          create: vi.fn().mockResolvedValue({ id: 'activity-1' } as never),
        },
        notification: {
          create: vi.fn().mockResolvedValue({ id: 'notification-1' } as never),
        },
      } as never;

      return worker(txClient);
    });
    const countSpy = vi.spyOn(sharedPrisma.ticket, 'count').mockResolvedValue(1 as never);
    const findManySpy = vi.spyOn(sharedPrisma.ticket, 'findMany').mockResolvedValue([fakeTicket] as never);
    const findFirstSpy = vi
      .spyOn(sharedPrisma.ticket, 'findFirst')
      .mockResolvedValueOnce({ id: 'ticket-1', status: 'open' } as never)
      .mockResolvedValueOnce({ id: 'ticket-1', status: 'in_progress' } as never)
      .mockResolvedValueOnce({ id: 'ticket-1', status: 'resolved' } as never)
      .mockResolvedValueOnce({ ...fakeTicket, status: 'resolved' } as never);

    try {
      const created = await createTicket({ title: 'Judul Tiket', description: 'Deskripsi', priority: 'medium' });
      expect(created.id).toBe('ticket-1');

      const updated = await updateTicket('ticket-1', { status: 'in_progress', description: null });
      expect(updated.status).toBe('in_progress');

      const resolved = await updateTicket('ticket-1', { status: 'resolved', description: null });
      expect(resolved.status).toBe('resolved');

      const closed = await closeTicket('ticket-1');
      expect(closed.status).toBe('closed');

      const detail = await getTicketById('ticket-1');
      expect(detail.id).toBe('ticket-1');

      const tickets = await getTickets({});
      expect(tickets.data).toHaveLength(1);

      expect(transactionSpy).toHaveBeenCalledTimes(4);
      expect(closeTicket).toBeDefined();
      expect(getTicketById).toBeDefined();
      expect(getTickets).toBeDefined();
    } finally {
      transactionSpy.mockRestore();
      countSpy.mockRestore();
      findManySpy.mockRestore();
      findFirstSpy.mockRestore();
    }
  });
});
