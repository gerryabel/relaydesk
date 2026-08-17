import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { prisma as sharedPrisma } from '@/lib/db/prisma';
import { getCurrentMembership } from '@/lib/workspace/server';
import {
  getMyQueueTickets,
  getMyQueueCounts,
  resolveQueueView,
  DEFAULT_QUEUE_VIEW,
} from '@/lib/tickets/queue';

vi.mock('@/lib/workspace/server', () => ({ getCurrentMembership: vi.fn() }));

const membership = {
  userId: 'user-123',
  workspaceId: 'workspace-123',
  workspace: {
    id: 'workspace-123',
    name: 'Workspace 123',
    createdAt: new Date('2025-01-01T00:00:00Z'),
    updatedAt: new Date('2025-01-01T00:00:00Z'),
  },
};

const createdAt = new Date('2025-01-01T00:00:00Z');

const buildTicket = (overrides: Record<string, unknown> = {}) => ({
  id: overrides.id ?? 'ticket-1',
  workspaceId: 'workspace-123',
  title: '',
  description: null,
  createdAt,
  updatedAt: new Date('2025-01-01T00:00:00Z'),
  createdById: 'user-123',
  createdBy: null,
  assignedTo: null,
  customer: null,
  responseSlaDeadline: new Date('2099-01-01T00:00:00Z'),
  resolutionSlaDeadline: new Date('2099-01-01T00:00:00Z'),
  firstResponseAt: null,
  resolvedAt: null,
  ...overrides,
});

