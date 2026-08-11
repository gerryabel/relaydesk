import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { prisma as sharedPrisma } from '@/lib/db/prisma';
import { getTickets } from '@/lib/tickets/server';
import { getCurrentMembership } from '@/lib/workspace/server';
import { ticketQuerySchema, normalizeTicketQuery } from '@/lib/tickets/search';
import type { TicketQueryInput } from '@/lib/tickets/search';

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
  createdBy: {
    id: 'user-123',
    email: 'user@example.com',
    emailVerified: true,
    name: 'User 123',
    image: null,
    createdAt: new Date('2025-01-01T00:00:00Z'),
    updatedAt: new Date('2025-01-01T00:00:00Z'),
  },
} as const;

describe('ticket search', () => {
  beforeEach(() => {
    vi.mocked(getCurrentMembership).mockResolvedValue(fakeMembership as never);
  });

  afterEach(() => {
    vi.resetAllMocks();
  });

  it('ticketQuerySchema trims and accepts valid search input', () => {
    const parsed = ticketQuerySchema.safeParse({ q: '  tiket ' });
    expect(parsed.success).toBe(true);
    if (parsed.success) {
      expect(parsed.data.q).toBe('tiket');
    }
  });

  it('ticketQuerySchema rejects input longer than 200 characters', () => {
    const parsed = ticketQuerySchema.safeParse({ q: 'a'.repeat(201) });
    expect(parsed.success).toBe(false);
    expect(parsed.error?.issues[0]?.message).toBe('Kata kunci pencarian maksimal 200 karakter');
  });

  it('ticketQuerySchema accepts missing q', () => {
    const parsed = ticketQuerySchema.safeParse({});
    expect(parsed.success).toBe(true);
    if (parsed.success) {
      expect(parsed.data.q).toBeUndefined();
    }
  });

  it('ticketQuerySchema treats whitespace-only input as empty', () => {
    const parsed = ticketQuerySchema.safeParse({ q: '   ' });
    expect(parsed.success).toBe(true);
    if (parsed.success) {
      expect(parsed.data.q).toBe('');
    }
  });

  it('normalizeTicketQuery preserves raw q and ignores invalid sort', () => {
    const normalized = normalizeTicketQuery({ q: '  login  ', sort: '  invalid  ' } satisfies TicketQueryInput);
    expect(normalized.q).toBe('  login  ');
    expect(normalized.sort).toBeUndefined();
  });

  it('normalizeTicketQuery leaves q empty when search input is empty', () => {
    const normalized = normalizeTicketQuery({ q: '' } satisfies TicketQueryInput);
    expect(normalized.q).toBe('');
    expect(normalized.sort).toBeUndefined();
  });

  it('normalizeTicketQuery ignores invalid sort without throwing', () => {
    const normalized = normalizeTicketQuery({ q: 'test', sort: 'invalid' } satisfies TicketQueryInput);
    expect(normalized.q).toBe('test');
    expect(normalized.sort).toBeUndefined();
  });

  it('getTickets returns matching tickets for a search query', async () => {
    const findManySpy = vi.spyOn(sharedPrisma.ticket, 'findMany').mockResolvedValue([fakeTicket] as never);
    const countSpy = vi.spyOn(sharedPrisma.ticket, 'count').mockResolvedValue(1 as never);

    try {
      const result = await getTickets({ search: 'Judul' });

      expect(countSpy).toHaveBeenCalledTimes(1);
      expect(countSpy).toHaveBeenCalledWith({
        where: {
          workspaceId: 'workspace-123',
          title: { contains: 'Judul', mode: 'insensitive' },
        },
      });
      expect(findManySpy).toHaveBeenCalledTimes(1);
      expect(findManySpy).toHaveBeenCalledWith({
        where: {
          workspaceId: 'workspace-123',
          title: { contains: 'Judul', mode: 'insensitive' },
        },
        include: { createdBy: true },
        orderBy: { createdAt: 'desc' },
        skip: 0,
        take: 20,
      });
      expect(result.data).toHaveLength(1);
    } finally {
      findManySpy.mockRestore();
      countSpy.mockRestore();
    }
  });

  it('getTickets returns empty results when no tickets match', async () => {
    const findManySpy = vi.spyOn(sharedPrisma.ticket, 'findMany').mockResolvedValue([] as never);
    const countSpy = vi.spyOn(sharedPrisma.ticket, 'count').mockResolvedValue(0 as never);

    try {
      const tickets = await getTickets({ search: 'tidak-ada' });

      expect(countSpy).toHaveBeenCalledWith({
        where: {
          workspaceId: 'workspace-123',
          title: { contains: 'tidak-ada', mode: 'insensitive' },
        },
      });
      expect(tickets.data).toHaveLength(0);
      expect(tickets.total).toBe(0);
    } finally {
      findManySpy.mockRestore();
      countSpy.mockRestore();
    }
  });

  it('getTickets preserves workspace isolation with search', async () => {
    const findManySpy = vi.spyOn(sharedPrisma.ticket, 'findMany').mockResolvedValue([fakeTicket] as never);
    const countSpy = vi.spyOn(sharedPrisma.ticket, 'count').mockResolvedValue(1 as never);

    try {
      const result = await getTickets({ search: 'Judul' });

      expect(findManySpy).toHaveBeenCalledTimes(1);
      expect(countSpy).toHaveBeenCalledTimes(1);
      expect(findManySpy.mock.calls[0]![0]).toBeDefined();
      expect((findManySpy.mock.calls[0]![0] as Record<string, unknown>).where).toEqual(
        expect.objectContaining({ workspaceId: 'workspace-123' }),
      );
      expect(result.data).toHaveLength(1);
    } finally {
      findManySpy.mockRestore();
      countSpy.mockRestore();
    }
  });

  it('getTickets supports OR search through object query input', async () => {
    const findManySpy = vi.spyOn(sharedPrisma.ticket, 'findMany').mockResolvedValue([fakeTicket] as never);
    const countSpy = vi.spyOn(sharedPrisma.ticket, 'count').mockResolvedValue(1 as never);

    try {
      await getTickets({ search: { q: 'Judul' } });

      expect(countSpy).toHaveBeenCalledWith({
        where: {
          workspaceId: 'workspace-123',
          OR: [
            { title: { contains: 'Judul', mode: 'insensitive' } },
            { description: { contains: 'Judul', mode: 'insensitive' } },
            { createdBy: { name: { contains: 'Judul', mode: 'insensitive' } } },
            { assignedTo: { name: { contains: 'Judul', mode: 'insensitive' } } },
          ],
        },
      });
      expect(findManySpy).toHaveBeenCalledWith({
        where: {
          workspaceId: 'workspace-123',
          OR: [
            { title: { contains: 'Judul', mode: 'insensitive' } },
            { description: { contains: 'Judul', mode: 'insensitive' } },
            { createdBy: { name: { contains: 'Judul', mode: 'insensitive' } } },
            { assignedTo: { name: { contains: 'Judul', mode: 'insensitive' } } },
          ],
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

  it('getTickets supports creator name search through object query input', async () => {
    const findManySpy = vi.spyOn(sharedPrisma.ticket, 'findMany').mockResolvedValue([fakeTicket] as never);
    const countSpy = vi.spyOn(sharedPrisma.ticket, 'count').mockResolvedValue(1 as never);

    try {
      await getTickets({ search: { q: 'user 123' } });

      expect(countSpy).toHaveBeenCalledWith({
        where: {
          workspaceId: 'workspace-123',
          OR: [
            { title: { contains: 'user 123', mode: 'insensitive' } },
            { description: { contains: 'user 123', mode: 'insensitive' } },
            { createdBy: { name: { contains: 'user 123', mode: 'insensitive' } } },
            { assignedTo: { name: { contains: 'user 123', mode: 'insensitive' } } },
          ],
        },
      });
    } finally {
      findManySpy.mockRestore();
      countSpy.mockRestore();
    }
  });

  it('getTickets supports assignee name search through object query input', async () => {
    const assignedTicket = {
      ...fakeTicket,
      assignedTo: {
        id: 'user-456',
        email: 'assignee@example.com',
        emailVerified: true,
        name: 'Assignee 456',
        image: null,
        createdAt: new Date('2025-01-01T00:00:00Z'),
        updatedAt: new Date('2025-01-01T00:00:00Z'),
      },
    };
    const findManySpy = vi.spyOn(sharedPrisma.ticket, 'findMany').mockResolvedValue([assignedTicket] as never);
    const countSpy = vi.spyOn(sharedPrisma.ticket, 'count').mockResolvedValue(1 as never);

    try {
      await getTickets({ search: { q: 'assignee 456' } });

      expect(countSpy).toHaveBeenCalledWith({
        where: {
          workspaceId: 'workspace-123',
          OR: [
            { title: { contains: 'assignee 456', mode: 'insensitive' } },
            { description: { contains: 'assignee 456', mode: 'insensitive' } },
            { createdBy: { name: { contains: 'assignee 456', mode: 'insensitive' } } },
            { assignedTo: { name: { contains: 'assignee 456', mode: 'insensitive' } } },
          ],
        },
      });
    } finally {
      findManySpy.mockRestore();
      countSpy.mockRestore();
    }
  });

  it('getTickets preserves search with sorting', async () => {
    const findManySpy = vi.spyOn(sharedPrisma.ticket, 'findMany').mockResolvedValue([fakeTicket] as never);
    const countSpy = vi.spyOn(sharedPrisma.ticket, 'count').mockResolvedValue(1 as never);

    try {
      const result = await getTickets({ search: { q: 'Judul' }, sort: { field: 'updatedAt', direction: 'asc' } });

      expect(result.data).toHaveLength(1);
      expect(findManySpy).toHaveBeenCalledWith({
        where: {
          workspaceId: 'workspace-123',
          OR: [
            { title: { contains: 'Judul', mode: 'insensitive' } },
            { description: { contains: 'Judul', mode: 'insensitive' } },
            { createdBy: { name: { contains: 'Judul', mode: 'insensitive' } } },
            { assignedTo: { name: { contains: 'Judul', mode: 'insensitive' } } },
          ],
        },
        include: { createdBy: true },
        orderBy: { updatedAt: 'asc' },
        skip: 0,
        take: 20,
      });
    } finally {
      findManySpy.mockRestore();
      countSpy.mockRestore();
    }
  });

  it('getTickets preserves search with pagination', async () => {
    const findManySpy = vi.spyOn(sharedPrisma.ticket, 'findMany').mockResolvedValue([fakeTicket] as never);
    const countSpy = vi.spyOn(sharedPrisma.ticket, 'count').mockResolvedValue(1 as never);

    try {
      const result = await getTickets({ search: { q: 'Judul' }, page: 1, limit: 10 });

      expect(result.data).toHaveLength(1);
      expect(result.page).toBe(1);
      expect(result.limit).toBe(10);
      expect(findManySpy).toHaveBeenCalledWith({
        where: {
          workspaceId: 'workspace-123',
          OR: [
            { title: { contains: 'Judul', mode: 'insensitive' } },
            { description: { contains: 'Judul', mode: 'insensitive' } },
            { createdBy: { name: { contains: 'Judul', mode: 'insensitive' } } },
            { assignedTo: { name: { contains: 'Judul', mode: 'insensitive' } } },
          ],
        },
        include: { createdBy: true },
        orderBy: { createdAt: 'desc' },
        skip: 0,
        take: 10,
      });
    } finally {
      findManySpy.mockRestore();
      countSpy.mockRestore();
    }
  });

  it('getTickets preserves existing listing when search is omitted', async () => {
    const findManySpy = vi.spyOn(sharedPrisma.ticket, 'findMany').mockResolvedValue([fakeTicket] as never);
    const countSpy = vi.spyOn(sharedPrisma.ticket, 'count').mockResolvedValue(1 as never);

    try {
      const result = await getTickets();

      expect(countSpy).toHaveBeenCalledWith({ where: { workspaceId: 'workspace-123' } });
      expect(findManySpy).toHaveBeenCalledWith({
        where: { workspaceId: 'workspace-123' },
        include: { createdBy: true },
        orderBy: { createdAt: 'desc' },
        skip: 0,
        take: 20,
      });
      expect(result.data).toHaveLength(1);
    } finally {
      findManySpy.mockRestore();
      countSpy.mockRestore();
    }
  });

  it('getTickets throws when membership is missing', async () => {
    mockedGetCurrentMembership.mockRejectedValueOnce(new Error('No workspace membership found') as never);

    await expect(getTickets({ search: 'Judul' })).rejects.toThrow('No workspace membership found');
  });
});
