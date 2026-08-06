import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { prisma as sharedPrisma } from '@/lib/db/prisma';
import { getTickets, getTicketById, TicketNotFoundError } from '@/lib/tickets/server';
import { getCurrentMembership, UnauthorizedError, ForbiddenError } from '@/lib/workspace/server';
import { parseFilters } from '@/app/dashboard/tickets/page';

vi.mock('@/lib/workspace/server', async () => {
  const actual = await vi.importActual<typeof import('@/lib/workspace/server')>('@/lib/workspace/server');
  return {
    ...actual,
    getCurrentMembership: vi.fn(),
  };
});

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

describe('ticket list states', () => {
  beforeEach(() => {
    vi.mocked(getCurrentMembership).mockResolvedValue(fakeMembership as never);
  });

  afterEach(() => {
    vi.resetAllMocks();
  });

  it('getTickets returns empty list when no tickets exist', async () => {
    const findManySpy = vi.spyOn(sharedPrisma.ticket, 'findMany').mockResolvedValue([] as never);
    const countSpy = vi.spyOn(sharedPrisma.ticket, 'count').mockResolvedValue(0 as never);

    try {
      const result = await getTickets({});

      expect(countSpy).toHaveBeenCalledWith({ where: { workspaceId: 'workspace-123' } });
      expect(findManySpy).toHaveBeenCalledWith({
        where: { workspaceId: 'workspace-123' },
        include: { createdBy: true },
        orderBy: { createdAt: 'desc' },
        skip: 0,
        take: 20,
      });
      expect(result.data).toHaveLength(0);
      expect(result.total).toBe(0);
      expect(result.page).toBe(1);
    } finally {
      findManySpy.mockRestore();
      countSpy.mockRestore();
    }
  });

  it('getTickets surfaces page metadata for a non-empty list', async () => {
    const findManySpy = vi.spyOn(sharedPrisma.ticket, 'findMany').mockResolvedValue([fakeTicket] as never);
    const countSpy = vi.spyOn(sharedPrisma.ticket, 'count').mockResolvedValue(1 as never);

    try {
      const result = await getTickets({ page: 1, limit: 20 });

      expect(result.data).toHaveLength(1);
      expect(result.total).toBe(1);
      expect(result.page).toBe(1);
      expect(result.totalPages).toBe(1);
      expect(result.hasPreviousPage).toBe(false);
      expect(result.hasNextPage).toBe(false);
    } finally {
      findManySpy.mockRestore();
      countSpy.mockRestore();
    }
  });

  it('getTicketById throws TicketNotFoundError for a missing ticket', async () => {
    const findFirstSpy = vi.spyOn(sharedPrisma.ticket, 'findFirst').mockResolvedValue(null as never);

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

  it('does not return tickets from another workspace', async () => {
    const findFirstSpy = vi.spyOn(sharedPrisma.ticket, 'findFirst').mockResolvedValue(null as never);

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

  it('parseFilters strips active filters into empty state when all inputs are cleared', () => {
    const filters = parseFilters({
      search: '',
      status: '',
      priority: '',
    } as Record<string, unknown>);

    expect(filters).toEqual({ search: '', status: undefined, priority: undefined });
  });

  it('parseFilters retains partial valid filters when others are missing', () => {
    const filters = parseFilters({
      search: 'Judul Tiket',
      status: undefined,
      priority: undefined,
    } as Record<string, unknown>);

    expect(filters).toEqual({ search: 'Judul Tiket', status: undefined, priority: undefined });
  });

  it('getTickets throws when membership is missing', async () => {
    mockedGetCurrentMembership.mockRejectedValueOnce(new Error('No workspace membership found') as never);

    await expect(getTickets({})).rejects.toThrow('No workspace membership found');
  });

  it('getTickets throws 401 equivalent when auth session is missing', async () => {
    mockedGetCurrentMembership.mockRejectedValueOnce(new UnauthorizedError('No authenticated session') as never);

    await expect(getTickets({})).rejects.toThrow(UnauthorizedError);
  });

  it('getTickets throws 403 equivalent when workspace membership is missing', async () => {
    mockedGetCurrentMembership.mockRejectedValueOnce(new ForbiddenError('No workspace membership found') as never);

    await expect(getTickets({})).rejects.toThrow(ForbiddenError);
  });

  it('getTicketById throws workspace-not-found boundary for membership errors', async () => {
    mockedGetCurrentMembership.mockRejectedValueOnce(new ForbiddenError('No workspace membership found') as never);

    await expect(getTicketById('ticket-1')).rejects.toThrow('No workspace membership found');
  });
});
