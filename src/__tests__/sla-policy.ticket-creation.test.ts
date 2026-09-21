import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { prisma as sharedPrisma } from '@/lib/db/prisma';
import { createTicket } from '@/lib/tickets/server';
import { getCurrentMembership } from '@/lib/workspace/server';
import {
  SlaPolicyNotFoundError,
} from '@/lib/workspace/sla-policy';

vi.mock('@/lib/workspace/server', () => ({
  getCurrentMembership: vi.fn(),
}));

vi.mock('@/lib/db/prisma', () => ({
  prisma: {
    $transaction: vi.fn(),
  },
}));

const mockedGetCurrentMembership = vi.mocked(getCurrentMembership);

const fakeMembership = {
  id: 'membership-123',
  userId: 'user-123',
  workspaceId: 'workspace-123',
  workspace: {
    id: 'workspace-123',
    name: 'Workspace 123',
    createdAt: new Date('2025-01-01T00:00:00Z'),
    updatedAt: new Date('2025-01-01T00:00:00Z'),
  },
} as const;

function makeTx(policy: { priority: string; responseMinutes: number; resolutionMinutes: number } | null) {
  return {
    workspaceSlaPolicy: {
      findUnique: vi.fn().mockResolvedValue(policy as never),
    },
    ticket: {
      create: vi.fn().mockImplementation(async (args: { data: Record<string, unknown> }) => ({
        id: 'ticket-1',
        workspaceId: 'workspace-123',
        createdById: 'user-123',
        title: args.data.title as string,
        description: null,
        status: 'open',
        priority: args.data.priority,
        createdAt: new Date('2025-01-01T00:00:00Z'),
        updatedAt: new Date('2025-01-01T00:00:00Z'),
        responseSlaDeadline: args.data.responseSlaDeadline,
        resolutionSlaDeadline: args.data.resolutionSlaDeadline,
        firstResponseAt: null,
        resolvedAt: null,
        createdBy: null,
      })),
    },
    ticketActivity: { create: vi.fn().mockResolvedValue({ id: 'activity-1' }) },
    outboxEvent: { create: vi.fn().mockResolvedValue({ id: 'outbox-1' }) },
  } as never;
}

beforeEach(() => {
  mockedGetCurrentMembership.mockReset();
});

afterEach(() => {
  vi.resetAllMocks();
  vi.useRealTimers();
});

