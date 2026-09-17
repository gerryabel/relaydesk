import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { prisma } from '@/lib/db/prisma';
import { getAnalytics, computeAnalytics } from '@/lib/analytics/server';
import { getCurrentMembership, UnauthorizedError, ForbiddenError } from '@/lib/workspace/server';
import { resolveDateRange } from '@/lib/analytics/schema';
import { getResponseSlaMonitoringStatus, getResolutionSlaMonitoringStatus } from '@/lib/tickets/sla';
import type { AnalyticsTicketRow } from '@/lib/analytics/server';
import type { DateRange } from '@/lib/analytics/types';

vi.mock('@/lib/auth/session', () => ({
  getServerAuthSession: vi.fn(),
}));

vi.mock('@/lib/workspace/server', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/workspace/server')>();
  return {
    ...actual,
    getCurrentMembership: vi.fn(),
  };
});

vi.mock('@/lib/db/prisma', () => ({
  prisma: {
    ticket: {
      findMany: vi.fn(),
      groupBy: vi.fn(),
    },
    membership: {
      findMany: vi.fn(),
    },
  },
}));

const mockedGetCurrentMembership = vi.mocked(getCurrentMembership);
const mockedTicketFindMany = vi.mocked(prisma.ticket.findMany);
const mockedTicketGroupBy = vi.mocked(prisma.ticket.groupBy);
const mockedMembershipFindMany = vi.mocked(prisma.membership.findMany);

const fakeMembership = {
  id: 'membership-self',
  userId: 'user-123',
  workspaceId: 'workspace-123',
  role: 'owner' as const,
  createdAt: new Date('2025-01-01T00:00:00Z'),
  updatedAt: new Date('2025-01-01T00:00:00Z'),
  workspace: {
    id: 'workspace-123',
    name: 'Workspace 123',
    createdAt: new Date('2025-01-01T00:00:00Z'),
    updatedAt: new Date('2025-01-01T00:00:00Z'),
  },
};

function makeRange(from: string, to: string): DateRange {
  const range = resolveDateRange(from, to);
  if (!range) throw new Error('invalid range in test');
  return range;
}

function makeTicket(overrides: Partial<AnalyticsTicketRow> = {}): AnalyticsTicketRow {
  return {
    id: 'ticket-1',
    status: 'open',
    priority: 'medium',
    createdAt: new Date('2025-01-01T00:00:00Z'),
    resolvedAt: null,
    assignedToId: 'user-123',
    responseSlaDeadline: null,
    resolutionSlaDeadline: null,
    firstResponseAt: null,
    ...overrides,
  };
}

beforeEach(() => {
  vi.restoreAllMocks();
  mockedGetCurrentMembership.mockReset();
  mockedTicketFindMany.mockReset();
  mockedTicketGroupBy.mockReset();
  mockedMembershipFindMany.mockReset();
});

afterEach(() => {
  vi.useRealTimers();
});

