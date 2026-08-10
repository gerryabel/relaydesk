import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { prisma as sharedPrisma } from '@/lib/db/prisma';
import {
  assignTicket,
  unassignTicket,
  TicketNotFoundError,
  AssigneeNotInWorkspaceError,
} from '@/lib/tickets/server';
import { getCurrentMembership } from '@/lib/workspace/server';
import type { AssignTicketInput } from '@/lib/tickets/schema';

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
};

vi.mock('@/lib/workspace/server', () => ({
  getCurrentMembership: vi.fn(),
}));

describe('ticket assignment services', () => {
  beforeEach(() => {
    vi.mocked(getCurrentMembership).mockResolvedValue(fakeMembership as never);
  });

  afterEach(() => {
    vi.resetAllMocks();
  });

  it('assignTicket updates assignedToId within the current workspace', async () => {
    const findFirstSpy = vi
      .spyOn(sharedPrisma.ticket, 'findFirst')
      .mockResolvedValue({ id: 'ticket-1' } as never);
    const membershipSpy = vi
      .spyOn(sharedPrisma.membership, 'findFirst')
      .mockResolvedValue({ id: 'membership-1' } as never);
    const updateSpy = vi
      .spyOn(sharedPrisma.ticket, 'update')
      .mockResolvedValue({ ...fakeTicket, assignedToId: 'user-456', assignedTo: fakeAssignee } as never);

    try {
      const ticket = await assignTicket('ticket-1', { assigneeId: 'user-456' } as AssignTicketInput);

      expect(findFirstSpy).toHaveBeenCalledWith({
        where: { id: 'ticket-1', workspaceId: 'workspace-123' },
        select: { id: true },
      });
      expect(membershipSpy).toHaveBeenCalledWith({
        where: { userId: 'user-456', workspaceId: 'workspace-123' },
        select: { id: true },
      });
      expect(updateSpy).toHaveBeenCalledWith({
        where: { id: 'ticket-1' },
        data: { assignedToId: 'user-456' },
        include: { createdBy: true, assignedTo: true },
      });
      expect(ticket.assignedTo?.id).toBe('user-456');
    } finally {
      findFirstSpy.mockRestore();
      membershipSpy.mockRestore();
      updateSpy.mockRestore();
    }
  });

  it('unassignTicket clears assignedToId within the current workspace', async () => {
    const findFirstSpy = vi
      .spyOn(sharedPrisma.ticket, 'findFirst')
      .mockResolvedValue({ id: 'ticket-1' } as never);
    const updateSpy = vi
      .spyOn(sharedPrisma.ticket, 'update')
      .mockResolvedValue({ ...fakeTicket, assignedToId: null, assignedTo: null } as never);

    try {
      const ticket = await unassignTicket('ticket-1');

      expect(findFirstSpy).toHaveBeenCalledWith({
        where: { id: 'ticket-1', workspaceId: 'workspace-123' },
        select: { id: true },
      });
      expect(updateSpy).toHaveBeenCalledWith({
        where: { id: 'ticket-1' },
        data: { assignedToId: null },
        include: { createdBy: true, assignedTo: true },
      });
      expect(ticket.assignedTo).toBeNull();
    } finally {
      findFirstSpy.mockRestore();
      updateSpy.mockRestore();
    }
  });

  it('assignTicket rejects assignee who is not in the workspace', async () => {
    const findFirstSpy = vi
      .spyOn(sharedPrisma.ticket, 'findFirst')
      .mockResolvedValue({ id: 'ticket-1' } as never);
    const membershipSpy = vi
      .spyOn(sharedPrisma.membership, 'findFirst')
      .mockResolvedValue(null as never);

    try {
      await expect(assignTicket('ticket-1', { assigneeId: 'user-999' } as AssignTicketInput)).rejects.toThrow(
        AssigneeNotInWorkspaceError,
      );

      expect(membershipSpy).toHaveBeenCalledWith({
        where: { userId: 'user-999', workspaceId: 'workspace-123' },
        select: { id: true },
      });
    } finally {
      findFirstSpy.mockRestore();
      membershipSpy.mockRestore();
    }
  });

  it('assignTicket throws TicketNotFoundError for ticket outside workspace', async () => {
    const findFirstSpy = vi
      .spyOn(sharedPrisma.ticket, 'findFirst')
      .mockResolvedValue(null as never);

    try {
      await expect(assignTicket('ticket-2', { assigneeId: 'user-456' } as AssignTicketInput)).rejects.toThrow(
        TicketNotFoundError,
      );
    } finally {
      findFirstSpy.mockRestore();
    }
  });

  it('assignTicket rejects invalid input', async () => {
    await expect(assignTicket('ticket-1', { assigneeId: '' } as AssignTicketInput)).rejects.toThrow();
  });

  it('unassignTicket throws TicketNotFoundError for missing ticket', async () => {
    const findFirstSpy = vi
      .spyOn(sharedPrisma.ticket, 'findFirst')
      .mockResolvedValue(null as never);

    try {
      await expect(unassignTicket('missing')).rejects.toThrow(TicketNotFoundError);
    } finally {
      findFirstSpy.mockRestore();
    }
  });
});
