import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { prisma as sharedPrisma } from '@/lib/db/prisma';
import { getTickets } from '@/lib/tickets/server';
import { getCurrentMembership } from '@/lib/workspace/server';
import { ticketFiltersSchema, ticketSearchSchema, ticketStatusFilterSchema, ticketPriorityFilterSchema, ticketAssigneeFilterSchema } from '@/lib/tickets/schema';
import { parseFilters } from '@/app/dashboard/tickets/page';
import { createTicketSort, normalizeTicketSort, mapTicketSortToOrderBy } from '@/lib/tickets/sort';

vi.mock('@/lib/workspace/server', () => ({
  getCurrentMembership: vi.fn(),
}));

vi.mocked(getCurrentMembership);

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

describe('ticket filters', () => {
  beforeEach(() => {
    vi.mocked(getCurrentMembership).mockResolvedValue(fakeMembership as never);
  });

  afterEach(() => {
    vi.resetAllMocks();
  });

  it('ticketFiltersSchema accepts valid filters', () => {
    expect(() =>
      ticketFiltersSchema.parse({ search: 'login', status: 'open', priority: 'high' }),
    ).not.toThrow();
  });

  it('ticketFiltersSchema rejects invalid status enum', () => {
    expect(() =>
      ticketFiltersSchema.parse({ search: 'Judul Tiket', status: 'invalid' }),
    ).toThrow();
  });

  it('ticketFiltersSchema rejects invalid priority enum', () => {
    expect(() =>
      ticketFiltersSchema.parse({ search: 'Judul Tiket', priority: 'invalid' }),
    ).toThrow();
  });

  it('ticketSearchSchema rejects search longer than 200 characters', () => {
    expect(() => ticketSearchSchema.parse({ search: 'a'.repeat(201) })).toThrow('Pencarian maksimal 200 karakter');
  });

  it('ticketStatusFilterSchema rejects invalid status', () => {
    expect(() => ticketStatusFilterSchema.parse({ status: 'INVALID' })).toThrow();
  });

  it('ticketPriorityFilterSchema rejects invalid priority', () => {
    expect(() => ticketPriorityFilterSchema.parse({ priority: 'invalid' })).toThrow();
  });

  it('ticketAssigneeFilterSchema accepts valid assignee', () => {
    expect(() => ticketAssigneeFilterSchema.parse({ assignee: 'user-1' })).not.toThrow();
  });

  it('ticketAssigneeFilterSchema rejects blank assignee', () => {
    expect(() => ticketAssigneeFilterSchema.parse({ assignee: '   ' })).toThrow();
  });

  it('getTickets filters by assignee only', async () => {
    const findManySpy = vi.spyOn(sharedPrisma.ticket, 'findMany').mockResolvedValue([] as never);
    const countSpy = vi.spyOn(sharedPrisma.ticket, 'count').mockResolvedValue(0 as never);

    try {
      await getTickets({ assignee: 'user-456' });

      expect(countSpy).toHaveBeenCalledWith({
        where: { workspaceId: 'workspace-123', assignedToId: 'user-456' },
      });
      expect(findManySpy).toHaveBeenCalledWith({
        where: { workspaceId: 'workspace-123', assignedToId: 'user-456' },
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

  it('getTickets combines status and assignee filters', async () => {
    const findManySpy = vi.spyOn(sharedPrisma.ticket, 'findMany').mockResolvedValue([] as never);
    const countSpy = vi.spyOn(sharedPrisma.ticket, 'count').mockResolvedValue(0 as never);

    try {
      await getTickets({ status: 'open', assignee: 'user-456' });

      expect(countSpy).toHaveBeenCalledWith({
        where: { workspaceId: 'workspace-123', status: 'open', assignedToId: 'user-456' },
      });
      expect(findManySpy).toHaveBeenCalledWith({
        where: { workspaceId: 'workspace-123', status: 'open', assignedToId: 'user-456' },
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

  it('getTickets combines priority and assignee filters', async () => {
    const findManySpy = vi.spyOn(sharedPrisma.ticket, 'findMany').mockResolvedValue([] as never);
    const countSpy = vi.spyOn(sharedPrisma.ticket, 'count').mockResolvedValue(0 as never);

    try {
      await getTickets({ priority: 'high', assignee: 'user-456' });

      expect(countSpy).toHaveBeenCalledWith({
        where: { workspaceId: 'workspace-123', priority: 'high', assignedToId: 'user-456' },
      });
      expect(findManySpy).toHaveBeenCalledWith({
        where: { workspaceId: 'workspace-123', priority: 'high', assignedToId: 'user-456' },
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

  it('getTickets combines status, priority, and assignee filters', async () => {
    const findManySpy = vi.spyOn(sharedPrisma.ticket, 'findMany').mockResolvedValue([] as never);
    const countSpy = vi.spyOn(sharedPrisma.ticket, 'count').mockResolvedValue(0 as never);

    try {
      await getTickets({ status: 'open', priority: 'high', assignee: 'user-456' });

      expect(countSpy).toHaveBeenCalledWith({
        where: { workspaceId: 'workspace-123', status: 'open', priority: 'high', assignedToId: 'user-456' },
      });
      expect(findManySpy).toHaveBeenCalledWith({
        where: { workspaceId: 'workspace-123', status: 'open', priority: 'high', assignedToId: 'user-456' },
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

  it('getTickets combines search and assignee filters', async () => {
    const findManySpy = vi.spyOn(sharedPrisma.ticket, 'findMany').mockResolvedValue([] as never);
    const countSpy = vi.spyOn(sharedPrisma.ticket, 'count').mockResolvedValue(0 as never);

    try {
      await getTickets({ assignee: 'user-456', search: 'Judul Tiket' });

      expect(countSpy).toHaveBeenCalledWith({
        where: {
          workspaceId: 'workspace-123',
          assignedToId: 'user-456',
          title: { contains: 'Judul Tiket', mode: 'insensitive' },
        },
      });
      expect(findManySpy).toHaveBeenCalledWith({
        where: {
          workspaceId: 'workspace-123',
          assignedToId: 'user-456',
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

  it('getTickets preserves assignee filter with sorting', async () => {
    const findManySpy = vi.spyOn(sharedPrisma.ticket, 'findMany').mockResolvedValue([fakeTicket] as never);
    const countSpy = vi.spyOn(sharedPrisma.ticket, 'count').mockResolvedValue(1 as never);

    try {
      const result = await getTickets({ assignee: 'user-456', sort: { field: 'priority', direction: 'asc' } });

      expect(countSpy).toHaveBeenCalledWith({
        where: { workspaceId: 'workspace-123', assignedToId: 'user-456' },
      });
      expect(findManySpy).toHaveBeenCalledWith({
        where: { workspaceId: 'workspace-123', assignedToId: 'user-456' },
        include: { createdBy: true },
        orderBy: { priority: 'asc' },
        skip: 0,
        take: 20,
      });
      expect(result.data).toHaveLength(1);
    } finally {
      findManySpy.mockRestore();
      countSpy.mockRestore();
    }
  });

  it('getTickets preserves assignee filter with pagination', async () => {
    const findManySpy = vi.spyOn(sharedPrisma.ticket, 'findMany').mockResolvedValue([fakeTicket] as never);
    const countSpy = vi.spyOn(sharedPrisma.ticket, 'count').mockResolvedValue(1 as never);

    try {
      const result = await getTickets({ assignee: 'user-456', page: 1, limit: 10 });

      expect(countSpy).toHaveBeenCalledWith({
        where: { workspaceId: 'workspace-123', assignedToId: 'user-456' },
      });
      expect(findManySpy).toHaveBeenCalledWith({
        where: { workspaceId: 'workspace-123', assignedToId: 'user-456' },
        include: { createdBy: true },
        orderBy: { createdAt: 'desc' },
        skip: 0,
        take: 10,
      });
      expect(result.page).toBe(1);
      expect(result.limit).toBe(10);
    } finally {
      findManySpy.mockRestore();
      countSpy.mockRestore();
    }
  });

  it('parseFilters preserves assignee alongside valid filters', () => {
    const filters = parseFilters({
      search: 'login',
      status: 'open',
      priority: 'high',
      assignee: 'user-456',
    } as Record<string, unknown>);

    expect(filters).toEqual({ search: 'login', status: 'open', priority: 'high', assignee: 'user-456' });
  });

  it('parseFilters preserves valid fields when one query parameter is invalid', () => {
    const filters = parseFilters({
      search: 'login',
      status: 'INVALID',
      priority: 'high',
      assignee: 'user-456',
    } as Record<string, unknown>);

    expect(filters).toEqual({ search: 'login', status: undefined, priority: 'high', assignee: 'user-456' });
  });

  it('parseFilters returns empty filters when all query parameters are invalid', () => {
    const filters = parseFilters({
      search: '',
      status: 'INVALID',
      priority: 'INVALID',
      assignee: '',
    } as Record<string, unknown>);

    expect(filters).toEqual({ search: '', status: undefined, priority: undefined, assignee: undefined });
  });

  it('getTickets returns empty data for an invalid assignee string', async () => {
    const findManySpy = vi.spyOn(sharedPrisma.ticket, 'findMany').mockResolvedValue([] as never);
    const countSpy = vi.spyOn(sharedPrisma.ticket, 'count').mockResolvedValue(0 as never);

    try {
      const result = await getTickets({ assignee: 'invalid' as never });

      expect(result.data).toHaveLength(0);
      expect(result.total).toBe(0);
    } finally {
      findManySpy.mockRestore();
      countSpy.mockRestore();
    }
  });

  it('getTickets filters by priority only', async () => {
    const findManySpy = vi.spyOn(sharedPrisma.ticket, 'findMany').mockResolvedValue([] as never);
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
    const findManySpy = vi.spyOn(sharedPrisma.ticket, 'findMany').mockResolvedValue([] as never);
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
    const findManySpy = vi.spyOn(sharedPrisma.ticket, 'findMany').mockResolvedValue([] as never);
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
    const findManySpy = vi.spyOn(sharedPrisma.ticket, 'findMany').mockResolvedValue([] as never);
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

  it('getTickets rejects invalid status enum', async () => {
    await expect(getTickets({ status: 'invalid' } as never)).rejects.toThrow();
  });

  it('getTickets rejects invalid priority enum', async () => {
    await expect(getTickets({ priority: 'invalid' } as never)).rejects.toThrow();
  });
});

describe('ticket sort', () => {
  beforeEach(() => {
    vi.mocked(getCurrentMembership).mockResolvedValue(fakeMembership as never);
  });

  afterEach(() => {
    vi.resetAllMocks();
  });

  it('createTicketSort normalizes valid sort input', () => {
    expect(createTicketSort({ field: 'title', direction: 'asc' })).toEqual({ field: 'title', direction: 'asc' });
  });

  it('normalizeTicketSort supports object input', () => {
    expect(normalizeTicketSort({ field: 'updatedAt', direction: 'asc' })).toEqual({ field: 'updatedAt', direction: 'asc' });
  });

  it('normalizeTicketSort supports field-only string input', () => {
    expect(normalizeTicketSort('priority')).toEqual({ field: 'priority', direction: 'desc' });
  });

  it('normalizeTicketSort ignores invalid input', () => {
    expect(normalizeTicketSort('invalid')).toBeUndefined();
    expect(normalizeTicketSort(null)).toBeUndefined();
    expect(normalizeTicketSort('')).toBeUndefined();
  });

  it('mapTicketSortToOrderBy maps all sort fields', () => {
    expect(mapTicketSortToOrderBy({ field: 'createdAt', direction: 'desc' })).toEqual({ createdAt: 'desc' });
    expect(mapTicketSortToOrderBy({ field: 'priority', direction: 'asc' })).toEqual({ priority: 'asc' });
  });

  it('getTickets applies sort to the Prisma orderBy clause', async () => {
    const findManySpy = vi.spyOn(sharedPrisma.ticket, 'findMany').mockResolvedValue([fakeTicket] as never);
    const countSpy = vi.spyOn(sharedPrisma.ticket, 'count').mockResolvedValue(1 as never);

    try {
      const result = await getTickets({ sort: { field: 'priority', direction: 'asc' }, status: 'open' });

      expect(countSpy).toHaveBeenCalledWith({
        where: { workspaceId: 'workspace-123', status: 'open' },
      });
      expect(findManySpy).toHaveBeenCalledWith({
        where: { workspaceId: 'workspace-123', status: 'open' },
        include: { createdBy: true },
        orderBy: { priority: 'asc' },
        skip: 0,
        take: 20,
      });
      expect(result.data).toHaveLength(1);
    } finally {
      findManySpy.mockRestore();
      countSpy.mockRestore();
    }
  });

  it('getTickets falls back to createdAt desc when sort is invalid', async () => {
    const findManySpy = vi.spyOn(sharedPrisma.ticket, 'findMany').mockResolvedValue([fakeTicket] as never);
    const countSpy = vi.spyOn(sharedPrisma.ticket, 'count').mockResolvedValue(1 as never);

    try {
      await getTickets({ sort: 'invalid' as never });

      expect(findManySpy).toHaveBeenCalledWith({
        where: { workspaceId: 'workspace-123' },
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

  it('getTickets preserves sort across pagination', async () => {
    const findManySpy = vi.spyOn(sharedPrisma.ticket, 'findMany').mockResolvedValue([fakeTicket] as never);
    const countSpy = vi.spyOn(sharedPrisma.ticket, 'count').mockResolvedValue(1 as never);

    try {
      const result = await getTickets({ sort: { field: 'title', direction: 'asc' }, page: 1, limit: 10 });

      expect(findManySpy).toHaveBeenCalledWith({
        where: { workspaceId: 'workspace-123' },
        include: { createdBy: true },
        orderBy: { title: 'asc' },
        skip: 0,
        take: 10,
      });
      expect(result.page).toBe(1);
      expect(result.limit).toBe(10);
    } finally {
      findManySpy.mockRestore();
      countSpy.mockRestore();
    }
  });
});

describe('ticket pagination', () => {
  beforeEach(() => {
    vi.mocked(getCurrentMembership).mockResolvedValue(fakeMembership as never);
  });

  afterEach(() => {
    vi.resetAllMocks();
  });

  it('getTickets paginates the first page', async () => {
    const findManySpy = vi.spyOn(sharedPrisma.ticket, 'findMany').mockResolvedValue([fakeTicket] as never);
    const countSpy = vi.spyOn(sharedPrisma.ticket, 'count').mockResolvedValue(1 as never);

    try {
      const result = await getTickets({ page: 1, limit: 1 });

      expect(countSpy).toHaveBeenCalledWith({ where: { workspaceId: 'workspace-123' } });
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
    const findManySpy = vi.spyOn(sharedPrisma.ticket, 'findMany').mockResolvedValue([fakeTicket] as never);
    const countSpy = vi.spyOn(sharedPrisma.ticket, 'count').mockResolvedValue(2 as never);

    try {
      const result = await getTickets({ page: 2, limit: 1 });

      expect(countSpy).toHaveBeenCalledWith({ where: { workspaceId: 'workspace-123' } });
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
    const findManySpy = vi.spyOn(sharedPrisma.ticket, 'findMany').mockResolvedValue([] as never);
    const countSpy = vi.spyOn(sharedPrisma.ticket, 'count').mockResolvedValue(0 as never);

    try {
      const result = await getTickets({ page: 5, limit: 10 });

      expect(result.data).toHaveLength(0);
      expect(result.page).toBe(1);
      expect(result.total).toBe(0);
      expect(result.totalPages).toBe(1);
      expect(findManySpy).toHaveBeenCalledWith({
        where: { workspaceId: 'workspace-123' },
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

  it('getTickets throws when pagination limit exceeds allowed maximum', async () => {
    await expect(getTickets({ page: 1, limit: 200 })).rejects.toThrow();
  });

  it('getTickets preserves pagination with search and filters', async () => {
    const findManySpy = vi.spyOn(sharedPrisma.ticket, 'findMany').mockResolvedValue([fakeTicket] as never);
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

  it('getTickets clamps requested page beyond total pages to first page', async () => {
    const findManySpy = vi.spyOn(sharedPrisma.ticket, 'findMany').mockResolvedValue([] as never);
    const countSpy = vi.spyOn(sharedPrisma.ticket, 'count').mockResolvedValue(0 as never);

    try {
      const result = await getTickets({ page: 3, limit: 10 });

      expect(result.page).toBe(1);
      expect(findManySpy).toHaveBeenCalledWith({
        where: { workspaceId: 'workspace-123' },
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
});