describe('getAnalytics — authorization and isolation', () => {
  it('throws UnauthorizedError when no session', async () => {
    mockedGetCurrentMembership.mockRejectedValueOnce(
      new UnauthorizedError('No authenticated session'),
    );

    await expect(getAnalytics({ from: '2026-09-01', to: '2026-09-10' })).rejects.toThrow(
      UnauthorizedError,
    );
  });

  it('throws ForbiddenError when no workspace membership', async () => {
    mockedGetCurrentMembership.mockRejectedValueOnce(
      new ForbiddenError('No workspace membership found'),
    );

    await expect(getAnalytics({ from: '2026-09-01', to: '2026-09-10' })).rejects.toThrow(
      ForbiddenError,
    );
  });

  it('queries tickets scoped to current workspace only', async () => {
    mockedGetCurrentMembership.mockResolvedValueOnce(fakeMembership as never);
    mockedTicketFindMany.mockResolvedValueOnce([] as never);
    mockedMembershipFindMany.mockResolvedValueOnce([] as never);
    mockedTicketGroupBy.mockResolvedValueOnce([] as never);

    await getAnalytics({ from: '2026-09-01', to: '2026-09-10' });

    expect(mockedTicketFindMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { workspaceId: 'workspace-123' } }),
    );
  });

  it('never trusts a client-supplied workspace id', async () => {
    mockedGetCurrentMembership.mockResolvedValueOnce(fakeMembership as never);
    mockedTicketFindMany.mockResolvedValueOnce([] as never);
    mockedMembershipFindMany.mockResolvedValueOnce([] as never);
    mockedTicketGroupBy.mockResolvedValueOnce([] as never);

    await getAnalytics({ from: '2026-09-01', to: '2026-09-10' });

    // The workspace id comes from the session, never from params.
    expect(mockedTicketFindMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { workspaceId: 'workspace-123' } }),
    );
  });

  it('includes owner assignment distribution for owner', async () => {
    mockedGetCurrentMembership.mockResolvedValueOnce(fakeMembership as never);
    mockedTicketFindMany.mockResolvedValueOnce([] as never);
    mockedMembershipFindMany.mockResolvedValueOnce([
      {
        userId: 'user-123',
        role: 'owner',
        user: { id: 'user-123', name: 'Alice', email: 'alice@example.com', image: null },
      },
    ] as never);
    mockedTicketGroupBy.mockResolvedValueOnce([
      { assignedToId: 'user-123', _count: { _all: 3 } },
    ] as never);

    const result = await getAnalytics({ from: '2026-09-01', to: '2026-09-10' });

    expect(result.role).toBe('owner');
    expect(result.owner).toBeDefined();
    expect(result.owner!.assignmentDistribution).toHaveLength(1);
    expect(result.owner!.assignmentDistribution[0]).toMatchObject({
      userId: 'user-123',
      assignedCount: 3,
    });
  });

  it('does NOT include assignment distribution for non-owner', async () => {
    mockedGetCurrentMembership.mockResolvedValueOnce({
      ...fakeMembership,
      role: 'member',
    } as never);
    mockedTicketFindMany.mockResolvedValueOnce([] as never);

    const result = await getAnalytics({ from: '2026-09-01', to: '2026-09-10' });

    expect(result.role).toBe('member');
    expect(result.owner).toBeUndefined();
    // membership findMany / groupBy must not be called for non-owner
    expect(mockedMembershipFindMany).not.toHaveBeenCalled();
    expect(mockedTicketGroupBy).not.toHaveBeenCalled();
  });
});

describe('computeAnalytics — ticket volume', () => {
  it('excludes tickets created before the range', () => {
    const range = makeRange('2026-09-01', '2026-09-30');
    const tickets = [
      makeTicket({ id: 't1', createdAt: new Date('2026-08-31T23:59:59Z') }),
      makeTicket({ id: 't2', createdAt: new Date('2026-09-01T00:00:00Z') }),
    ];

    const result = computeAnalytics(tickets, range, new Date('2026-09-30T00:00:00Z'));
    expect(result.ticketVolume).toBe(1);
  });

  it('includes ticket created exactly at start', () => {
    const range = makeRange('2026-09-01', '2026-09-30');
    const tickets = [makeTicket({ createdAt: new Date('2026-09-01T00:00:00Z') })];

    const result = computeAnalytics(tickets, range, new Date('2026-09-30T00:00:00Z'));
    expect(result.ticketVolume).toBe(1);
  });

  it('excludes ticket created exactly at end (end is exclusive)', () => {
    const range = makeRange('2026-09-01', '2026-09-30');
    // end = midnight Oct 1
    const tickets = [makeTicket({ createdAt: new Date('2026-10-01T00:00:00Z') })];

    const result = computeAnalytics(tickets, range, new Date('2026-09-30T00:00:00Z'));
    expect(result.ticketVolume).toBe(0);
  });

  it('buckets tickets into correct UTC days', () => {
    const range = makeRange('2026-09-01', '2026-09-03');
    const tickets = [
      makeTicket({ id: 't1', createdAt: new Date('2026-09-01T10:00:00Z') }),
      makeTicket({ id: 't2', createdAt: new Date('2026-09-01T22:00:00Z') }),
      makeTicket({ id: 't3', createdAt: new Date('2026-09-02T08:00:00Z') }),
    ];

    const result = computeAnalytics(tickets, range, new Date('2026-09-03T00:00:00Z'));
    expect(result.ticketVolume).toBe(3);
    expect(result.daily).toEqual([
      { date: '2026-09-01', ticketVolume: 2, resolutionCount: 0 },
      { date: '2026-09-02', ticketVolume: 1, resolutionCount: 0 },
      { date: '2026-09-03', ticketVolume: 0, resolutionCount: 0 },
    ]);
  });
});

