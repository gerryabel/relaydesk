import { describe, it, expect, vi, afterEach } from 'vitest';
import { NextRequest } from 'next/server';
import { GET, PATCH } from '@/app/api/tickets/[id]/route';
import { GET as searchTickets } from '@/app/api/tickets/search/route';
import { getTicketById, getTickets, updateTicket } from '@/lib/tickets/server';
import { UnauthorizedError, ForbiddenError, getCurrentMembership } from '@/lib/workspace/server';
import { InvalidTicketTransitionError } from '@/lib/tickets/workflow';

vi.mock('@/lib/tickets/server', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/tickets/server')>();
  return {
    ...actual,
    getTicketById: vi.fn(actual.getTicketById),
    getTickets: vi.fn(actual.getTickets),
    updateTicket: vi.fn(actual.updateTicket),
  };
});

vi.mock('@/lib/workspace/server', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/workspace/server')>();
  return {
    ...actual,
    getCurrentMembership: vi.fn(),
  };
});

const mockedGetTicketById = vi.mocked(getTicketById);
const mockedGetTickets = vi.mocked(getTickets);
const mockedUpdateTicket = vi.mocked(updateTicket);
const mockedGetCurrentMembership = vi.mocked(getCurrentMembership);

function createTicketRequest(init?: RequestInit) {
  return new NextRequest('http://localhost/api/tickets/ticket-1', {
    ...init,
    signal: undefined,
  });
}

function createSearchRequest(searchParams: Record<string, string> = {}) {
  const url = new URL('http://localhost/api/tickets/search');
  Object.entries(searchParams).forEach(([key, value]) => url.searchParams.set(key, value));
  return new NextRequest(url, { signal: undefined });
}

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

describe('ticket API regression', () => {
  afterEach(() => {
    mockedGetTicketById.mockReset();
    mockedGetTickets.mockReset();
    mockedUpdateTicket.mockReset();
    mockedGetCurrentMembership.mockReset();
    vi.restoreAllMocks();
  });

  describe('ticket detail', () => {
    it('GET returns 401 when membership resolution fails due to missing auth', async () => {
      mockedGetTicketById.mockRejectedValueOnce(new UnauthorizedError('No authenticated session'));

      const response = await GET(createTicketRequest(), { params: Promise.resolve({ id: 'ticket-1' }) });
      const body = await response.json();

      expect(response.status).toBe(401);
      expect(body.error).toBe('Unauthorized');
    });

    it('GET returns 403 when membership resolution fails due to missing membership', async () => {
      mockedGetTicketById.mockRejectedValueOnce(new ForbiddenError('No workspace membership found'));

      const response = await GET(createTicketRequest(), { params: Promise.resolve({ id: 'ticket-1' }) });
      const body = await response.json();

      expect(response.status).toBe(403);
      expect(body.error).toBe('Forbidden');
    });

    it('PATCH returns 401 when membership resolution fails due to missing auth', async () => {
      mockedGetTicketById.mockResolvedValueOnce(fakeTicket as never);
      mockedUpdateTicket.mockRejectedValueOnce(new UnauthorizedError('No authenticated session'));

      const response = await PATCH(
        createTicketRequest({ method: 'PATCH', body: JSON.stringify({ title: 'Baru' }) }),
        { params: Promise.resolve({ id: 'ticket-1' }) },
      );
      const body = await response.json();

      expect(response.status).toBe(401);
      expect(body.error).toBe('Unauthorized');
    });

    it('PATCH returns 403 when membership resolution fails due to missing membership', async () => {
      mockedGetTicketById.mockResolvedValueOnce(fakeTicket as never);
      mockedUpdateTicket.mockRejectedValueOnce(new ForbiddenError('No workspace membership found'));

      const response = await PATCH(
        createTicketRequest({ method: 'PATCH', body: JSON.stringify({ title: 'Baru' }) }),
        { params: Promise.resolve({ id: 'ticket-1' }) },
      );
      const body = await response.json();

      expect(response.status).toBe(403);
      expect(body.error).toBe('Forbidden');
    });

    it('PATCH returns updated ticket when authorized', async () => {
      mockedGetTicketById.mockResolvedValueOnce(fakeTicket as never);
      mockedGetCurrentMembership.mockResolvedValueOnce({
        userId: 'user-123',
        workspaceId: 'workspace-123',
        workspace: {
          id: 'workspace-123',
          name: 'Workspace 123',
          createdAt: new Date('2025-01-01T00:00:00Z'),
          updatedAt: new Date('2025-01-01T00:00:00Z'),
        },
      } as never);
      mockedUpdateTicket.mockResolvedValueOnce({
        ...fakeTicket,
        title: 'Judul Baru',
      } as never);

      const response = await PATCH(
        createTicketRequest({ method: 'PATCH', body: JSON.stringify({ title: 'Judul Baru' }) }),
        { params: Promise.resolve({ id: 'ticket-1' }) },
      );
      const body = await response.json();

      expect(response.status).toBe(200);
      expect(body.title).toBe('Judul Baru');
    });

    it('PATCH returns 409 when status schema is valid but transition is invalid', async () => {
      mockedGetTicketById.mockResolvedValueOnce(fakeTicket as never);
      mockedGetCurrentMembership.mockResolvedValueOnce({
        userId: 'user-123',
        workspaceId: 'workspace-123',
        workspace: {
          id: 'workspace-123',
          name: 'Workspace 123',
          createdAt: new Date('2025-01-01T00:00:00Z'),
          updatedAt: new Date('2025-01-01T00:00:00Z'),
        },
      } as never);
      mockedUpdateTicket.mockRejectedValueOnce(
        new InvalidTicketTransitionError({
          current: 'open',
          requested: 'resolved',
          message: 'Invalid status transition from open to resolved',
        }),
      );

      const response = await PATCH(
        createTicketRequest({ method: 'PATCH', body: JSON.stringify({ status: 'resolved' }) }),
        { params: Promise.resolve({ id: 'ticket-1' }) },
      );
      const body = await response.json();

      expect(response.status).toBe(409);
      expect(body.error).toBe('Invalid status transition from open to resolved');
      expect(mockedUpdateTicket).toHaveBeenCalledWith('ticket-1', {
        status: 'resolved',
      });
    });
  });

  describe('ticket search API', () => {
    it('GET /api/tickets/search returns 400 for query longer than 200 characters', async () => {
      const response = await searchTickets(
        createSearchRequest({ q: 'a'.repeat(201) }),
      );

      expect(response.status).toBe(400);
    });

    it('GET /api/tickets/search returns sorted paginated results', async () => {
      mockedGetTickets.mockResolvedValueOnce({
        data: [fakeTicket],
        page: 1,
        limit: 10,
        total: 1,
        totalPages: 1,
        hasPreviousPage: false,
        hasNextPage: false,
      } as never);

      const response = await searchTickets(
        createSearchRequest({ q: 'Judul', status: 'open', priority: 'high', sort: 'priority:asc', page: '1', limit: '10' }),
      );

      expect(response.status).toBe(200);
      const body = (await response.json()) as Record<string, unknown>;
      expect(body.page).toBe(1);
      expect(body.limit).toBe(10);
    });
  });
});
