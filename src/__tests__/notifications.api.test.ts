import { describe, it, expect, vi, afterEach } from 'vitest';
import { NextRequest } from 'next/server';
import { GET } from '@/app/api/notifications/route';
import { UnauthorizedError, ForbiddenError } from '@/lib/workspace/server';
import { getNotifications } from '@/lib/notifications/server';

vi.mock('@/lib/notifications/server', () => ({
  ...(await import('@/lib/notifications/server')),
  getNotifications: vi.fn(),
}));

vi.mock('@/lib/workspace/server', () => ({
  getCurrentMembership: vi.fn(),
}));

const mockedGetNotifications = vi.mocked(getNotifications);
const mockedGetCurrentMembership = vi.mocked(await import('@/lib/workspace/server').then((m) => m.getCurrentMembership));

function createNotificationRequest(init?: RequestInit) {
  return new NextRequest('http://localhost/api/notifications', {
    ...init,
    signal: undefined,
  });
}

afterEach(() => {
  mockedGetNotifications.mockReset();
  mockedGetCurrentMembership.mockReset();
  vi.restoreAllMocks();
});

describe('notifications API', () => {
  it('returns 401 when membership resolution fails', async () => {
    mockedGetCurrentMembership.mockRejectedValueOnce(new UnauthorizedError('No authenticated session'));

    const response = await GET(createNotificationRequest());
    const body = await response.json();

    expect(response.status).toBe(401);
    expect(body.error).toBe('Unauthorized');
  });

  it('returns 403 when membership resolution fails', async () => {
    mockedGetCurrentMembership.mockRejectedValueOnce(new ForbiddenError('No workspace membership found'));

    const response = await GET(createNotificationRequest());
    const body = await response.json();

    expect(response.status).toBe(403);
    expect(body.error).toBe('Forbidden');
  });

  it('returns paginated notifications', async () => {
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

    mockedGetNotifications.mockResolvedValueOnce({
      data: [
        {
          id: 'notification-1',
          userId: 'user-123',
          workspaceId: 'workspace-123',
          ticketId: 'ticket-1',
          type: 'TICKET_ASSIGNED',
          title: 'Ticket assigned to you',
          body: 'Ticket #ticket-1 was assigned to you.',
          readAt: null,
          createdAt: new Date('2025-01-01T00:00:00Z'),
          updatedAt: new Date('2025-01-01T00:00:00Z'),
          ticket: {
            id: 'ticket-1',
            title: 'Judul Tiket',
            status: 'open',
          },
        },
      ],
      total: 1,
      page: 1,
      limit: 20,
    } as never);

    const response = await GET(createNotificationRequest());
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.data).toHaveLength(1);
    expect(body.total).toBe(1);
    expect(mockedGetNotifications).toHaveBeenCalledWith({
      page: 1,
      limit: 20,
      unreadOnly: false,
    });
  });

  it('supports unreadOnly query parameter', async () => {
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

    mockedGetNotifications.mockResolvedValueOnce({
      data: [],
      total: 0,
      page: 1,
      limit: 20,
    } as never);

    const url = new URL('http://localhost/api/notifications');
    url.searchParams.set('unreadOnly', 'true');
    const response = await GET(new NextRequest(url, { signal: undefined }));
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(mockedGetNotifications).toHaveBeenCalledWith({
      page: 1,
      limit: 20,
      unreadOnly: true,
    });
    expect(body.data).toHaveLength(0);
  });
});