describe('computeAnalytics — resolution count', () => {
  it('excludes unresolved tickets', () => {
    const range = makeRange('2026-09-01', '2026-09-30');
    const tickets = [makeTicket({ resolvedAt: null })];

    const result = computeAnalytics(tickets, range, new Date('2026-09-30T00:00:00Z'));
    expect(result.resolutionCount).toBe(0);
  });

  it('excludes tickets resolved before the range', () => {
    const range = makeRange('2026-09-01', '2026-09-30');
    const tickets = [
      makeTicket({ resolvedAt: new Date('2026-08-31T23:59:59Z') }),
      makeTicket({ resolvedAt: new Date('2026-09-01T00:00:00Z') }),
    ];

    const result = computeAnalytics(tickets, range, new Date('2026-09-30T00:00:00Z'));
    expect(result.resolutionCount).toBe(1);
  });

  it('includes ticket resolved exactly at start', () => {
    const range = makeRange('2026-09-01', '2026-09-30');
    const tickets = [makeTicket({ resolvedAt: new Date('2026-09-01T00:00:00Z') })];

    const result = computeAnalytics(tickets, range, new Date('2026-09-30T00:00:00Z'));
    expect(result.resolutionCount).toBe(1);
  });

  it('excludes ticket resolved exactly at end (end is exclusive)', () => {
    const range = makeRange('2026-09-01', '2026-09-30');
    const tickets = [makeTicket({ resolvedAt: new Date('2026-10-01T00:00:00Z') })];

    const result = computeAnalytics(tickets, range, new Date('2026-09-30T00:00:00Z'));
    expect(result.resolutionCount).toBe(0);
  });

  it('includes ticket created before range but resolved inside range', () => {
    const range = makeRange('2026-09-10', '2026-09-20');
    const tickets = [
      makeTicket({
        createdAt: new Date('2026-08-01T00:00:00Z'),
        resolvedAt: new Date('2026-09-15T12:00:00Z'),
      }),
    ];

    const result = computeAnalytics(tickets, range, new Date('2026-09-20T00:00:00Z'));
    expect(result.resolutionCount).toBe(1);
    expect(result.averageResolutionTime.count).toBe(1);
  });
});

