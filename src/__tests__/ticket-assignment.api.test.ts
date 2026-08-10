import { describe, it, expect, vi, afterEach } from 'vitest';
import { NextRequest } from 'next/server';
import { PATCH, DELETE } from '@/app/api/tickets/[id]/assignment/route';
import { UnauthorizedError, ForbiddenError } from '@/lib/workspace/server';
import { TicketNotFoundError, AssigneeNotInWorkspaceError } from '@/lib/tickets/server';

function createAssignmentRequest(init?: RequestInit) {
  return new NextRequest('http://localhost/api/tickets/ticket-1/assignment', {
    ...init,
    signal: undefined,
  });
}

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
  assignedTo: fakeAssignee,
};

vi.mock('@/lib/tickets/server', async () => {
  const actual = await vi.importActual<typeof import('@/lib/tickets/server')>('@/lib/tickets/server');
  return {
    ...actual,
    assignTicket: vi.fn(),
    unassignTicket: vi.fn(),
  };
});

const mockedTicketServer = await import('@/lib/tickets/server');
const mockedAssignTicket = vi.mocked(mockedTicketServer.assignTicket);
const mockedUnassignTicket = vi.mocked(mockedTicketServer.unassignTicket);

afterEach(() => {
  vi.resetAllMocks();
});

describe('ticket assignment API', () => {
  it('PATCH returns 400 when payload is invalid', async () => {
    const response = await PATCH(
      createAssignmentRequest({ method: 'PATCH', body: JSON.stringify({ assigneeId: '' }) }),
      { params: Promise.resolve({ id: 'ticket-1' }) },
    );
    const body = await response.json();

    expect(response.status).toBe(400);
    expect(body.error).toBe('Assignee wajib diisi');
  });

  it('PATCH returns 401 when membership resolution fails due to missing auth', async () => {
    mockedAssignTicket.mockRejectedValueOnce(new UnauthorizedError('No authenticated session'));

    const response = await PATCH(
      createAssignmentRequest({ method: 'PATCH', body: JSON.stringify({ assigneeId: 'user-456' }) }),
      { params: Promise.resolve({ id: 'ticket-1' }) },
    );
    const body = await response.json();

    expect(response.status).toBe(401);
    expect(body.error).toBe('Unauthorized');
  });

  it('PATCH returns 403 when membership resolution fails due to missing membership', async () => {
    mockedAssignTicket.mockRejectedValueOnce(new ForbiddenError('No workspace membership found'));

    const response = await PATCH(
      createAssignmentRequest({ method: 'PATCH', body: JSON.stringify({ assigneeId: 'user-456' }) }),
      { params: Promise.resolve({ id: 'ticket-1' }) },
    );
    const body = await response.json();

    expect(response.status).toBe(403);
    expect(body.error).toBe('Forbidden');
  });

  it('PATCH returns 404 when ticket does not exist', async () => {
    mockedAssignTicket.mockRejectedValueOnce(new TicketNotFoundError());

    const response = await PATCH(
      createAssignmentRequest({ method: 'PATCH', body: JSON.stringify({ assigneeId: 'user-456' }) }),
      { params: Promise.resolve({ id: 'missing' }) },
    );
    const body = await response.json();

    expect(response.status).toBe(404);
    expect(body.error).toBe('Ticket not found');
  });

  it('PATCH returns 400 when assignee is not in workspace', async () => {
    mockedAssignTicket.mockRejectedValueOnce(new AssigneeNotInWorkspaceError());

    const response = await PATCH(
      createAssignmentRequest({ method: 'PATCH', body: JSON.stringify({ assigneeId: 'user-999' }) }),
      { params: Promise.resolve({ id: 'ticket-1' }) },
    );
    const body = await response.json();

    expect(response.status).toBe(400);
    expect(body.error).toBe('Assignee is not in this workspace');
  });

  it('PATCH returns updated ticket when assignment succeeds', async () => {
    mockedAssignTicket.mockResolvedValueOnce(fakeTicket as never);

    const response = await PATCH(
      createAssignmentRequest({ method: 'PATCH', body: JSON.stringify({ assigneeId: 'user-456' }) }),
      { params: Promise.resolve({ id: 'ticket-1' }) },
    );
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.id).toBe('ticket-1');
  });

  it('DELETE returns 401 when membership resolution fails due to missing auth', async () => {
    mockedUnassignTicket.mockRejectedValueOnce(new UnauthorizedError('No authenticated session'));

    const response = await DELETE(
      createAssignmentRequest({ method: 'DELETE' }),
      { params: Promise.resolve({ id: 'ticket-1' }) },
    );
    const body = await response.json();

    expect(response.status).toBe(401);
    expect(body.error).toBe('Unauthorized');
  });

  it('DELETE returns 403 when membership resolution fails due to missing membership', async () => {
    mockedUnassignTicket.mockRejectedValueOnce(new ForbiddenError('No workspace membership found'));

    const response = await DELETE(
      createAssignmentRequest({ method: 'DELETE' }),
      { params: Promise.resolve({ id: 'ticket-1' }) },
    );
    const body = await response.json();

    expect(response.status).toBe(403);
    expect(body.error).toBe('Forbidden');
  });

  it('DELETE returns 404 when ticket does not exist', async () => {
    mockedUnassignTicket.mockRejectedValueOnce(new TicketNotFoundError());

    const response = await DELETE(
      createAssignmentRequest({ method: 'DELETE' }),
      { params: Promise.resolve({ id: 'missing' }) },
    );
    const body = await response.json();

    expect(response.status).toBe(404);
    expect(body.error).toBe('Ticket not found');
  });

  it('DELETE returns updated ticket when unassignment succeeds', async () => {
    mockedUnassignTicket.mockResolvedValueOnce(fakeTicket as never);

    const response = await DELETE(
      createAssignmentRequest({ method: 'DELETE' }),
      { params: Promise.resolve({ id: 'ticket-1' }) },
    );
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.id).toBe('ticket-1');
  });
});
