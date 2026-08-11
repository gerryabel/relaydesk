import { describe, it, expect, vi, afterEach } from 'vitest';
import { NextRequest } from 'next/server';
import { GET, PATCH } from '@/app/api/tickets/[id]/route';
import { getTicketById, updateTicket } from '@/lib/tickets/server';
import { UnauthorizedError, ForbiddenError, getCurrentMembership } from '@/lib/workspace/server';

vi.mock('@/lib/tickets/server', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/tickets/server')>();
  return {
    ...actual,
    getTicketById: vi.fn(),
    updateTicket: vi.fn(),
    TicketNotFoundError: actual.TicketNotFoundError,
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
const mockedUpdateTicket = vi.mocked(updateTicket);
const mockedGetCurrentMembership = vi.mocked(getCurrentMembership);

function createRequest(init?: RequestInit) {
  return new NextRequest('http://localhost/api/tickets/ticket-1', {
    ...init,
    signal: undefined,
  });
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

describe('ticket detail API auth regression', () => {
  afterEach(() => {
    mockedGetTicketById.mockReset();
    mockedUpdateTicket.mockReset();
    mockedGetCurrentMembership.mockReset();
    vi.restoreAllMocks();
  });

  it('GET returns 401 when membership resolution fails due to missing auth', async () => {
    mockedGetTicketById.mockRejectedValueOnce(new UnauthorizedError('No authenticated session'));

    const response = await GET(createRequest(), { params: Promise.resolve({ id: 'ticket-1' }) });
    const body = await response.json();

    expect(response.status).toBe(401);
    expect(body.error).toBe('Unauthorized');
  });

  it('GET returns 403 when membership resolution fails due to missing membership', async () => {
    mockedGetTicketById.mockRejectedValueOnce(new ForbiddenError('No workspace membership found'));

    const response = await GET(createRequest(), { params: Promise.resolve({ id: 'ticket-1' }) });
    const body = await response.json();

    expect(response.status).toBe(403);
    expect(body.error).toBe('Forbidden');
  });

  it('PATCH returns 401 when membership resolution fails due to missing auth', async () => {
    mockedGetTicketById.mockResolvedValueOnce(fakeTicket as never);
    mockedUpdateTicket.mockRejectedValueOnce(new UnauthorizedError('No authenticated session'));

    const response = await PATCH(
      createRequest({ method: 'PATCH', body: JSON.stringify({ title: 'Baru' }) }),
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
      createRequest({ method: 'PATCH', body: JSON.stringify({ title: 'Baru' }) }),
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
      createRequest({ method: 'PATCH', body: JSON.stringify({ title: 'Judul Baru' }) }),
      { params: Promise.resolve({ id: 'ticket-1' }) },
    );
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.title).toBe('Judul Baru');
  });
});