describe('computeAnalytics — average resolution time', () => {
  it('computes average createdAt → resolvedAt', () => {
    const range = makeRange('2026-09-01', '2026-09-30');
    const tickets = [
      makeTicket({
        id: 't1',
        createdAt: new Date('2026-09-01T00:00:00Z'),
        resolvedAt: new Date('2026-09-02T00:00:00Z'), // 24h
      }),
      makeTicket({
        id: 't2',
        createdAt: new Date('2026-09-05T00:00:00Z'),
        resolvedAt: new Date('2026-09-05T12:00:00Z'), // 12h
      }),
    ];

    const result = computeAnalytics(tickets, range, new Date('2026-09-30T00:00:00Z'));
    expect(result.averageResolutionTime.count).toBe(2);
    expect(result.averageResolutionTime.averageMs).toBe((24 * 3600 + 12 * 3600) * 1000 / 2);
    expect(result.averageResolutionTime.human).toBe('18h 0m');
  });

  it('excludes unresolved tickets from average', () => {
    const range = makeRange('2026-09-01', '2026-09-30');
    const tickets = [
      makeTicket({ id: 't1', resolvedAt: new Date('2026-09-02T00:00:00Z') }),
      makeTicket({ id: 't2', resolvedAt: null }),
    ];

    const result = computeAnalytics(tickets, range, new Date('2026-09-30T00:00:00Z'));
    expect(result.averageResolutionTime.count).toBe(1);
  });

  it('handles zero qualifying resolutions safely', () => {
    const range = makeRange('2026-09-01', '2026-09-30');
    const tickets = [makeTicket({ resolvedAt: null })];

    const result = computeAnalytics(tickets, range, new Date('2026-09-30T00:00:00Z'));
    expect(result.averageResolutionTime).toEqual({
      count: 0,
      averageMs: null,
      human: null,
    });
  });

  it('includes ticket created before range but resolved inside range', () => {
    const range = makeRange('2026-09-10', '2026-09-20');
    const tickets = [
      makeTicket({
        createdAt: new Date('2026-09-01T00:00:00Z'),
        resolvedAt: new Date('2026-09-15T00:00:00Z'), // 14 days
      }),
    ];

    const result = computeAnalytics(tickets, range, new Date('2026-09-20T00:00:00Z'));
    expect(result.averageResolutionTime.count).toBe(1);
    expect(result.averageResolutionTime.human).toBe('14d 0h 0m');
  });
});

describe('computeAnalytics — status distribution', () => {
  it('counts all statuses correctly', () => {
    const range = makeRange('2026-09-01', '2026-09-30');
    const tickets = [
      makeTicket({ id: 't1', status: 'open' }),
      makeTicket({ id: 't2', status: 'open' }),
      makeTicket({ id: 't3', status: 'in_progress' }),
      makeTicket({ id: 't4', status: 'waiting_customer' }),
      makeTicket({ id: 't5', status: 'resolved' }),
      makeTicket({ id: 't6', status: 'closed' }),
      makeTicket({ id: 't7', status: 'closed' }),
    ];

    const result = computeAnalytics(tickets, range, new Date('2026-09-30T00:00:00Z'));
    expect(result.statusDistribution).toEqual({
      open: 2,
      in_progress: 1,
      waiting_customer: 1,
      resolved: 1,
      closed: 2,
    });
  });

  it('exposes zero entries for missing statuses', () => {
    const range = makeRange('2026-09-01', '2026-09-30');
    const tickets = [makeTicket({ status: 'open' })];

    const result = computeAnalytics(tickets, range, new Date('2026-09-30T00:00:00Z'));
    expect(result.statusDistribution).toEqual({
      open: 1,
      in_progress: 0,
      waiting_customer: 0,
      resolved: 0,
      closed: 0,
    });
  });
});

describe('computeAnalytics — priority distribution', () => {
  it('counts all priorities correctly', () => {
    const range = makeRange('2026-09-01', '2026-09-30');
    const tickets = [
      makeTicket({ id: 't1', priority: 'low' }),
      makeTicket({ id: 't2', priority: 'medium' }),
      makeTicket({ id: 't3', priority: 'medium' }),
      makeTicket({ id: 't4', priority: 'high' }),
      makeTicket({ id: 't5', priority: 'urgent' }),
    ];

    const result = computeAnalytics(tickets, range, new Date('2026-09-30T00:00:00Z'));
    expect(result.priorityDistribution).toEqual({
      low: 1,
      medium: 2,
      high: 1,
      urgent: 1,
    });
  });

  it('exposes zero entries for missing priorities', () => {
    const range = makeRange('2026-09-01', '2026-09-30');
    const tickets = [makeTicket({ priority: 'low' })];

    const result = computeAnalytics(tickets, range, new Date('2026-09-30T00:00:00Z'));
    expect(result.priorityDistribution).toEqual({
      low: 1,
      medium: 0,
      high: 0,
      urgent: 0,
    });
  });
});

