import { describe, it, expect, vi, afterEach } from 'vitest';
import { prisma as sharedPrisma } from '@/lib/db/prisma';
import {
  getInternalNotes,
  createInternalNote,
} from '@/lib/internal-notes/server';
import { getCurrentMembership } from '@/lib/workspace/server';

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

const fakeAuthor = {
  id: 'user-123',
  name: 'User 123',
  email: 'user@example.com',
};

const fakeInternalNote = {
  id: 'internal-note-1',
  ticketId: 'ticket-1',
  authorId: 'user-123',
  body: 'Customer sudah dikontak via telepon.',
  createdAt: new Date('2025-01-01T10:00:00Z'),
  updatedAt: new Date('2025-01-01T10:00:00Z'),
  author: fakeAuthor,
};

const fakeTicket = {
  id: 'ticket-1',
  workspaceId: 'workspace-123',
};

const fakeActivity = {
  id: 'activity-1',
  ticketId: 'ticket-1',
  actorId: 'user-123',
  type: 'INTERNAL_NOTE_CREATED',
  metadata: { internalNoteId: 'internal-note-1' },
  createdAt: new Date('2025-01-01T10:00:00Z'),
  actor: fakeAuthor,
};

vi.mock('@/lib/workspace/server', () => ({
  getCurrentMembership: vi.fn(),
}));

