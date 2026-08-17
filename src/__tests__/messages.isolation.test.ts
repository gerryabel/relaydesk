import { describe, it, expect, vi, afterEach } from 'vitest';
import { NextRequest } from 'next/server';
import { GET, POST } from '@/app/api/tickets/[id]/messages/route';
import { getCurrentMembership } from '@/lib/workspace/server';

vi.mock('@/lib/workspace/server', () => ({
  getCurrentMembership: vi.fn(),
  ForbiddenError: class extends Error {},
  UnauthorizedError: class extends Error {},
}));

vi.mock('@/lib/db/prisma', () => {
  const prisma = {
    ticket: { findFirst: vi.fn() },
    message: { findMany: vi.fn(), create: vi.fn() },
    internalNote: { findMany: vi.fn() },
    attachment: { findMany: vi.fn() },
  };

  return { prisma };
});

const mockedGetCurrentMembership = vi.mocked(getCurrentMembership);
const mockedTicketFindFirst = vi.mocked((await import('@/lib/db/prisma')).prisma.ticket.findFirst);
const mockedMessageFindMany = vi.mocked((await import('@/lib/db/prisma')).prisma.message.findMany);
const mockedMessageCreate = vi.mocked((await import('@/lib/db/prisma')).prisma.message.create);
const mockedInternalNoteFindMany = vi.mocked((await import('@/lib/db/prisma')).prisma.internalNote.findMany);

function createRequest(init?: RequestInit) {
  return new NextRequest('http://localhost/api/tickets/ticket-1', {
    ...init,
    signal: undefined,
  });
}

afterEach(() => {
  mockedGetCurrentMembership.mockReset();
  mockedTicketFindFirst.mockReset();
  mockedMessageFindMany.mockReset();
  mockedMessageCreate.mockReset();
  mockedInternalNoteFindMany.mockReset();
  vi.restoreAllMocks();
});

describe('message endpoint isolation', () => {
  const fakeMembership = {
    userId: 'user-123',
    workspaceId: 'workspace-123',
    workspace: {
      id: 'workspace-123',
      name: 'Workspace 123',
      createdAt: new Date('2025-01-01T00:00:00Z'),
      updatedAt: new Date('2025-01-01T00:00:00Z'),
    },
  };

  it('GET only queries messages and never queries internal notes', async () => {
    mockedGetCurrentMembership.mockResolvedValueOnce(fakeMembership as never);
    mockedTicketFindFirst.mockResolvedValueOnce({ id: 'ticket-1' } as never);
    mockedMessageFindMany.mockResolvedValueOnce([] as never);

    await GET(createRequest(), { params: Promise.resolve({ id: 'ticket-1' }) });

    expect(mockedMessageFindMany).toHaveBeenCalledTimes(1);
    expect(mockedInternalNoteFindMany).not.toHaveBeenCalled();
  });

  it('POST only creates messages and never queries internal notes', async () => {
    mockedGetCurrentMembership.mockResolvedValueOnce(fakeMembership as never);
    mockedTicketFindFirst.mockResolvedValueOnce({ id: 'ticket-1' } as never);
    mockedMessageCreate.mockResolvedValueOnce({
      id: 'message-1',
      ticketId: 'ticket-1',
      createdById: 'user-123',
      body: 'Balasan pelanggan.',
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
    } as never);

    await POST(
      createRequest({ method: 'POST', body: JSON.stringify({ body: 'Balasan pelanggan.' }) }),
      { params: Promise.resolve({ id: 'ticket-1' }) },
    );

    expect(mockedMessageCreate).toHaveBeenCalledTimes(1);
    expect(mockedInternalNoteFindMany).not.toHaveBeenCalled();
  });
});