describe('computeAnalytics — SLA risk', () => {
  it('counts currently open ticket at response risk', () => {
    const createdAt = new Date('2026-09-01T00:00:00Z');
    const responsePolicyMs = 4 * 60 * 60 * 1000; // high
    const now = new Date(createdAt.getTime() + 0.85 * responsePolicyMs);
    const responseDeadline = new Date(createdAt.getTime() + responsePolicyMs);

    expect(
      getResponseSlaMonitoringStatus(responseDeadline, null, createdAt, now),
    ).toBe('at_risk');

    const range = makeRange('2026-09-01', '2026-09-30');
    const tickets = [
      makeTicket({
        status: 'open',
        priority: 'high',
        createdAt,
        responseSlaDeadline: responseDeadline,
        resolutionSlaDeadline: null,
      }),
    ];

    const result = computeAnalytics(tickets, range, now);
    expect(result.slaRiskCount).toBe(1);
  });

  it('counts currently open ticket at resolution risk', () => {
    const createdAt = new Date('2026-09-01T00:00:00Z');
    const resolutionPolicyMs = 24 * 60 * 60 * 1000;
    const now = new Date(createdAt.getTime() + 0.85 * resolutionPolicyMs);
    const resolutionDeadline = new Date(createdAt.getTime() + resolutionPolicyMs);

    expect(
      getResolutionSlaMonitoringStatus(resolutionDeadline, null, createdAt, now),
    ).toBe('at_risk');

    const range = makeRange('2026-09-01', '2026-09-30');
    const tickets = [
      makeTicket({
        status: 'open',
        priority: 'high',
        createdAt,
        responseSlaDeadline: null,
        resolutionSlaDeadline: resolutionDeadline,
      }),
    ];

    const result = computeAnalytics(tickets, range, now);
    expect(result.slaRiskCount).toBe(1);
  });

  it('counts a ticket at risk in both response and resolution SLA once', () => {
    const createdAt = new Date('2026-09-01T00:00:00Z');
    const policyMs = 4 * 60 * 60 * 1000;
    const now = new Date(createdAt.getTime() + 0.85 * policyMs);
    const deadline = new Date(createdAt.getTime() + policyMs);

    expect(getResponseSlaMonitoringStatus(deadline, null, createdAt, now)).toBe('at_risk');
    expect(getResolutionSlaMonitoringStatus(deadline, null, createdAt, now)).toBe('at_risk');

    const range = makeRange('2026-09-01', '2026-09-30');
    const tickets = [
      makeTicket({
        status: 'open',
        priority: 'high',
        createdAt,
        responseSlaDeadline: deadline,
        resolutionSlaDeadline: deadline,
      }),
    ];

    const result = computeAnalytics(tickets, range, now);
    expect(result.slaRiskCount).toBe(1);
  });

  it('excludes on-track tickets from SLA risk', () => {
    const createdAt = new Date('2026-09-01T00:00:00Z');
    const responsePolicyMs = 4 * 60 * 60 * 1000;
    const now = new Date(createdAt.getTime() + 0.1 * responsePolicyMs);
    const responseDeadline = new Date(createdAt.getTime() + responsePolicyMs);

    expect(
      getResponseSlaMonitoringStatus(responseDeadline, null, createdAt, now),
    ).toBe('on_track');

    const range = makeRange('2026-09-01', '2026-09-30');
    const tickets = [
      makeTicket({
        status: 'open',
        priority: 'high',
        createdAt,
        responseSlaDeadline: responseDeadline,
        resolutionSlaDeadline: null,
      }),
    ];

    const result = computeAnalytics(tickets, range, now);
    expect(result.slaRiskCount).toBe(0);
  });

  it('excludes breached tickets from SLA risk count', () => {
    const createdAt = new Date('2026-09-01T00:00:00Z');
    const responsePolicyMs = 4 * 60 * 60 * 1000;
    // now past the deadline → breached
    const now = new Date(createdAt.getTime() + responsePolicyMs + 1000);
    const responseDeadline = new Date(createdAt.getTime() + responsePolicyMs);

    expect(
      getResponseSlaMonitoringStatus(responseDeadline, null, createdAt, now),
    ).toBe('breached');

    const range = makeRange('2026-09-01', '2026-09-30');
    const tickets = [
      makeTicket({
        status: 'open',
        priority: 'high',
        createdAt,
        responseSlaDeadline: responseDeadline,
        resolutionSlaDeadline: null,
      }),
    ];

    const result = computeAnalytics(tickets, range, now);
    expect(result.slaRiskCount).toBe(0);
  });

  it('only counts currently open tickets for SLA risk (not actionable)', () => {
    const createdAt = new Date('2026-09-01T00:00:00Z');
    const responsePolicyMs = 4 * 60 * 60 * 1000;
    const now = new Date(createdAt.getTime() + 0.85 * responsePolicyMs);
    const responseDeadline = new Date(createdAt.getTime() + responsePolicyMs);

    const range = makeRange('2026-09-01', '2026-09-30');
    const tickets = [
      makeTicket({
        id: 'open-risk',
        status: 'open',
        priority: 'high',
        createdAt,
        responseSlaDeadline: responseDeadline,
      }),
      makeTicket({
        id: 'inprogress-risk',
        status: 'in_progress',
        priority: 'high',
        createdAt,
        responseSlaDeadline: responseDeadline,
      }),
      makeTicket({
        id: 'waiting-risk',
        status: 'waiting_customer',
        priority: 'high',
        createdAt,
        responseSlaDeadline: responseDeadline,
      }),
    ];

    const result = computeAnalytics(tickets, range, now);
    // Only the open ticket counts for SLA risk per spec.
    expect(result.slaRiskCount).toBe(1);
  });
});