describe('internal note service', () => {
  afterEach(() => {
    vi.resetAllMocks();
  });

  describe('createInternalNote', () => {
    it('creates a valid internal note and activity atomically', async () => {
      vi.mocked(getCurrentMembership).mockResolvedValue(fakeMembership as never);

      const transactionSpy = vi.spyOn(sharedPrisma, '$transaction').mockImplementation(async (worker) => {
        const txClient = {
          ticket: {
            findFirst: vi.fn().mockResolvedValueOnce(fakeTicket as never),
          },
          internalNote: {
            create: vi.fn().mockResolvedValueOnce(fakeInternalNote as never),
          },
          ticketActivity: {
            create: vi.fn().mockResolvedValueOnce(fakeActivity as never),
          },
        } as unknown as Parameters<typeof worker>[0];

        return worker(txClient);
      });

      try {
        const note = await createInternalNote('ticket-1', { body: 'Customer sudah dikontak via telepon.' });

        expect(note.id).toBe('internal-note-1');
        expect(note.author.name).toBe('User 123');
        expect(transactionSpy).toHaveBeenCalledTimes(1);
      } finally {
        transactionSpy.mockRestore();
      }
    });

    it('rolls back when activity creation fails', async () => {
      vi.mocked(getCurrentMembership).mockResolvedValue(fakeMembership as never);

      const transactionSpy = vi.spyOn(sharedPrisma, '$transaction').mockImplementation(async (worker) => {
        const txClient = {
          ticket: {
            findFirst: vi.fn().mockResolvedValueOnce(fakeTicket as never),
          },
          internalNote: {
            create: vi.fn().mockResolvedValueOnce(fakeInternalNote as never),
          },
          ticketActivity: {
            create: vi.fn().mockRejectedValueOnce(new Error('activity failed')),
          },
        } as unknown as Parameters<typeof worker>[0];

        await worker(txClient);
      });

      try {
        await expect(createInternalNote('ticket-1', { body: 'Customer sudah dikontak via telepon.' })).rejects.toThrow(
          'activity failed',
        );
      } finally {
        transactionSpy.mockRestore();
      }
    });

    it('does not create activity when note creation fails', async () => {
      vi.mocked(getCurrentMembership).mockResolvedValue(fakeMembership as never);

      const transactionSpy = vi.spyOn(sharedPrisma, '$transaction').mockImplementation(async (worker) => {
        const txClient = {
          ticket: {
            findFirst: vi.fn().mockResolvedValueOnce(fakeTicket as never),
          },
          internalNote: {
            create: vi.fn().mockRejectedValueOnce(new Error('note failed')),
          },
          ticketActivity: {
            create: vi.fn().mockResolvedValueOnce(fakeActivity as never),
          },
        } as unknown as Parameters<typeof worker>[0];

        await worker(txClient);
      });

      try {
        await expect(createInternalNote('ticket-1', { body: 'Customer sudah dikontak via telepon.' })).rejects.toThrow(
          'note failed',
        );
      } finally {
        transactionSpy.mockRestore();
      }
    });

    it('throws when ticket is missing', async () => {
      vi.mocked(getCurrentMembership).mockResolvedValue(fakeMembership as never);

      const transactionSpy = vi.spyOn(sharedPrisma, '$transaction').mockImplementation(async (worker) => {
        const txClient = {
          ticket: {
            findFirst: vi.fn().mockResolvedValueOnce(null as never),
          },
          internalNote: { create: vi.fn() },
          ticketActivity: { create: vi.fn() },
        } as unknown as Parameters<typeof worker>[0];

        await worker(txClient);
      });

      try {
        await expect(createInternalNote('ticket-1', { body: 'Customer sudah dikontak via telepon.' })).rejects.toThrow(
          'Tiket tidak ditemukan',
        );
      } finally {
        transactionSpy.mockRestore();
      }
    });

    it('throws for wrong workspace', async () => {
      vi.mocked(getCurrentMembership).mockResolvedValue({
        ...fakeMembership,
        workspaceId: 'workspace-other',
      } as never);

      const transactionSpy = vi.spyOn(sharedPrisma, '$transaction').mockImplementation(async (worker) => {
        const txClient = {
          ticket: {
            findFirst: vi.fn().mockResolvedValueOnce(null as never),
          },
          internalNote: { create: vi.fn() },
          ticketActivity: { create: vi.fn() },
        } as unknown as Parameters<typeof worker>[0];

        await worker(txClient);
      });

      try {
        await expect(createInternalNote('ticket-1', { body: 'Customer sudah dikontak via telepon.' })).rejects.toThrow(
          'Tiket tidak ditemukan',
        );
      } finally {
        transactionSpy.mockRestore();
      }
    });
  });

  describe('getInternalNotes', () => {
    it('returns notes ordered by createdAt for a ticket in the current workspace', async () => {
      vi.mocked(getCurrentMembership).mockResolvedValue(fakeMembership as never);
      vi.spyOn(sharedPrisma.ticket, 'findFirst').mockResolvedValue(fakeTicket as never);
      vi.spyOn(sharedPrisma.internalNote, 'findMany').mockResolvedValue([fakeInternalNote] as never);

      const notes = await getInternalNotes('ticket-1');

      expect(notes).toHaveLength(1);
      expect(notes[0].author.email).toBe('user@example.com');
    });
  });

  describe('validation', () => {
    it('rejects empty body', async () => {
      await expect(createInternalNote('ticket-1', { body: '   ' })).rejects.toThrow();
    });

    it('rejects whitespace-only body', async () => {
      await expect(createInternalNote('ticket-1', { body: '\t\n' })).rejects.toThrow();
    });

    it('rejects body over 10000 characters', async () => {
      await expect(createInternalNote('ticket-1', { body: 'a'.repeat(10001) })).rejects.toThrow();
    });

    it('accepts valid body at the maximum length', async () => {
      vi.mocked(getCurrentMembership).mockResolvedValue(fakeMembership as never);

      const transactionSpy = vi.spyOn(sharedPrisma, '$transaction').mockImplementation(async (worker) => {
        const txClient = {
          ticket: {
            findFirst: vi.fn().mockResolvedValueOnce(fakeTicket as never),
          },
          internalNote: {
            create: vi.fn().mockResolvedValueOnce({ ...fakeInternalNote, body: 'a'.repeat(10000) } as never),
          },
          ticketActivity: {
            create: vi.fn().mockResolvedValueOnce(fakeActivity as never),
          },
        } as unknown as Parameters<typeof worker>[0];

        return worker(txClient);
      });

      try {
        await expect(createInternalNote('ticket-1', { body: 'a'.repeat(10000) })).resolves.toBeDefined();
      } finally {
        transactionSpy.mockRestore();
      }
    });
  });
});
