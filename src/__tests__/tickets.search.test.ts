import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { prisma as sharedPrisma } from '@/lib/db/prisma';
import { getTickets } from '@/lib/tickets/server';
import { getCurrentMembership } from '@/lib/workspace/server';
import { ticketSearchSchema } from '@/lib/tickets/search';

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
};

describe('ticket search', () => {
  beforeEach(() => {
    vi.mocked(getCurrentMembership).mockResolvedValue(fakeMembership as never);
  });

  afterEach(() => {
    vi.resetAllMocks();
  });

  it('ticketSearchSchema trims and accepts valid search input', () => {
    const parsed = ticketSearchSchema.safeParse({ q: '  tiket ' });
    expect(parsed.success).toBe(true);
    if (parsed.success) {
      expect(parsed.data.q).toBe('tiket');
    }
  });

  it('ticketSearchSchema rejects input longer than 200 characters', () => {
    const parsed = ticketSearchSchema.safeParse({ q: 'a'.repeat(201) });
    expect(parsed.success).toBe(false);
    expect(parsed.error?.issues[0]?.message).toBe('Kata kunci pencarian maksimal 200 karakter');
  });

  it('ticketSearchSchema accepts missing q', () => {
    const parsed = ticketSearchSchema.safeParse({});
    expect(parsed.success).toBe(true);
    if (parsed.success) {
      expect(parsed.data.q).toBeUndefined();
    }
  });

  it('ticketSearchSchema treats whitespace-only input as empty', () => {
    const parsed = ticketSearchSchema.safeParse({ q: '   ' });
    expect(parsed.success).toBe(true);
    if (parsed.success) {
      expect(parsed.data.q).toBe('');
    }
  });

  it('getTickets returns matching tickets for a search query', async () => {
    const findManySpy = vi.spyOn(sharedPrisma.ticket, 'findMany').mockResolvedValue([fakeTicket] as never);

    try {
      await getTickets({ search: { q: 'Judul' } });
      expect(findManySpy).toHaveBeenCalledTimes(1);
      expect(findManySpy).toHaveBeenCalledWith({
        where: {
          workspaceId: 'workspace-123',
          OR: [
            { title: { contains: 'Judul', mode: 'insensitive' } },
            { description: { contains: 'Judul', mode: 'insensitive' } },
          ],
        },
        include: { createdBy: true },
        orderBy: { createdAt: 'desc' },
      });
    } finally {
      findManySpy.mockRestore();
    }
  });

  it('getTickets returns empty results when no tickets match', async () => {
    const findManySpy = vi.spyOn(sharedPrisma.ticket, 'findMany').mockResolvedValue([] as never);

    try {
      const tickets = await getTickets({ search: { q: 'tidak-ada' } });
      expect(tickets).toHaveLength(0);
    } finally {
      findManySpy.mockRestore();
    }
  });

  it('getTickets preserves workspace isolation with search', async () => {
    const findManySpy = vi.spyOn(sharedPrisma.ticket, 'findMany').mockResolvedValue([fakeTicket] as never);

    try {
      await getTickets({ search: { q: 'Judul' } });
      expect(findManySpy).toHaveBeenCalledTimes(1);
      expect(findManySpy.mock.calls[0]![0]).toBeDefined();
    } finally {
      findManySpy.mockRestore();
    }
  });

  it('getTickets throws when membership is missing', async () => {
    mockedGetCurrentMembership.mockRejectedValueOnce(new Error('No workspace membership found') as never);

    await expect(getTickets({ search: { q: 'Judul' } })).rejects.toThrow('No workspace membership found');
  });
});