describe('computeAnalytics — SLA breach', () => {
  it('counts response breach', () => {
    const createdAt = new Date('2026-09-01T00:00:00Z');
    const responsePolicyMs = 4 * 60 * 60 * 1000;
    const now = new Date(createdAt.getTime() + responsePolicyMs + 1000);
    const responseDeadline = new Date(createdAt.getTime() + responsePolicyMs);

    expect(
      getResponseSlaMonitoringStatus(responseDeadline, null, createdAt, now),
    ).toBe('breached');

    const range = makeRange('2026-09-01', '2026-09-30');
    const tickets = [
      makeTicket({
        createdAt,
        responseSlaDeadline: responseDeadline,
        resolutionSlaDeadline: null,
      }),
    ];

    const result = computeAnalytics(tickets, range, now);
    expect(result.slaBreachCount).toBe(1);
  });

  it('counts resolution breach', () => {
    const createdAt = new Date('2026-09-01T00:00:00Z');
    const resolutionPolicyMs = 24 * 60 * 60 * 1000;
    const now = new Date(createdAt.getTime() + resolutionPolicyMs + 1000);
    const resolutionDeadline = new Date(createdAt.getTime() + resolutionPolicyMs);

    expect(
      getResolutionSlaMonitoringStatus(resolutionDeadline, null, createdAt, now),
    ).toBe('breached');

    const range = makeRange('2026-09-01', '2026-09-30');
    const tickets = [
      makeTicket({
        createdAt,
        responseSlaDeadline: null,
        resolutionSlaDeadline: resolutionDeadline,
      }),
    ];

    const result = computeAnalytics(tickets, range, now);
    expect(result.slaBreachCount).toBe(1);
  });

  it('counts a ticket breaching both response and resolution SLA once', () => {
    const createdAt = new Date('2026-09-01T00:00:00Z');
    const policyMs = 4 * 60 * 60 * 1000;
    const now = new Date(createdAt.getTime() + policyMs + 1000);
    const deadline = new Date(createdAt.getTime() + policyMs);

    expect(getResponseSlaMonitoringStatus(deadline, null, createdAt, now)).toBe('breached');
    expect(getResolutionSlaMonitoringStatus(deadline, null, createdAt, now)).toBe('breached');

    const range = makeRange('2026-09-01', '2026-09-30');
    const tickets = [
      makeTicket({
        createdAt,
        responseSlaDeadline: deadline,
        resolutionSlaDeadline: deadline,
      }),
    ];

    const result = computeAnalytics(tickets, range, now);
    expect(result.slaBreachCount).toBe(1);
  });

  it('uses current snapshot semantics for breach (not range-bound)', () => {
    // A ticket created and breached long ago still counts in the snapshot.
    const createdAt = new Date('2025-01-01T00:00:00Z');
    const responsePolicyMs = 4 * 60 * 60 * 1000;
    const responseDeadline = new Date(createdAt.getTime() + responsePolicyMs);
    const now = new Date('2026-09-17T00:00:00Z');

    const range = makeRange('2026-09-01', '2026-09-30');
    const tickets = [
      makeTicket({
        createdAt,
        responseSlaDeadline: responseDeadline,
        resolutionSlaDeadline: null,
      }),
    ];

    const result = computeAnalytics(tickets, range, now);
    expect(result.slaBreachCount).toBe(1);
  });
});