describe('queue domain', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(createdAt);
    vi.mocked(getCurrentMembership).mockResolvedValue(membership as never);
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it('resolveQueueView normalizes and defaults', () => {
    expect(resolveQueueView(undefined)).toBe(DEFAULT_QUEUE_VIEW);
    expect(resolveQueueView('my-open')).toBe('my-open');
    expect(resolveQueueView('unknown')).toBe(DEFAULT_QUEUE_VIEW);
  });

  it('getMyQueueTickets enforces current-user scope', async () => {
    const findManySpy = vi
      .spyOn(sharedPrisma.ticket, 'findMany')
      .mockResolvedValue([] as never);

    try {
      await getMyQueueTickets({});
      expect(findManySpy).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({ assignedToId: 'user-123', workspaceId: 'workspace-123' }),
        }),
      );
    } finally {
      findManySpy.mockRestore();
    }
  });

  it('getMyQueueCounts also enforces current-user scope', async () => {
    const findManySpy = vi
      .spyOn(sharedPrisma.ticket, 'findMany')
      .mockResolvedValue([] as never);

    try {
      await getMyQueueCounts({});
      expect(findManySpy).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({ assignedToId: 'user-123', workspaceId: 'workspace-123' }),
        }),
      );
    } finally {
      findManySpy.mockRestore();
    }
  });

  it('ignores conflicting assignee in current-user scope', async () => {
    const findManySpy = vi
      .spyOn(sharedPrisma.ticket, 'findMany')
      .mockResolvedValue([] as never);

    try {
      await getMyQueueTickets({ search: '?assignee=other-user' });
      for (const args of findManySpy.mock.calls) {
        expect((args[0] as { where?: { assignedToId: string } }).where).toMatchObject({ assignedToId: 'user-123' });
      }
    } finally {
      findManySpy.mockRestore();
    }
  });

  it('My Open includes open and in_progress', async () => {
    vi.spyOn(sharedPrisma.ticket, 'findMany').mockResolvedValue([
      buildTicket({ id: 'open', status: 'open', priority: 'medium' }),
      buildTicket({ id: 'in-progress', status: 'in_progress', priority: 'low' }),
      buildTicket({ id: 'resolved', status: 'resolved', priority: 'medium' }),
      buildTicket({ id: 'closed', status: 'closed', priority: 'medium' }),
      buildTicket({ id: 'waiting', status: 'waiting_customer', priority: 'medium' }),
    ] as never);

    const result = await getMyQueueTickets({ view: 'my-open' });
    expect(result.data.map((ticket) => ticket.id).sort()).toEqual(['in-progress', 'open']);
    expect(result.total).toBe(2);
  });

  it('Waiting includes waiting_customer only', async () => {
    vi.spyOn(sharedPrisma.ticket, 'findMany').mockResolvedValue([
      buildTicket({ id: 'waiting', status: 'waiting_customer', priority: 'low' }),
      buildTicket({ id: 'open', status: 'open', priority: 'medium' }),
    ] as never);

    const result = await getMyQueueTickets({ view: 'waiting' });
    expect(result.data.map((ticket) => ticket.id)).toEqual(['waiting']);
    expect(result.total).toBe(1);
  });

  it('High Priority includes high and urgent, excludes resolved/closed', async () => {
    vi.spyOn(sharedPrisma.ticket, 'findMany').mockResolvedValue([
      buildTicket({ id: 'high', status: 'open', priority: 'high' }),
      buildTicket({ id: 'urgent', status: 'in_progress', priority: 'urgent' }),
      buildTicket({ id: 'low', status: 'open', priority: 'low' }),
      buildTicket({ id: 'resolved', status: 'resolved', priority: 'high' }),
      buildTicket({ id: 'closed', status: 'closed', priority: 'urgent' }),
    ] as never);

    const result = await getMyQueueTickets({ view: 'high-priority' });
    expect(result.data.map((ticket) => ticket.id).sort()).toEqual(['high', 'urgent']);
    expect(result.total).toBe(2);
  });

  it('counts agree with view membership', async () => {
    vi.spyOn(sharedPrisma.ticket, 'findMany').mockResolvedValue([
      buildTicket({ id: 'open', status: 'open', priority: 'high' }),
      buildTicket({ id: 'waiting', status: 'waiting_customer', priority: 'medium' }),
      buildTicket({ id: 'urgent', priority: 'urgent', status: 'open' }),
      buildTicket({ id: 'resolved', status: 'resolved' }),
    ] as never);

    const counts = await getMyQueueCounts({});
    expect(counts['my-open']).toBe(2);
    expect(counts.waiting).toBe(1);
    expect(counts['high-priority']).toBe(2);
    expect(counts['sla-risk']).toBe(0);
  });

  it('paginates within the full filtered queue, not db page', async () => {
    const tickets = Array.from({ length: 120 }, (_, index) =>
      buildTicket({
        id: `ticket-${index + 1}`,
        status: 'open',
        priority: 'medium',
        updatedAt: new Date('2025-01-01T00:00:00Z'),
      }),
    );

    vi.spyOn(sharedPrisma.ticket, 'findMany').mockResolvedValue(tickets as never);

    const result = await getMyQueueTickets({ view: 'my-open', page: 2, limit: 20 });
    expect(result.total).toBe(120);
    expect(result.totalPages).toBe(6);
    expect(result.page).toBe(2);
    expect(result.data.map((ticket) => ticket.id)).toEqual([
      'ticket-21',
      'ticket-22',
      'ticket-23',
      'ticket-24',
      'ticket-25',
      'ticket-26',
      'ticket-27',
      'ticket-28',
      'ticket-29',
      'ticket-30',
      'ticket-31',
      'ticket-32',
      'ticket-33',
      'ticket-34',
      'ticket-35',
      'ticket-36',
      'ticket-37',
      'ticket-38',
      'ticket-39',
      'ticket-40',
    ]);
  });

  it('SLA At Risk includes response at_risk tickets', async () => {
    vi.setSystemTime(new Date('2025-01-01T06:24:00Z'));
    const findManySpy = vi.spyOn(sharedPrisma.ticket, 'findMany').mockResolvedValue([
      buildTicket({
        id: 'response-at-risk',
        status: 'open',
        priority: 'medium',
        responseSlaDeadline: new Date('2025-01-01T08:00:00Z'),
      }),
    ] as never);

    const result = await getMyQueueTickets({ view: 'sla-risk' });
    expect(result.data.map((ticket) => ticket.id)).toEqual(['response-at-risk']);
    expect(result.total).toBe(1);
    expect(findManySpy).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ assignedToId: 'user-123', workspaceId: 'workspace-123' }),
      }),
    );
  });

  it('SLA At Risk includes resolution at_risk tickets', async () => {
    vi.setSystemTime(new Date('2025-01-03T09:36:00Z'));
    const findManySpy = vi.spyOn(sharedPrisma.ticket, 'findMany').mockResolvedValue([
      buildTicket({
        id: 'resolution-at-risk',
        status: 'open',
        priority: 'medium',
        resolutionSlaDeadline: new Date('2025-01-04T00:00:00Z'),
      }),
    ] as never);

    const result = await getMyQueueTickets({ view: 'sla-risk' });
    expect(result.data.map((ticket) => ticket.id)).toEqual(['resolution-at-risk']);
    expect(result.total).toBe(1);
    expect(findManySpy).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ assignedToId: 'user-123', workspaceId: 'workspace-123' }),
      }),
    );
  });

  it('SLA At Risk excludes tickets that are neither at_risk', async () => {
    vi.spyOn(sharedPrisma.ticket, 'findMany').mockResolvedValue([
      buildTicket({ id: 'normal-1', status: 'open', priority: 'medium' }),
      buildTicket({ id: 'normal-2', status: 'in_progress', priority: 'medium' }),
    ] as never);

    const result = await getMyQueueTickets({ view: 'sla-risk' });
    expect(result.data).toHaveLength(0);
    expect(result.total).toBe(0);
  });

  it('SLA At Risk excludes completed SLA', async () => {
    vi.spyOn(sharedPrisma.ticket, 'findMany').mockResolvedValue([
      buildTicket({
        id: 'completed-response',
        status: 'open',
        priority: 'medium',
        responseSlaDeadline: new Date('2025-01-01T08:00:00Z'),
        firstResponseAt: new Date('2025-01-01T07:00:00Z'),
      }),
    ] as never);

    const result = await getMyQueueTickets({ view: 'sla-risk' });
    expect(result.data).toHaveLength(0);
    expect(result.total).toBe(0);
  });

  it('SLA At Risk excludes breached SLA', async () => {
    vi.setSystemTime(new Date('2025-01-01T10:00:00Z'));
    vi.spyOn(sharedPrisma.ticket, 'findMany').mockResolvedValue([
      buildTicket({
        id: 'breached-response',
        status: 'open',
        priority: 'medium',
        responseSlaDeadline: new Date('2025-01-01T08:00:00Z'),
      }),
    ] as never);

    const result = await getMyQueueTickets({ view: 'sla-risk' });
    expect(result.data).toHaveLength(0);
    expect(result.total).toBe(0);
  });

  it('SLA At Risk includes response completed but resolution at_risk', async () => {
    vi.setSystemTime(new Date('2025-01-03T09:36:00Z'));
    vi.spyOn(sharedPrisma.ticket, 'findMany').mockResolvedValue([
      buildTicket({
        id: 'mixed',
        status: 'open',
        priority: 'medium',
        responseSlaDeadline: new Date('2025-01-01T08:00:00Z'),
        firstResponseAt: new Date('2025-01-01T07:00:00Z'),
        resolutionSlaDeadline: new Date('2025-01-04T00:00:00Z'),
      }),
    ] as never);

    const result = await getMyQueueTickets({ view: 'sla-risk' });
    expect(result.data.map((ticket) => ticket.id)).toEqual(['mixed']);
    expect(result.total).toBe(1);
  });
});
