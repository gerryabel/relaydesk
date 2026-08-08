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
import { ticketFiltersSchema } from '@/lib/tickets/schema';
import type { TicketFiltersInput } from '@/lib/tickets/schema';
import { parseFilters } from '@/app/dashboard/tickets/page';

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
    const countSpy = vi.spyOn(sharedPrisma.ticket, 'count').mockResolvedValue(1 as never);

    try {
      const tickets = await getTickets({ status: 'open', priority: 'medium' });

      expect(countSpy).toHaveBeenCalledWith({
        where: {
          workspaceId: 'workspace-123',
          status: 'open',
          priority: 'medium',
        },
      });
      expect(findManySpy).toHaveBeenCalledWith({
        where: {
          workspaceId: 'workspace-123',
          status: 'open',
          priority: 'medium',
        },
        include: { createdBy: true },
        orderBy: { createdAt: 'desc' },
        skip: 0,
        take: 20,
      });
      expect(tickets.data).toHaveLength(1);
      expect(tickets.total).toBe(1);
    } finally {
      findManySpy.mockRestore();
      countSpy.mockRestore();
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
      .mockResolvedValue({ id: 'ticket-1', status: 'open' } as never);

    const updateSpy = vi.spyOn(sharedPrisma.ticket, 'update').mockResolvedValue(fakeTicket as never);

    try {
      const ticket = await updateTicket('ticket-1', {
        title: 'Judul Baru',
        description: null,
        status: 'in_progress',
      });

      expect(findFirstSpy).toHaveBeenCalledWith({
        where: { id: 'ticket-1', workspaceId: 'workspace-123' },
        select: { id: true, status: true },
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
      .mockResolvedValue({ id: 'ticket-1', status: 'resolved' } as never);

    const updateSpy = vi.spyOn(sharedPrisma.ticket, 'update').mockResolvedValue({
      ...fakeTicket,
      status: 'closed',
    } as never);

    try {
      const ticket = await closeTicket('ticket-1');

      expect(findFirstSpy).toHaveBeenCalledWith({
        where: { id: 'ticket-1', workspaceId: 'workspace-123' },
        select: { id: true, status: true },
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

  it('getTickets filters by status only', async () => {
    const findManySpy = vi
      .spyOn(sharedPrisma.ticket, 'findMany')
      .mockResolvedValue([] as never);
    const countSpy = vi.spyOn(sharedPrisma.ticket, 'count').mockResolvedValue(0 as never);

    try {
      await getTickets({ status: 'closed' });

      expect(countSpy).toHaveBeenCalledWith({
        where: { workspaceId: 'workspace-123', status: 'closed' },
      });
      expect(findManySpy).toHaveBeenCalledWith({
        where: { workspaceId: 'workspace-123', status: 'closed' },
        include: { createdBy: true },
        orderBy: { createdAt: 'desc' },
        skip: 0,
        take: 20,
      });
    } finally {
      findManySpy.mockRestore();
      countSpy.mockRestore();
    }
  });

  it('getTickets filters by priority only', async () => {
    const findManySpy = vi
      .spyOn(sharedPrisma.ticket, 'findMany')
      .mockResolvedValue([] as never);
    const countSpy = vi.spyOn(sharedPrisma.ticket, 'count').mockResolvedValue(0 as never);

    try {
      await getTickets({ priority: 'high' });

      expect(countSpy).toHaveBeenCalledWith({
        where: { workspaceId: 'workspace-123', priority: 'high' },
      });
      expect(findManySpy).toHaveBeenCalledWith({
        where: { workspaceId: 'workspace-123', priority: 'high' },
        include: { createdBy: true },
        orderBy: { createdAt: 'desc' },
        skip: 0,
        take: 20,
      });
    } finally {
      findManySpy.mockRestore();
      countSpy.mockRestore();
    }
  });

  it('getTickets combines search and status filters', async () => {
    const findManySpy = vi
      .spyOn(sharedPrisma.ticket, 'findMany')
      .mockResolvedValue([] as never);
    const countSpy = vi.spyOn(sharedPrisma.ticket, 'count').mockResolvedValue(0 as never);

    try {
      await getTickets({ status: 'open', search: 'Deskripsi' });

      expect(countSpy).toHaveBeenCalledWith({
        where: {
          workspaceId: 'workspace-123',
          status: 'open',
          title: { contains: 'Deskripsi', mode: 'insensitive' },
        },
      });
      expect(findManySpy).toHaveBeenCalledWith({
        where: {
          workspaceId: 'workspace-123',
          status: 'open',
          title: { contains: 'Deskripsi', mode: 'insensitive' },
        },
        include: { createdBy: true },
        orderBy: { createdAt: 'desc' },
        skip: 0,
        take: 20,
      });
    } finally {
      findManySpy.mockRestore();
      countSpy.mockRestore();
    }
  });

  it('getTickets combines search and priority filters', async () => {
    const findManySpy = vi
      .spyOn(sharedPrisma.ticket, 'findMany')
      .mockResolvedValue([] as never);
    const countSpy = vi.spyOn(sharedPrisma.ticket, 'count').mockResolvedValue(0 as never);

    try {
      await getTickets({ priority: 'low', search: 'Judul Tiket' });

      expect(countSpy).toHaveBeenCalledWith({
        where: {
          workspaceId: 'workspace-123',
          priority: 'low',
          title: { contains: 'Judul Tiket', mode: 'insensitive' },
        },
      });
      expect(findManySpy).toHaveBeenCalledWith({
        where: {
          workspaceId: 'workspace-123',
          priority: 'low',
          title: { contains: 'Judul Tiket', mode: 'insensitive' },
        },
        include: { createdBy: true },
        orderBy: { createdAt: 'desc' },
        skip: 0,
        take: 20,
      });
    } finally {
      findManySpy.mockRestore();
      countSpy.mockRestore();
    }
  });

  it('getTickets combines search, status, and priority filters', async () => {
    const findManySpy = vi
      .spyOn(sharedPrisma.ticket, 'findMany')
      .mockResolvedValue([] as never);
    const countSpy = vi.spyOn(sharedPrisma.ticket, 'count').mockResolvedValue(0 as never);

    try {
      await getTickets({ status: 'resolved', priority: 'urgent', search: 'Pencarian' });

      expect(countSpy).toHaveBeenCalledWith({
        where: {
          workspaceId: 'workspace-123',
          status: 'resolved',
          priority: 'urgent',
          title: { contains: 'Pencarian', mode: 'insensitive' },
        },
      });
      expect(findManySpy).toHaveBeenCalledWith({
        where: {
          workspaceId: 'workspace-123',
          status: 'resolved',
          priority: 'urgent',
          title: { contains: 'Pencarian', mode: 'insensitive' },
        },
        include: { createdBy: true },
        orderBy: { createdAt: 'desc' },
        skip: 0,
        take: 20,
      });
    } finally {
      findManySpy.mockRestore();
      countSpy.mockRestore();
    }
  });

  it('getTickets paginates the first page', async () => {
    const findManySpy = vi
      .spyOn(sharedPrisma.ticket, 'findMany')
      .mockResolvedValue([fakeTicket] as never);
    const countSpy = vi.spyOn(sharedPrisma.ticket, 'count').mockResolvedValue(1 as never);

    try {
      const result = await getTickets({ page: 1, limit: 1 });

      expect(countSpy).toHaveBeenCalledWith({
        where: { workspaceId: 'workspace-123' },
      });
      expect(findManySpy).toHaveBeenCalledWith({
        where: { workspaceId: 'workspace-123' },
        include: { createdBy: true },
        orderBy: { createdAt: 'desc' },
        skip: 0,
        take: 1,
      });
      expect(result.data).toHaveLength(1);
      expect(result.page).toBe(1);
      expect(result.limit).toBe(1);
      expect(result.total).toBe(1);
      expect(result.totalPages).toBe(1);
      expect(result.hasPreviousPage).toBe(false);
      expect(result.hasNextPage).toBe(false);
    } finally {
      findManySpy.mockRestore();
      countSpy.mockRestore();
    }
  });

  it('getTickets paginates the last page', async () => {
    const findManySpy = vi
      .spyOn(sharedPrisma.ticket, 'findMany')
      .mockResolvedValue([fakeTicket] as never);
    const countSpy = vi.spyOn(sharedPrisma.ticket, 'count').mockResolvedValue(2 as never);

    try {
      const result = await getTickets({ page: 2, limit: 1 });

      expect(countSpy).toHaveBeenCalledWith({
        where: { workspaceId: 'workspace-123' },
      });
      expect(findManySpy).toHaveBeenCalledWith({
        where: { workspaceId: 'workspace-123' },
        include: { createdBy: true },
        orderBy: { createdAt: 'desc' },
        skip: 1,
        take: 1,
      });
      expect(result.data).toHaveLength(1);
      expect(result.page).toBe(2);
      expect(result.totalPages).toBe(2);
      expect(result.hasPreviousPage).toBe(true);
      expect(result.hasNextPage).toBe(false);
    } finally {
      findManySpy.mockRestore();
      countSpy.mockRestore();
    }
  });

  it('getTickets returns empty data for an invalid page', async () => {
    const findManySpy = vi
      .spyOn(sharedPrisma.ticket, 'findMany')
      .mockResolvedValue([] as never);
    const countSpy = vi.spyOn(sharedPrisma.ticket, 'count').mockResolvedValue(0 as never);

    try {
      const result = await getTickets({ page: 5, limit: 10 });

      expect(result.data).toHaveLength(0);
      expect(result.page).toBe(1);
      expect(result.total).toBe(0);
      expect(result.totalPages).toBe(1);
    } finally {
      findManySpy.mockRestore();
      countSpy.mockRestore();
    }
  });

  it('getTickets preserves pagination with search and filters', async () => {
    const findManySpy = vi
      .spyOn(sharedPrisma.ticket, 'findMany')
      .mockResolvedValue([fakeTicket] as never);
    const countSpy = vi.spyOn(sharedPrisma.ticket, 'count').mockResolvedValue(1 as never);

    try {
      const result = await getTickets({ status: 'open', search: 'Pencarian', sort: { field: 'title', direction: 'asc' }, page: 1, limit: 10 });

      expect(countSpy).toHaveBeenCalledWith({
        where: {
          workspaceId: 'workspace-123',
          status: 'open',
          title: { contains: 'Pencarian', mode: 'insensitive' },
        },
      });
      expect(findManySpy).toHaveBeenCalledWith({
        where: {
          workspaceId: 'workspace-123',
          status: 'open',
          title: { contains: 'Pencarian', mode: 'insensitive' },
        },
        include: { createdBy: true },
        orderBy: { title: 'asc' },
        skip: 0,
        take: 10,
      });
      expect(result.data).toHaveLength(1);
      expect(result.total).toBe(1);
    } finally {
      findManySpy.mockRestore();
      countSpy.mockRestore();
    }
  });

  it('getTickets rejects invalid status enum', async () => {
    await expect(getTickets({ status: 'invalid' } as never)).rejects.toThrow();
  });

  it('getTickets rejects invalid priority enum', async () => {
    await expect(getTickets({ priority: 'invalid' } as never)).rejects.toThrow();
  });

  it('ticketFiltersSchema rejects invalid status enum', () => {
    expect(() =>
      ticketFiltersSchema.parse({
        search: 'Judul Tiket',
        status: 'invalid' as TicketFiltersInput['status'],
      })
    ).toThrow();
  });

  it('ticketFiltersSchema rejects invalid priority enum', () => {
    expect(() =>
      ticketFiltersSchema.parse({
        search: 'Judul Tiket',
        priority: 'invalid' as TicketFiltersInput['priority'],
      })
    ).toThrow();
  });

  it('parseFilters preserves valid fields when one query parameter is invalid', () => {
    const filters = parseFilters({
      search: 'login',
      status: 'INVALID',
      priority: 'high',
    } as Record<string, unknown>);

    expect(filters).toEqual({ search: 'login', status: undefined, priority: 'high' });
  });

  it('parseFilters returns empty filters when all query parameters are invalid', () => {
    const filters = parseFilters({
      search: '',
      status: 'INVALID',
      priority: 'INVALID',
    } as Record<string, unknown>);

    expect(filters).toEqual({ search: '', status: undefined, priority: undefined });
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
});