describe('computeAnalytics — daily series', () => {
  it('fills days without data with zero', () => {
    const range = makeRange('2026-09-01', '2026-09-05');
    const tickets = [
      makeTicket({ id: 't1', createdAt: new Date('2026-09-02T10:00:00Z') }),
    ];

    const result = computeAnalytics(tickets, range, new Date('2026-09-05T00:00:00Z'));
    expect(result.daily).toHaveLength(5);
    expect(result.daily[0]).toEqual({ date: '2026-09-01', ticketVolume: 0, resolutionCount: 0 });
    expect(result.daily[1]).toEqual({ date: '2026-09-02', ticketVolume: 1, resolutionCount: 0 });
    expect(result.daily[4]).toEqual({ date: '2026-09-05', ticketVolume: 0, resolutionCount: 0 });
  });

  it('buckets resolved tickets into correct UTC days', () => {
    const range = makeRange('2026-09-01', '2026-09-03');
    const tickets = [
      makeTicket({
        id: 't1',
        createdAt: new Date('2026-09-01T00:00:00Z'),
        resolvedAt: new Date('2026-09-02T12:00:00Z'),
      }),
      makeTicket({
        id: 't2',
        createdAt: new Date('2026-09-01T00:00:00Z'),
        resolvedAt: new Date('2026-09-02T20:00:00Z'),
      }),
    ];

    const result = computeAnalytics(tickets, range, new Date('2026-09-03T00:00:00Z'));
    expect(result.daily[0]).toEqual({ date: '2026-09-01', ticketVolume: 2, resolutionCount: 0 });
    expect(result.daily[1]).toEqual({ date: '2026-09-02', ticketVolume: 0, resolutionCount: 2 });
  });
});

describe('computeAnalytics — UTC boundary around midnight', () => {
  it('treats a ticket at 23:59:59 UTC as belonging to that day', () => {
    const range = makeRange('2026-09-01', '2026-09-02');
    const tickets = [
      makeTicket({ createdAt: new Date('2026-09-01T23:59:59.999Z') }),
    ];

    const result = computeAnalytics(tickets, range, new Date('2026-09-02T00:00:00Z'));
    expect(result.ticketVolume).toBe(1);
    expect(result.daily[0]).toEqual({ date: '2026-09-01', ticketVolume: 1, resolutionCount: 0 });
  });

  it('does not use local timezone for boundaries', () => {
    // The range start is UTC midnight; a ticket at the same instant counts.
    const range = makeRange('2026-09-10', '2026-09-10');
    const tickets = [
      makeTicket({ createdAt: new Date('2026-09-10T00:00:00.000Z') }),
    ];

    const result = computeAnalytics(tickets, range, new Date('2026-09-10T12:00:00Z'));
    expect(result.ticketVolume).toBe(1);
  });
});
