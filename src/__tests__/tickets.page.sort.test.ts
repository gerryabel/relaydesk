import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { prisma as sharedPrisma } from '@/lib/db/prisma';
import { getTickets } from '@/lib/tickets/server';
import { getCurrentMembership } from '@/lib/workspace/server';
import {
  parseSort,
  buildResolvedSearchParams,
  buildPaginationQuery,
  parseFilters,
} from '@/app/dashboard/tickets/page';

vi.mock('@/lib/workspace/server', () => ({
  getCurrentMembership: vi.fn(),
}));

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

describe('ticket sort URL sync', () => {
  beforeEach(() => {
    vi.mocked(getCurrentMembership).mockResolvedValue(fakeMembership as never);
  });

  afterEach(() => {
    vi.resetAllMocks();
  });

  it('parseSort normalizes valid sort from URL object input', () => {
    const sort = parseSort({ sort: 'priority:asc' });
    expect(sort).toEqual({ field: 'priority', direction: 'asc' });
  });

  it('parseSort ignores invalid sort from URL', () => {
    const sort = parseSort({ sort: 'invalid' });
    expect(sort).toBeUndefined();
  });

  it('parseSort ignores blank sort from URL', () => {
    const sort = parseSort({ sort: '   ' });
    expect(sort).toBeUndefined();
  });

  it('buildResolvedSearchParams preserves sort alongside filters', () => {
    const params = buildResolvedSearchParams({
      search: 'login',
      status: 'open',
      priority: 'high',
      assignee: 'user-456',
      sort: 'priority:asc',
    });

    expect(params.get('sort')).toBe('priority:asc');
    expect(params.get('status')).toBe('open');
    expect(params.get('search')).toBe('login');
  });

  it('buildPaginationQuery preserves sort from resolved params', () => {
    const query = buildPaginationQuery({ sort: 'priority:asc', status: 'open' }, 2, 10);
    expect(query).toContain('sort=priority%3Aasc');
    expect(query).toContain('status=open');
    expect(query).toContain('page=2');
    expect(query).toContain('limit=10');
  });

  it('getTickets applies sort from parsed page state', async () => {
    const findManySpy = vi.spyOn(sharedPrisma.ticket, 'findMany').mockResolvedValue([fakeTicket] as never);
    const countSpy = vi.spyOn(sharedPrisma.ticket, 'count').mockResolvedValue(1 as never);

    try {
      const sort = parseSort({ sort: 'priority:asc' });
      const result = await getTickets({ sort, status: 'open' });

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

  it('getTickets falls back to default order when sort is undefined from URL', async () => {
    const findManySpy = vi.spyOn(sharedPrisma.ticket, 'findMany').mockResolvedValue([fakeTicket] as never);
    const countSpy = vi.spyOn(sharedPrisma.ticket, 'count').mockResolvedValue(1 as never);

    try {
      const sort = parseSort({});
      const result = await getTickets({ sort, status: 'open' });

      expect(findManySpy).toHaveBeenCalledWith({
        where: { workspaceId: 'workspace-123', status: 'open' },
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

  it('parseFilters remains compatible when sort is present', () => {
    const filters = parseFilters({
      search: 'login',
      status: 'open',
      priority: 'high',
      assignee: 'user-456',
      sort: 'priority:asc',
    } as Record<string, unknown>);

    expect(filters).toEqual({
      search: 'login',
      status: 'open',
      priority: 'high',
      assignee: 'user-456',
    });
  });
});
