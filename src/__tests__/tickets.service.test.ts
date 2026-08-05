import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { prisma as sharedPrisma } from '@/lib/db/prisma';
import {
  createTicket,
  getTickets,
  getTicketById,
  updateTicket,
  closeTicket,
  TicketNotFoundError,
} from '@/lib/tickets/server';
import { getCurrentMembership } from '@/lib/workspace/server';
import type { UpdateTicketInput } from '@/lib/tickets/schema';

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

const mockedGetCurrentMembership = vi.mocked(getCurrentMembership);

describe('ticket services', () => {
  beforeEach(() => {
    vi.mocked(getCurrentMembership).mockResolvedValue(fakeMembership as never);
  });

  afterEach(() => {
    vi.resetAllMocks();
  });

  it('createTicket creates a ticket in the current workspace', async () => {
    const createSpy = vi.spyOn(sharedPrisma.ticket, 'create').mockResolvedValue(fakeTicket as never);

    try {
      const ticket = await createTicket({
        title: 'Judul Tiket',
        description: 'Deskripsi',
        priority: 'medium',
      });

      expect(createSpy).toHaveBeenCalledWith({
        data: {
          workspaceId: 'workspace-123',
          title: 'Judul Tiket',
          description: 'Deskripsi',
          priority: 'medium',
          createdById: 'user-123',
        },
        include: { createdBy: true },
      });
      expect(ticket.id).toBe('ticket-1');
    } finally {
      createSpy.mockRestore();
    }
  });

  it('getTickets returns workspace-scoped tickets', async () => {
    const findManySpy = vi
      .spyOn(sharedPrisma.ticket, 'findMany')
      .mockResolvedValue([fakeTicket] as never);

    try {
      const tickets = await getTickets({ status: 'open', priority: 'medium' });

      expect(findManySpy).toHaveBeenCalledWith({
        where: { workspaceId: 'workspace-123', status: 'open', priority: 'medium' },
        include: { createdBy: true },
        orderBy: { createdAt: 'desc' },
      });
      expect(tickets).toHaveLength(1);
    } finally {
      findManySpy.mockRestore();
    }
  });

  it('getTicketById throws TicketNotFoundError when ticket does not exist', async () => {
    const findFirstSpy = vi
      .spyOn(sharedPrisma.ticket, 'findFirst')
      .mockResolvedValue(null as never);

    try {
      await expect(getTicketById('missing')).rejects.toThrow(TicketNotFoundError);
      expect(findFirstSpy).toHaveBeenCalledWith({
        where: { id: 'missing', workspaceId: 'workspace-123' },
        include: { createdBy: true },
      });
    } finally {
      findFirstSpy.mockRestore();
    }
  });

  it('updateTicket updates within the current workspace', async () => {
    const findFirstSpy = vi
      .spyOn(sharedPrisma.ticket, 'findFirst')
      .mockResolvedValue({ id: 'ticket-1' } as never);

    const updateSpy = vi.spyOn(sharedPrisma.ticket, 'update').mockResolvedValue(fakeTicket as never);

    try {
      const ticket = await updateTicket('ticket-1', {
        title: 'Judul Baru',
        description: null,
        status: 'in_progress',
      });

      expect(findFirstSpy).toHaveBeenCalledWith({
        where: { id: 'ticket-1', workspaceId: 'workspace-123' },
        select: { id: true },
      });
      expect(updateSpy).toHaveBeenCalledWith({
        where: { id: 'ticket-1' },
        data: { title: 'Judul Baru', description: null, status: 'in_progress' },
        include: { createdBy: true },
      });
      expect(ticket.id).toBe('ticket-1');
    } finally {
      findFirstSpy.mockRestore();
      updateSpy.mockRestore();
    }
  });

  it('closeTicket closes a ticket', async () => {
    const findFirstSpy = vi
      .spyOn(sharedPrisma.ticket, 'findFirst')
      .mockResolvedValue({ id: 'ticket-1' } as never);

    const updateSpy = vi.spyOn(sharedPrisma.ticket, 'update').mockResolvedValue({
      ...fakeTicket,
      status: 'closed',
    } as never);

    try {
      const ticket = await closeTicket('ticket-1');

      expect(findFirstSpy).toHaveBeenCalledWith({
        where: { id: 'ticket-1', workspaceId: 'workspace-123' },
        select: { id: true },
      });
      expect(updateSpy).toHaveBeenCalledWith({
        where: { id: 'ticket-1' },
        data: { status: 'closed' },
        include: { createdBy: true },
      });
      expect(ticket.status).toBe('closed');
    } finally {
      findFirstSpy.mockRestore();
      updateSpy.mockRestore();
    }
  });

  it('does not return tickets from another workspace', async () => {
    const findFirstSpy = vi
      .spyOn(sharedPrisma.ticket, 'findFirst')
      .mockResolvedValue(null as never);

    try {
      await expect(getTicketById('ticket-2')).rejects.toThrow(TicketNotFoundError);
      expect(findFirstSpy).toHaveBeenCalledWith({
        where: { id: 'ticket-2', workspaceId: 'workspace-123' },
        include: { createdBy: true },
      });
    } finally {
      findFirstSpy.mockRestore();
    }
  });

  it('createTicket rejects invalid input', async () => {
    await expect(createTicket({ title: '', description: null, priority: 'medium' })).rejects.toThrow();
  });

  it('updateTicket rejects invalid input', async () => {
    const findFirstSpy = vi
      .spyOn(sharedPrisma.ticket, 'findFirst')
      .mockResolvedValue({ id: 'ticket-1' } as never);

    try {
      await expect(updateTicket('ticket-1', { description: null, status: 'invalid' as UpdateTicketInput['status'] })).rejects.toThrow();
    } finally {
      findFirstSpy.mockRestore();
    }
  });

  it('getTicketById throws when membership is missing', async () => {
    mockedGetCurrentMembership.mockRejectedValueOnce(new Error('No workspace membership found') as never);

    try {
      await expect(getTicketById('ticket-1')).rejects.toThrow('No workspace membership found');
    } finally {
      mockedGetCurrentMembership.mockReset();
    }
  });
});