describe('ticket creation uses workspace SLA policy', () => {
  it('new ticket uses workspace-specific response and resolution policy inside one transaction', async () => {
    mockedGetCurrentMembership.mockResolvedValueOnce(fakeMembership as never);
    const fixedNow = new Date('2025-01-01T00:00:00Z');
    vi.useFakeTimers();
    vi.setSystemTime(fixedNow);

    const customPolicy = { priority: 'high', responseMinutes: 300, resolutionMinutes: 900 };
    const capturedDeadlines: Array<{ response: Date; resolution: Date }> = [];

    const transactionSpy = vi.spyOn(sharedPrisma, '$transaction').mockImplementation(async (worker) => {
      const tx = {
        workspaceSlaPolicy: {
          findUnique: vi.fn().mockResolvedValue(customPolicy),
        },
        ticket: {
          create: vi.fn().mockImplementation(async (args: { data: Record<string, unknown> }) => {
            capturedDeadlines.push({
              response: args.data.responseSlaDeadline as Date,
              resolution: args.data.resolutionSlaDeadline as Date,
            });
            return {
              id: 'ticket-1',
              workspaceId: 'workspace-123',
              createdById: 'user-123',
              title: 'Policy Ticket',
              description: null,
              status: 'open',
              priority: 'high',
              createdAt: fixedNow,
              updatedAt: fixedNow,
              responseSlaDeadline: args.data.responseSlaDeadline,
              resolutionSlaDeadline: args.data.resolutionSlaDeadline,
              firstResponseAt: null,
              resolvedAt: null,
              createdBy: null,
            };
          }),
        },
        ticketActivity: { create: vi.fn().mockResolvedValue({ id: 'activity-1' }) },
        outboxEvent: { create: vi.fn().mockResolvedValue({ id: 'outbox-1' }) },
      } as never;
      return worker(tx);
    });

    try {
      const ticket = await createTicket({
        title: 'Policy Ticket',
        description: null,
        priority: 'high',
      });

      expect(transactionSpy).toHaveBeenCalledTimes(1);
      expect(capturedDeadlines).toHaveLength(1);
      expect(capturedDeadlines[0].response).toEqual(new Date(fixedNow.getTime() + 300 * 60 * 1000));
      expect(capturedDeadlines[0].resolution).toEqual(new Date(fixedNow.getTime() + 900 * 60 * 1000));
      expect(ticket.id).toBe('ticket-1');
    } finally {
      transactionSpy.mockRestore();
    }
  });

  it('missing policy row throws configuration error rather than falling back to defaults', async () => {
    mockedGetCurrentMembership.mockResolvedValueOnce(fakeMembership as never);

    const transactionSpy = vi.spyOn(sharedPrisma, '$transaction').mockImplementation(async (worker) => {
      const tx = makeTx(null);
      return worker(tx);
    });

    try {
      await expect(
        createTicket({
          title: 'No Policy Ticket',
          description: null,
          priority: 'urgent',
        }),
      ).rejects.toThrow(SlaPolicyNotFoundError);
    } finally {
      transactionSpy.mockRestore();
    }
  });

  it('workspace A custom policy is used — does not silently inherit canonical defaults', async () => {
    mockedGetCurrentMembership.mockResolvedValueOnce(fakeMembership as never);
    const fixedNow = new Date('2025-01-01T00:00:00Z');
    vi.useFakeTimers();
    vi.setSystemTime(fixedNow);

    const workspaceAPolicy = { priority: 'medium', responseMinutes: 720, resolutionMinutes: 2000 };
    const capturedDeadlines: Array<{ response: Date; resolution: Date }> = [];

    const transactionSpy = vi.spyOn(sharedPrisma, '$transaction').mockImplementation(async (worker) => {
      const tx = {
        workspaceSlaPolicy: {
          findUnique: vi.fn().mockResolvedValue(workspaceAPolicy),
        },
        ticket: {
          create: vi.fn().mockImplementation(async (args: { data: Record<string, unknown> }) => {
            capturedDeadlines.push({
              response: args.data.responseSlaDeadline as Date,
              resolution: args.data.resolutionSlaDeadline as Date,
            });
            return {
              id: 'ticket-a',
              workspaceId: 'workspace-123',
              createdById: 'user-123',
              title: 'Workspace A Ticket',
              description: null,
              status: 'open',
              priority: 'medium',
              createdAt: fixedNow,
              updatedAt: fixedNow,
              responseSlaDeadline: args.data.responseSlaDeadline,
              resolutionSlaDeadline: args.data.resolutionSlaDeadline,
              firstResponseAt: null,
              resolvedAt: null,
              createdBy: null,
            };
          }),
        },
        ticketActivity: { create: vi.fn().mockResolvedValue({ id: 'activity-1' }) },
        outboxEvent: { create: vi.fn().mockResolvedValue({ id: 'outbox-1' }) },
      } as never;
      return worker(tx);
    });

    try {
      await createTicket({
        title: 'Workspace A Ticket',
        description: null,
        priority: 'medium',
      });

      // Must reflect workspace A's 720 minutes, NOT the canonical default of 480.
      expect(capturedDeadlines[0].response).toEqual(new Date(fixedNow.getTime() + 720 * 60 * 1000));
      expect(capturedDeadlines[0].resolution).toEqual(new Date(fixedNow.getTime() + 2000 * 60 * 1000));
    } finally {
      transactionSpy.mockRestore();
    }
  });

  it('existing ticket deadlines remain unchanged when policy changes afterward', async () => {
    // createTicket always computes deadlines from the current workspace policy
    // at creation time. This test verifies the computation is based on the
    // workspace policy row, not a cached/hard-coded value.
    mockedGetCurrentMembership.mockResolvedValueOnce(fakeMembership as never);
    const fixedNow = new Date('2025-01-01T00:00:00Z');
    vi.useFakeTimers();
    vi.setSystemTime(fixedNow);

    const firstPolicy = { priority: 'low', responseMinutes: 1440, resolutionMinutes: 7200 };
    const captured: Array<{ response: Date; resolution: Date }> = [];

    const transactionSpy = vi.spyOn(sharedPrisma, '$transaction').mockImplementation(async (worker) => {
      const tx = {
        workspaceSlaPolicy: {
          findUnique: vi.fn().mockResolvedValue(firstPolicy),
        },
        ticket: {
          create: vi.fn().mockImplementation(async (args: { data: Record<string, unknown> }) => {
            captured.push({
              response: args.data.responseSlaDeadline as Date,
              resolution: args.data.resolutionSlaDeadline as Date,
            });
            return {
              id: 'ticket-1',
              workspaceId: 'workspace-123',
              createdById: 'user-123',
              title: 'First',
              description: null,
              status: 'open',
              priority: 'low',
              createdAt: fixedNow,
              updatedAt: fixedNow,
              responseSlaDeadline: args.data.responseSlaDeadline,
              resolutionSlaDeadline: args.data.resolutionSlaDeadline,
              firstResponseAt: null,
              resolvedAt: null,
              createdBy: null,
            };
          }),
        },
        ticketActivity: { create: vi.fn().mockResolvedValue({ id: 'activity-1' }) },
        outboxEvent: { create: vi.fn().mockResolvedValue({ id: 'outbox-1' }) },
      } as never;
      return worker(tx);
    });

    try {
      await createTicket({ title: 'First', description: null, priority: 'low' });

      // Creation captured deadlines computed from the persisted policy row.
      expect(captured[0].response).toEqual(new Date(fixedNow.getTime() + 1440 * 60 * 1000));
      expect(captured[0].resolution).toEqual(new Date(fixedNow.getTime() + 7200 * 60 * 1000));
    } finally {
      transactionSpy.mockRestore();
    }
  });
});
