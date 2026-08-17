import { describe, it, expect, vi, afterEach } from 'vitest';
import { NextRequest } from 'next/server';
import { GET, POST } from '@/app/api/tickets/[id]/internal-notes/route';
import { getInternalNotes, createInternalNote } from '@/lib/internal-notes/server';
import { UnauthorizedError, ForbiddenError, getCurrentMembership } from '@/lib/workspace/server';

vi.mock('@/lib/internal-notes/server', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/internal-notes/server')>();
  return {
    ...actual,
    getInternalNotes: vi.fn(),
    createInternalNote: vi.fn(),
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

vi.mock('@/lib/db/prisma', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/db/prisma')>();
  return {
    ...actual,
    prisma: {
      ...actual.prisma,
      ticket: {
        ...actual.prisma.ticket,
        findFirst: vi.fn(),
      },
    },
  };
});

const mockedPrisma = (await import('@/lib/db/prisma')).prisma as unknown as {
  ticket: { findFirst: ReturnType<typeof vi.fn> };
};
const mockedGetInternalNotes = vi.mocked(getInternalNotes);
const mockedCreateInternalNote = vi.mocked(createInternalNote);
const mockedGetCurrentMembership = vi.mocked(getCurrentMembership);

function createRequest(init?: RequestInit) {
  return new NextRequest('http://localhost/api/tickets/ticket-1', {
    ...init,
    signal: undefined,
  });
}

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

afterEach(() => {
  mockedGetInternalNotes.mockReset();
  mockedCreateInternalNote.mockReset();
  mockedGetCurrentMembership.mockReset();
  mockedPrisma.ticket.findFirst.mockReset();
  vi.restoreAllMocks();
});

describe('internal notes API', () => {
  describe('GET /api/tickets/[id]/internal-notes', () => {
    it('returns 401 when membership resolution fails', async () => {
      mockedGetCurrentMembership.mockRejectedValueOnce(new UnauthorizedError('No authenticated session'));

      const response = await GET(createRequest(), { params: Promise.resolve({ id: 'ticket-1' }) });
      const body = await response.json();

      expect(response.status).toBe(401);
      expect(body.error).toBe('Unauthorized');
    });

    it('returns 403 when membership resolution fails', async () => {
      mockedGetCurrentMembership.mockRejectedValueOnce(new ForbiddenError('No workspace membership found'));

      const response = await GET(createRequest(), { params: Promise.resolve({ id: 'ticket-1' }) });
      const body = await response.json();

      expect(response.status).toBe(403);
      expect(body.error).toBe('Forbidden');
    });

    it('returns internal notes for authorized workspace', async () => {
      mockedGetCurrentMembership.mockResolvedValueOnce(fakeMembership as never);
      mockedPrisma.ticket.findFirst.mockResolvedValueOnce({ id: 'ticket-1' } as never);
      mockedGetInternalNotes.mockResolvedValueOnce([
        {
          id: 'internal-note-1',
          ticketId: 'ticket-1',
          authorId: 'user-123',
          body: 'Customer sudah dikontak.',
          createdAt: new Date('2025-01-01T10:00:00Z'),
          updatedAt: new Date('2025-01-01T10:00:00Z'),
          author: fakeMembership,
        },
      ] as never);

      const response = await GET(createRequest(), { params: Promise.resolve({ id: 'ticket-1' }) });
      const body = await response.json();

      expect(response.status).toBe(200);
      expect(body).toHaveLength(1);
      expect(body[0].authorId).toBe('user-123');
    });
  });

  describe('POST /api/tickets/[id]/internal-notes', () => {
    it('returns 401 when membership resolution fails', async () => {
      mockedGetCurrentMembership.mockRejectedValueOnce(new UnauthorizedError('No authenticated session'));

      const response = await POST(
        createRequest({ method: 'POST', body: JSON.stringify({ body: 'Catatan internal.' }) }),
        { params: Promise.resolve({ id: 'ticket-1' }) },
      );
      const body = await response.json();

      expect(response.status).toBe(401);
      expect(body.error).toBe('Unauthorized');
    });

    it('returns 403 when membership resolution fails', async () => {
      mockedGetCurrentMembership.mockRejectedValueOnce(new ForbiddenError('No workspace membership found'));

      const response = await POST(
        createRequest({ method: 'POST', body: JSON.stringify({ body: 'Catatan internal.' }) }),
        { params: Promise.resolve({ id: 'ticket-1' }) },
      );
      const body = await response.json();

      expect(response.status).toBe(403);
      expect(body.error).toBe('Forbidden');
    });

    it('returns 400 when body is invalid', async () => {
      mockedGetCurrentMembership.mockResolvedValueOnce(fakeMembership as never);

      const response = await POST(
        createRequest({ method: 'POST', body: JSON.stringify({ body: '   ' }) }),
        { params: Promise.resolve({ id: 'ticket-1' }) },
      );
      const body = await response.json();

      expect(response.status).toBe(400);
      expect(body.error).toBe('Catatan internal wajib diisi');
    });

    it('returns created internal note', async () => {
      mockedGetCurrentMembership.mockResolvedValueOnce(fakeMembership as never);
      mockedPrisma.ticket.findFirst.mockResolvedValueOnce({ id: 'ticket-1' } as never);
      mockedCreateInternalNote.mockResolvedValueOnce({
        id: 'internal-note-1',
        ticketId: 'ticket-1',
        authorId: 'user-123',
        body: 'Catatan internal.',
        createdAt: new Date('2025-01-01T10:00:00Z'),
        updatedAt: new Date('2025-01-01T10:00:00Z'),
        author: fakeMembership,
      } as never);

      const response = await POST(
        createRequest({ method: 'POST', body: JSON.stringify({ body: 'Catatan internal.' }) }),
        { params: Promise.resolve({ id: 'ticket-1' }) },
      );
      const body = await response.json();

      expect(response.status).toBe(201);
      expect(body.id).toBe('internal-note-1');
      expect(body.body).toBe('Catatan internal.');
    });
  });
});
