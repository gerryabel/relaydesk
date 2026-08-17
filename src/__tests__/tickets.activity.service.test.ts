import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { prisma as sharedPrisma } from '@/lib/db/prisma';
import {
  createTicket,
  updateTicket,
  closeTicket,
  assignTicket,
  unassignTicket,
} from '@/lib/tickets/server';
import { getCurrentMembership } from '@/lib/workspace/server';
import { getTicketActivities } from '@/lib/tickets/activity';
import type { CreateTicketInput, UpdateTicketInput, AssignTicketInput } from '@/lib/tickets/schema';

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
  responseSlaDeadline: new Date('2025-01-01T12:00:00Z'),
  resolutionSlaDeadline: new Date('2025-01-02T00:00:00Z'),
  firstResponseAt: null,
  resolvedAt: null,
  assignedToId: null,
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

const fakeActivity = {
  id: 'activity-1',
  ticketId: 'ticket-1',
  actorId: 'user-123',
  type: 'TICKET_CREATED',
  metadata: null,
  createdAt: new Date('2025-01-01T00:00:00Z'),
  actor: {
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

describe('ticket activity services', () => {
  beforeEach(() => {
    vi.mocked(getCurrentMembership).mockResolvedValue(fakeMembership as never);
  });

  afterEach(() => {
    vi.resetAllMocks();
  });

  it('createTicket creates ticket and TICKET_CREATED activity in one transaction', async () => {
    const createSpy = vi.spyOn(sharedPrisma.ticket, 'create').mockResolvedValue(fakeTicket as never);
    const transactionSpy = vi.spyOn(sharedPrisma, '$transaction').mockImplementation(async (worker) => {
      const txClient = {
        ticket: { create: createSpy },
        ticketActivity: { create: vi.fn().mockResolvedValue(fakeActivity as never) },
      } as unknown as Parameters<typeof worker>[0];

      return worker(txClient);
    });

    try {
      const ticket = await createTicket({ title: 'Judul Tiket', description: 'Deskripsi', priority: 'medium' } as CreateTicketInput);

      expect(ticket.id).toBe('ticket-1');
      expect(transactionSpy).toHaveBeenCalledTimes(1);
    } finally {
      transactionSpy.mockRestore();
      createSpy.mockRestore();
    }
  });

  it('updateTicket records STATUS_CHANGED when status changes', async () => {
    const findFirstSpy = vi.spyOn(sharedPrisma.ticket, 'findFirst').mockResolvedValue({ id: 'ticket-1', status: 'open', priority: 'medium', resolvedAt: null } as never);
    const transactionSpy = vi.spyOn(sharedPrisma, '$transaction').mockImplementation(async (worker) => {
      const txClient = {
        ticket: { update: vi.fn().mockResolvedValue({ ...fakeTicket, status: 'in_progress' } as never) },
        ticketActivity: { create: vi.fn().mockResolvedValue(fakeActivity as never) },
        notification: { create: vi.fn().mockResolvedValue({ id: 'notification-1' } as never) },
      } as unknown as Parameters<typeof worker>[0];

      return worker(txClient);
    });

    try {
      await updateTicket('ticket-1', { status: 'in_progress' } as UpdateTicketInput);
      expect(transactionSpy).toHaveBeenCalledTimes(1);
    } finally {
      transactionSpy.mockRestore();
      findFirstSpy.mockRestore();
    }
  });

  it('updateTicket records PRIORITY_CHANGED when priority changes', async () => {
    const findFirstSpy = vi.spyOn(sharedPrisma.ticket, 'findFirst').mockResolvedValue({ id: 'ticket-1', status: 'open', priority: 'medium', resolvedAt: null } as never);
    const transactionSpy = vi.spyOn(sharedPrisma, '$transaction').mockImplementation(async (worker) => {
      const txClient = {
        ticket: { update: vi.fn().mockResolvedValue({ ...fakeTicket, priority: 'high' } as never) },
        ticketActivity: { create: vi.fn().mockResolvedValue(fakeActivity as never) },
      } as unknown as Parameters<typeof worker>[0];

      return worker(txClient);
    });

    try {
      await updateTicket('ticket-1', { priority: 'high' } as UpdateTicketInput);
      expect(transactionSpy).toHaveBeenCalledTimes(1);
    } finally {
      transactionSpy.mockRestore();
      findFirstSpy.mockRestore();
    }
  });

  it('updateTicket does not create activity when only title changes', async () => {
    const findFirstSpy = vi.spyOn(sharedPrisma.ticket, 'findFirst').mockResolvedValue({ id: 'ticket-1', status: 'open', priority: 'medium', resolvedAt: null } as never);
    const transactionSpy = vi.spyOn(sharedPrisma, '$transaction');
    const updateSpy = vi.spyOn(sharedPrisma.ticket, 'update').mockResolvedValue({ ...fakeTicket, title: 'Judul Baru' } as never);

    try {
      const ticket = await updateTicket('ticket-1', { title: 'Judul Baru' } as UpdateTicketInput);
      expect(ticket.title).toBe('Judul Baru');
      expect(transactionSpy).not.toHaveBeenCalled();
    } finally {
      transactionSpy.mockRestore();
      findFirstSpy.mockRestore();
      updateSpy.mockRestore();
    }
  });

  it('closeTicket records STATUS_CHANGED when transitioning to closed', async () => {
    const findFirstSpy = vi.spyOn(sharedPrisma.ticket, 'findFirst').mockResolvedValue({ id: 'ticket-1', status: 'resolved' } as never);
    const transactionSpy = vi.spyOn(sharedPrisma, '$transaction').mockImplementation(async (worker) => {
      const txClient = {
        ticket: { update: vi.fn().mockResolvedValue({ ...fakeTicket, status: 'closed' } as never) },
        ticketActivity: { create: vi.fn().mockResolvedValue(fakeActivity as never) },
      } as unknown as Parameters<typeof worker>[0];

      return worker(txClient);
    });

    try {
      await closeTicket('ticket-1');
      expect(transactionSpy).toHaveBeenCalledTimes(1);
    } finally {
      transactionSpy.mockRestore();
      findFirstSpy.mockRestore();
    }
  });

  it('closeTicket does not create activity when ticket is already closed', async () => {
    const findFirstSpy = vi.spyOn(sharedPrisma.ticket, 'findFirst').mockResolvedValue({ id: 'ticket-1', status: 'closed' } as never);
    const transactionSpy = vi.spyOn(sharedPrisma, '$transaction');
    const updateSpy = vi.spyOn(sharedPrisma.ticket, 'update').mockResolvedValue({ ...fakeTicket, status: 'closed' } as never);

    try {
      const ticket = await closeTicket('ticket-1');
      expect(ticket.status).toBe('closed');
      expect(transactionSpy).not.toHaveBeenCalled();
    } finally {
      transactionSpy.mockRestore();
      findFirstSpy.mockRestore();
      updateSpy.mockRestore();
    }
  });

  it('assignTicket records TICKET_ASSIGNED when assignee changes', async () => {
    const findFirstSpy = vi.spyOn(sharedPrisma.ticket, 'findFirst').mockResolvedValue({ id: 'ticket-1', assignedToId: null } as never);
    const membershipSpy = vi.spyOn(sharedPrisma.membership, 'findFirst').mockResolvedValue({ id: 'membership-1' } as never);
    const transactionSpy = vi.spyOn(sharedPrisma, '$transaction').mockImplementation(async (worker) => {
      const txClient = {
        ticket: { update: vi.fn().mockResolvedValue({ ...fakeTicket, assignedToId: 'user-456', assignedTo: fakeAssignee } as never) },
        ticketActivity: { create: vi.fn().mockResolvedValue(fakeActivity as never) },
        notification: { create: vi.fn().mockResolvedValue({ id: 'notification-1' } as never) },
      } as unknown as Parameters<typeof worker>[0];

      return worker(txClient);
    });

    try {
      await assignTicket('ticket-1', { assigneeId: 'user-456' } as AssignTicketInput);
      expect(transactionSpy).toHaveBeenCalledTimes(1);
    } finally {
      transactionSpy.mockRestore();
      findFirstSpy.mockRestore();
      membershipSpy.mockRestore();
    }
  });

  it('assignTicket does not create activity when assignee is the same', async () => {
    const findFirstSpy = vi.spyOn(sharedPrisma.ticket, 'findFirst').mockResolvedValue({ id: 'ticket-1', assignedToId: 'user-456' } as never);
    const membershipSpy = vi.spyOn(sharedPrisma.membership, 'findFirst').mockResolvedValue({ id: 'membership-1' } as never);
    const transactionSpy = vi.spyOn(sharedPrisma, '$transaction');
    const updateSpy = vi.spyOn(sharedPrisma.ticket, 'update').mockResolvedValue({ ...fakeTicket, assignedToId: 'user-456', assignedTo: fakeAssignee } as never);

    try {
      await assignTicket('ticket-1', { assigneeId: 'user-456' } as AssignTicketInput);
      expect(transactionSpy).not.toHaveBeenCalled();
    } finally {
      transactionSpy.mockRestore();
      findFirstSpy.mockRestore();
      membershipSpy.mockRestore();
      updateSpy.mockRestore();
    }
  });

  it('unassignTicket records TICKET_UNASSIGNED when assignee is present', async () => {
    const findFirstSpy = vi.spyOn(sharedPrisma.ticket, 'findFirst').mockResolvedValue({ id: 'ticket-1', assignedToId: 'user-456' } as never);
    const transactionSpy = vi.spyOn(sharedPrisma, '$transaction').mockImplementation(async (worker) => {
      const txClient = {
        ticket: { update: vi.fn().mockResolvedValue({ ...fakeTicket, assignedToId: null, assignedTo: null } as never) },
        ticketActivity: { create: vi.fn().mockResolvedValue(fakeActivity as never) },
      } as unknown as Parameters<typeof worker>[0];

      return worker(txClient);
    });

    try {
      await unassignTicket('ticket-1');
      expect(transactionSpy).toHaveBeenCalledTimes(1);
    } finally {
      transactionSpy.mockRestore();
      findFirstSpy.mockRestore();
    }
  });

  it('unassignTicket does not create activity when ticket is already unassigned', async () => {
    const findFirstSpy = vi.spyOn(sharedPrisma.ticket, 'findFirst').mockResolvedValue({ id: 'ticket-1', assignedToId: null } as never);
    const transactionSpy = vi.spyOn(sharedPrisma, '$transaction');
    const updateSpy = vi.spyOn(sharedPrisma.ticket, 'update').mockResolvedValue({ ...fakeTicket, assignedToId: null, assignedTo: null } as never);

    try {
      await unassignTicket('ticket-1');
      expect(transactionSpy).not.toHaveBeenCalled();
    } finally {
      transactionSpy.mockRestore();
      findFirstSpy.mockRestore();
      updateSpy.mockRestore();
    }
  });

  it('getTicketActivities returns activities ordered by createdAt and scoped by ticket', async () => {
    const findFirstSpy = vi.spyOn(sharedPrisma.ticket, 'findFirst').mockResolvedValue({ id: 'ticket-1' } as never);
    const findManySpy = vi.spyOn(sharedPrisma.ticketActivity, 'findMany').mockResolvedValue([fakeActivity] as never);

    try {
      const activities = await getTicketActivities('ticket-1');
      expect(activities).toHaveLength(1);
      expect(findManySpy).toHaveBeenCalledWith({
        where: { ticketId: 'ticket-1' },
        include: expect.any(Object),
        orderBy: { createdAt: 'asc' },
      });
    } finally {
      findFirstSpy.mockRestore();
      findManySpy.mockRestore();
    }
  });
});
