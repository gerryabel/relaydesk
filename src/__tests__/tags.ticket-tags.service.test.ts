import { describe, it, expect, vi, afterEach } from 'vitest';
import { prisma as sharedPrisma } from '@/lib/db/prisma';
import {
  addTagToTicket,
  removeTagFromTicket,
  getTicketTags,
  TicketNotFoundError,
  TicketTagAlreadyExistsError,
  TicketTagNotFoundError,
  TicketNotInWorkspaceError,
} from '@/lib/tags/server';
import { getCurrentMembership } from '@/lib/workspace/server';

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
} as const;

const fakeTag = {
  id: 'tag-1',
  workspaceId: 'workspace-123',
  name: 'Billing',
  normalizedName: 'billing',
} as const;

describe('ticket tag services', () => {
  afterEach(() => {
    vi.resetAllMocks();
  });

  it('addTagToTicket attaches a tag and logs TAG_ADDED activity', async () => {
    mockedGetCurrentMembership.mockResolvedValue(fakeMembership as never);
    const findFirstSpy = vi.spyOn(sharedPrisma.ticket, 'findFirst').mockResolvedValue(fakeTicket as never);
    const tagFindFirstSpy = vi.spyOn(sharedPrisma.tag, 'findFirst').mockResolvedValue(fakeTag as never);
    const transactionSpy = vi.spyOn(sharedPrisma, '$transaction').mockImplementation(async (worker) => {
      const txClient = {
        ticketTag: { create: vi.fn().mockResolvedValue({ ticketId: 'ticket-1', tagId: 'tag-1' } as never) },
        ticketActivity: { create: vi.fn().mockResolvedValue({ id: 'activity-1' } as never) },
      } as never;

      return worker(txClient);
    });

    try {
      await addTagToTicket('ticket-1', 'tag-1');

      expect(findFirstSpy).toHaveBeenCalledWith({
        where: { id: 'ticket-1', workspaceId: 'workspace-123' },
        select: { id: true, workspaceId: true },
      });
      expect(tagFindFirstSpy).toHaveBeenCalledWith({
        where: { id: 'tag-1' },
        select: { id: true, workspaceId: true, name: true },
      });
      expect(transactionSpy).toHaveBeenCalledTimes(1);
    } finally {
      findFirstSpy.mockRestore();
      tagFindFirstSpy.mockRestore();
      transactionSpy.mockRestore();
    }
  });

  it('addTagToTicket rejects duplicate attachment', async () => {
    mockedGetCurrentMembership.mockResolvedValue(fakeMembership as never);
    vi.spyOn(sharedPrisma.ticket, 'findFirst').mockResolvedValue(fakeTicket as never);
    vi.spyOn(sharedPrisma.tag, 'findFirst').mockResolvedValue(fakeTag as never);

    const uniqueError = new Error('Unique constraint failed') as Error & { code?: string; meta?: { target?: string[]; modelName?: string } };
    uniqueError.code = 'P2002';
    uniqueError.meta = { target: ['ticketId_tagId'], modelName: 'TicketTag' };

    const transactionSpy = vi.spyOn(sharedPrisma, '$transaction').mockRejectedValueOnce(uniqueError);

    try {
      await expect(addTagToTicket('ticket-1', 'tag-1')).rejects.toThrow(TicketTagAlreadyExistsError);
      expect(transactionSpy).toHaveBeenCalledTimes(1);
    } finally {
      transactionSpy.mockRestore();
    }
  });

  it('addTagToTicket rejects cross-workspace ticket and tag', async () => {
    mockedGetCurrentMembership.mockResolvedValue(fakeMembership as never);
    vi.spyOn(sharedPrisma.ticket, 'findFirst').mockResolvedValue(fakeTicket as never);
    vi.spyOn(sharedPrisma.tag, 'findFirst').mockResolvedValue({ ...fakeTag, workspaceId: 'workspace-other' } as never);

    await expect(addTagToTicket('ticket-1', 'tag-1')).rejects.toThrow(TicketNotInWorkspaceError);
  });

  it('removeTagFromTicket removes association and logs TAG_REMOVED activity', async () => {
    mockedGetCurrentMembership.mockResolvedValue(fakeMembership as never);
    vi.spyOn(sharedPrisma.ticket, 'findFirst').mockResolvedValue(fakeTicket as never);
    vi.spyOn(sharedPrisma.ticketTag, 'findFirst').mockResolvedValue({
      ticketId: 'ticket-1',
      tagId: 'tag-1',
      tag: fakeTag,
    } as never);

    const transactionSpy = vi.spyOn(sharedPrisma, '$transaction').mockImplementation(async (worker) => {
      const txClient = {
        ticketTag: { delete: vi.fn().mockResolvedValue({ ticketId: 'ticket-1', tagId: 'tag-1' } as never) },
        ticketActivity: { create: vi.fn().mockResolvedValue({ id: 'activity-1' } as never) },
      } as never;

      return worker(txClient);
    });

    try {
      await removeTagFromTicket('ticket-1', 'tag-1');

      expect(sharedPrisma.ticketTag.findFirst).toHaveBeenCalledWith({
        where: { ticketId: 'ticket-1', tagId: 'tag-1' },
        include: { tag: { select: { id: true, name: true, workspaceId: true } } },
      });
      expect(transactionSpy).toHaveBeenCalledTimes(1);
    } finally {
      transactionSpy.mockRestore();
    }
  });

  it('removeTagFromTicket throws TicketTagNotFoundError when association is missing', async () => {
    mockedGetCurrentMembership.mockResolvedValue(fakeMembership as never);
    vi.spyOn(sharedPrisma.ticket, 'findFirst').mockResolvedValue(fakeTicket as never);
    vi.spyOn(sharedPrisma.ticketTag, 'findFirst').mockResolvedValue(null as never);

    await expect(removeTagFromTicket('ticket-1', 'tag-1')).rejects.toThrow(TicketTagNotFoundError);
  });

  it('getTicketTags returns tags for the ticket', async () => {
    mockedGetCurrentMembership.mockResolvedValue(fakeMembership as never);
    vi.spyOn(sharedPrisma.ticket, 'findFirst').mockResolvedValue(fakeTicket as never);
    vi.spyOn(sharedPrisma.ticketTag, 'findMany').mockResolvedValue([
      { ticketId: 'ticket-1', tag: fakeTag },
    ] as never);

    const tags = await getTicketTags('ticket-1');

    expect(tags).toHaveLength(1);
    expect(tags[0].name).toBe('Billing');
  });

  it('getTicketTags throws TicketNotFoundError when ticket is missing', async () => {
    mockedGetCurrentMembership.mockResolvedValue(fakeMembership as never);
    vi.spyOn(sharedPrisma.ticket, 'findFirst').mockResolvedValue(null as never);

    await expect(getTicketTags('missing')).rejects.toThrow(TicketNotFoundError);
  });

  it('addTagToTicket does not delete ticket on tag deletion', async () => {
    mockedGetCurrentMembership.mockResolvedValue(fakeMembership as never);
    vi.spyOn(sharedPrisma.ticket, 'findFirst').mockResolvedValue(fakeTicket as never);
    vi.spyOn(sharedPrisma.tag, 'findFirst').mockResolvedValue(fakeTag as never);
    vi.spyOn(sharedPrisma, '$transaction').mockImplementation(async (worker) => {
      const txClient = {
        ticketTag: { create: vi.fn() },
        ticketActivity: { create: vi.fn() },
      } as never;

      return worker(txClient);
    });
    const deleteSpy = vi.spyOn(sharedPrisma.ticket, 'delete').mockResolvedValue({ ...fakeTicket } as never);

    await addTagToTicket('ticket-1', 'tag-1');

    expect(deleteSpy).not.toHaveBeenCalled();
  });
});
