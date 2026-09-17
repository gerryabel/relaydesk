import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { prisma } from '@/lib/db/prisma';
import { getWorkload } from '@/lib/workload/server';
import { getCurrentMembership, UnauthorizedError, ForbiddenError } from '@/lib/workspace/server';
import { getResponseSlaMonitoringStatus, getResolutionSlaMonitoringStatus } from '@/lib/tickets/sla';

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
    membership: {
      findMany: vi.fn(),
    },
    ticket: {
      findMany: vi.fn(),
    },
  },
}));

const mockedGetCurrentMembership = vi.mocked(getCurrentMembership);
const mockedMembershipFindMany = vi.mocked(prisma.membership.findMany);
const mockedTicketFindMany = vi.mocked(prisma.ticket.findMany);

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

function makeMember(overrides: Record<string, unknown> = {}) {
  return {
    userId: 'user-123',
    role: 'owner' as const,
    createdAt: new Date('2025-01-01T00:00:00Z'),
    user: {
      id: 'user-123',
      name: 'Alice',
      email: 'alice@example.com',
      image: null,
    },
    ...overrides,
  };
}

function makeTicket(overrides: Record<string, unknown> = {}) {
  return {
    assignedToId: 'user-123',
    status: 'open',
    priority: 'medium',
    createdAt: new Date('2025-01-01T00:00:00Z'),
    responseSlaDeadline: null,
    resolutionSlaDeadline: null,
    firstResponseAt: null,
    resolvedAt: null,
    ...overrides,
  };
}

beforeEach(() => {
  vi.restoreAllMocks();
  mockedGetCurrentMembership.mockReset();
  mockedMembershipFindMany.mockReset();
  mockedTicketFindMany.mockReset();
});

afterEach(() => {
  vi.useRealTimers();
});

describe('getWorkload', () => {
  it('throws UnauthorizedError when no session', async () => {
    mockedGetCurrentMembership.mockRejectedValueOnce(
      new UnauthorizedError('No authenticated session'),
    );

    await expect(getWorkload()).rejects.toThrow(UnauthorizedError);
  });

  it('throws ForbiddenError when no workspace membership', async () => {
    mockedGetCurrentMembership.mockRejectedValueOnce(
      new ForbiddenError('No workspace membership found'),
    );

    await expect(getWorkload()).rejects.toThrow(ForbiddenError);
  });

  it('queries members and tickets scoped to current workspace', async () => {
    mockedGetCurrentMembership.mockResolvedValueOnce(fakeMembership as never);
    mockedMembershipFindMany.mockResolvedValueOnce([makeMember()] as never);
    mockedTicketFindMany.mockResolvedValueOnce([] as never);

    await getWorkload();

    expect(mockedMembershipFindMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { workspaceId: 'workspace-123' } }),
    );
    expect(mockedTicketFindMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { workspaceId: 'workspace-123', assignedToId: { not: null } },
      }),
    );
  });

  it('represents a member with zero assigned tickets', async () => {
    mockedGetCurrentMembership.mockResolvedValueOnce(fakeMembership as never);
    mockedMembershipFindMany.mockResolvedValueOnce([makeMember()] as never);
    mockedTicketFindMany.mockResolvedValueOnce([] as never);

    const result = await getWorkload();

    expect(result.members).toHaveLength(1);
    expect(result.members[0]).toMatchObject({
      userId: 'user-123',
      name: 'Alice',
      totalAssigned: 0,
      open: 0,
      inProgress: 0,
      waitingCustomer: 0,
      resolved: 0,
      closed: 0,
      active: 0,
      highPriority: 0,
      urgent: 0,
      slaAtRisk: 0,
    });
  });

  it('counts assigned tickets across all statuses', async () => {
    mockedGetCurrentMembership.mockResolvedValueOnce(fakeMembership as never);
    mockedMembershipFindMany.mockResolvedValueOnce([makeMember()] as never);
    mockedTicketFindMany.mockResolvedValueOnce([
      makeTicket({ status: 'open' }),
      makeTicket({ status: 'in_progress' }),
      makeTicket({ status: 'waiting_customer' }),
      makeTicket({ status: 'resolved' }),
      makeTicket({ status: 'closed' }),
    ] as never);

    const result = await getWorkload();
    const workload = result.members[0];

    expect(workload.totalAssigned).toBe(5);
    expect(workload.open).toBe(1);
    expect(workload.inProgress).toBe(1);
    expect(workload.waitingCustomer).toBe(1);
    expect(workload.resolved).toBe(1);
    expect(workload.closed).toBe(1);
  });

  it('computes active = open + in_progress + waiting_customer', async () => {
    mockedGetCurrentMembership.mockResolvedValueOnce(fakeMembership as never);
    mockedMembershipFindMany.mockResolvedValueOnce([makeMember()] as never);
    mockedTicketFindMany.mockResolvedValueOnce([
      makeTicket({ status: 'open' }),
      makeTicket({ status: 'in_progress' }),
      makeTicket({ status: 'waiting_customer' }),
      makeTicket({ status: 'resolved' }),
      makeTicket({ status: 'closed' }),
    ] as never);

    const result = await getWorkload();
    const workload = result.members[0];

    expect(workload.active).toBe(3);
    expect(workload.active).toBe(workload.open + workload.inProgress + workload.waitingCustomer);
  });

  it('counts high priority only for active high-priority tickets', async () => {
    mockedGetCurrentMembership.mockResolvedValueOnce(fakeMembership as never);
    mockedMembershipFindMany.mockResolvedValueOnce([makeMember()] as never);
    mockedTicketFindMany.mockResolvedValueOnce([
      makeTicket({ status: 'open', priority: 'high' }),
      makeTicket({ status: 'resolved', priority: 'high' }),
      makeTicket({ status: 'closed', priority: 'high' }),
    ] as never);

    const result = await getWorkload();
    const workload = result.members[0];

    expect(workload.highPriority).toBe(1);
    expect(workload.urgent).toBe(0);
  });

  it('counts urgent only for active urgent tickets', async () => {
    mockedGetCurrentMembership.mockResolvedValueOnce(fakeMembership as never);
    mockedMembershipFindMany.mockResolvedValueOnce([makeMember()] as never);
    mockedTicketFindMany.mockResolvedValueOnce([
      makeTicket({ status: 'open', priority: 'urgent' }),
      makeTicket({ status: 'in_progress', priority: 'urgent' }),
      makeTicket({ status: 'closed', priority: 'urgent' }),
    ] as never);

    const result = await getWorkload();
    const workload = result.members[0];

    expect(workload.urgent).toBe(2);
    expect(workload.highPriority).toBe(0);
  });

  it('does not include resolved and closed tickets in active workload', async () => {
    mockedGetCurrentMembership.mockResolvedValueOnce(fakeMembership as never);
    mockedMembershipFindMany.mockResolvedValueOnce([makeMember()] as never);
    mockedTicketFindMany.mockResolvedValueOnce([
      makeTicket({ status: 'resolved', priority: 'urgent' }),
      makeTicket({ status: 'closed', priority: 'high' }),
    ] as never);

    const result = await getWorkload();
    const workload = result.members[0];

    expect(workload.active).toBe(0);
    expect(workload.highPriority).toBe(0);
    expect(workload.urgent).toBe(0);
    expect(workload.resolved).toBe(1);
    expect(workload.closed).toBe(1);
  });

  it('counts SLA-at-risk using existing response SLA semantics', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2025-01-01T12:00:00Z'));

    // urgent: 1h response deadline. createdAt at 00:00, now at 12:00 → way past deadline,
    // but we want at_risk (80% elapsed), not breached. Use high priority (4h response):
    // createdAt 00:00, deadline 04:00, now 03:30 would be 87.5%. Simpler: compute explicitly.
    const createdAt = new Date('2025-01-01T00:00:00Z');
    const policyMs = 4 * 60 * 60 * 1000; // high priority response
    // elapsedRatio >= 0.8 → now >= createdAt + 0.8 * policyMs = 00:00 + 3.2h = 03:12
    const now = new Date(createdAt.getTime() + 0.85 * policyMs);
    vi.setSystemTime(now);

    const responseDeadline = new Date(createdAt.getTime() + policyMs);

    mockedGetCurrentMembership.mockResolvedValueOnce(fakeMembership as never);
    mockedMembershipFindMany.mockResolvedValueOnce([makeMember()] as never);
    mockedTicketFindMany.mockResolvedValueOnce([
      makeTicket({
        status: 'open',
        priority: 'high',
        createdAt,
        responseSlaDeadline: responseDeadline,
        resolutionSlaDeadline: null,
      }),
    ] as never);

    const result = await getWorkload();
    const workload = result.members[0];

    // Verify the helper agrees the response SLA is at_risk
    expect(
      getResponseSlaMonitoringStatus(responseDeadline, null, createdAt, now),
    ).toBe('at_risk');

    expect(workload.slaAtRisk).toBe(1);
  });

  it('counts SLA-at-risk using existing resolution SLA semantics', async () => {
    const createdAt = new Date('2025-01-01T00:00:00Z');
    const policyMs = 24 * 60 * 60 * 1000; // high priority resolution
    const now = new Date(createdAt.getTime() + 0.9 * policyMs);

    vi.useFakeTimers();
    vi.setSystemTime(now);

    const resolutionDeadline = new Date(createdAt.getTime() + policyMs);

    mockedGetCurrentMembership.mockResolvedValueOnce(fakeMembership as never);
    mockedMembershipFindMany.mockResolvedValueOnce([makeMember()] as never);
    mockedTicketFindMany.mockResolvedValueOnce([
      makeTicket({
        status: 'open',
        priority: 'high',
        createdAt,
        responseSlaDeadline: null,
        resolutionSlaDeadline: resolutionDeadline,
      }),
    ] as never);

    const result = await getWorkload();
    const workload = result.members[0];

    expect(
      getResolutionSlaMonitoringStatus(resolutionDeadline, null, createdAt, now),
    ).toBe('at_risk');

    expect(workload.slaAtRisk).toBe(1);
  });

  it('counts a ticket at risk in both response and resolution SLA only once', async () => {
    const createdAt = new Date('2025-01-01T00:00:00Z');
    // Pick now such that BOTH elapsed ratios are in the at_risk band [0.8, 1.0):
    //   response deadline at 4h → need now <= 4h and >= 3.2h
    //   resolution deadline at 24h → need now <= 24h and >= 19.2h
    // 0.9 * 4h = 3.6h → response at_risk; but 3.6h / 24h = 0.15 → on_track.
    // Use 0.9 * 24h = 21.6h → resolution at_risk; 21.6h / 4h > 1 → response breached.
    // To have both at_risk, now must be in [19.2h, 4h) — impossible with same now.
    // Instead pick now so response is at_risk (0.85 * 4h = 3.4h) and resolution
    // is also at_risk: need 3.4h / resolutionPolicy >= 0.8 → resolutionPolicy <= 4.25h.
    // So use equal short policies.
    const policyMs = 4 * 60 * 60 * 1000;
    const now = new Date(createdAt.getTime() + 0.85 * policyMs);

    vi.useFakeTimers();
    vi.setSystemTime(now);

    const responseDeadline = new Date(createdAt.getTime() + policyMs);
    const resolutionDeadline = new Date(createdAt.getTime() + policyMs);

    expect(
      getResponseSlaMonitoringStatus(responseDeadline, null, createdAt, now),
    ).toBe('at_risk');
    expect(
      getResolutionSlaMonitoringStatus(resolutionDeadline, null, createdAt, now),
    ).toBe('at_risk');

    mockedGetCurrentMembership.mockResolvedValueOnce(fakeMembership as never);
    mockedMembershipFindMany.mockResolvedValueOnce([makeMember()] as never);
    mockedTicketFindMany.mockResolvedValueOnce([
      makeTicket({
        status: 'open',
        priority: 'high',
        createdAt,
        responseSlaDeadline: responseDeadline,
        resolutionSlaDeadline: resolutionDeadline,
      }),
    ] as never);

    const result = await getWorkload();
    const workload = result.members[0];

    expect(workload.slaAtRisk).toBe(1);
  });

  it('excludes non-risk ticket from SLA-at-risk', async () => {
    const createdAt = new Date('2025-01-01T00:00:00Z');
    const responsePolicyMs = 4 * 60 * 60 * 1000;
    // now at 10% elapsed → well below 80% at_risk threshold
    const now = new Date(createdAt.getTime() + 0.1 * responsePolicyMs);

    vi.useFakeTimers();
    vi.setSystemTime(now);

    const responseDeadline = new Date(createdAt.getTime() + responsePolicyMs);

    expect(
      getResponseSlaMonitoringStatus(responseDeadline, null, createdAt, now),
    ).toBe('on_track');

    mockedGetCurrentMembership.mockResolvedValueOnce(fakeMembership as never);
    mockedMembershipFindMany.mockResolvedValueOnce([makeMember()] as never);
    mockedTicketFindMany.mockResolvedValueOnce([
      makeTicket({
        status: 'open',
        priority: 'high',
        createdAt,
        responseSlaDeadline: responseDeadline,
        resolutionSlaDeadline: null,
      }),
    ] as never);

    const result = await getWorkload();
    const workload = result.members[0];

    expect(workload.slaAtRisk).toBe(0);
  });

  it('does not include unassigned tickets in any agent counts', async () => {
    mockedGetCurrentMembership.mockResolvedValueOnce(fakeMembership as never);
    mockedMembershipFindMany.mockResolvedValueOnce([makeMember()] as never);
    mockedTicketFindMany.mockResolvedValueOnce([
      makeTicket({ assignedToId: null }),
    ] as never);

    const result = await getWorkload();
    const workload = result.members[0];

    expect(workload.totalAssigned).toBe(0);
  });

  it('does not include tickets from another workspace (workspace isolation)', async () => {
    // Simulate getCurrentMembership returning workspace-123, but the ticket
    // query scoped to workspace-123 returns no rows (the other workspace's
    // ticket never enters this workspace's query).
    mockedGetCurrentMembership.mockResolvedValueOnce(fakeMembership as never);
    mockedMembershipFindMany.mockResolvedValueOnce([makeMember()] as never);
    // The service queries tickets where workspaceId = workspace-123 and
    // assignedToId != null; a ticket in workspace-OTHER is never returned.
    mockedTicketFindMany.mockResolvedValueOnce([] as never);

    const result = await getWorkload();
    const workload = result.members[0];

    expect(workload.totalAssigned).toBe(0);

    // Confirm the query was scoped to the current workspace only.
    expect(mockedTicketFindMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { workspaceId: 'workspace-123', assignedToId: { not: null } },
      }),
    );
  });

  it('does not trust a client-supplied workspace id (workspace resolved server-side)', async () => {
    mockedGetCurrentMembership.mockResolvedValueOnce(fakeMembership as never);
    mockedMembershipFindMany.mockResolvedValueOnce([makeMember()] as never);
    mockedTicketFindMany.mockResolvedValueOnce([] as never);

    await getWorkload();

    // getCurrentMembership provides the workspace; the service never accepts
    // a workspace id from the caller.
    expect(mockedTicketFindMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { workspaceId: 'workspace-123', assignedToId: { not: null } },
      }),
    );
  });

  it('represents all workspace members including zero-work agents', async () => {
    mockedGetCurrentMembership.mockResolvedValueOnce(fakeMembership as never);
    mockedMembershipFindMany.mockResolvedValueOnce([
      makeMember({
        userId: 'user-123',
        role: 'owner',
        user: { id: 'user-123', name: 'Alice', email: 'alice@example.com', image: null },
      }),
      makeMember({
        userId: 'user-456',
        role: 'member',
        user: { id: 'user-456', name: 'Bob', email: 'bob@example.com', image: null },
      }),
      makeMember({
        userId: 'user-789',
        role: 'member',
        user: { id: 'user-789', name: 'Carol', email: 'carol@example.com', image: null },
      }),
    ] as never);
    mockedTicketFindMany.mockResolvedValueOnce([
      makeTicket({ assignedToId: 'user-123' }),
    ] as never);

    const result = await getWorkload();

    expect(result.members).toHaveLength(3);
    const alice = result.members.find((m) => m.userId === 'user-123');
    const bob = result.members.find((m) => m.userId === 'user-456');
    const carol = result.members.find((m) => m.userId === 'user-789');

    expect(alice?.totalAssigned).toBe(1);
    expect(bob?.totalAssigned).toBe(0);
    expect(carol?.totalAssigned).toBe(0);
  });

  it('aggregates workspace-level summary totals', async () => {
    mockedGetCurrentMembership.mockResolvedValueOnce(fakeMembership as never);
    mockedMembershipFindMany.mockResolvedValueOnce([
      makeMember({
        userId: 'user-123',
        user: { id: 'user-123', name: 'Alice', email: 'alice@example.com', image: null },
      }),
      makeMember({
        userId: 'user-456',
        role: 'member',
        user: { id: 'user-456', name: 'Bob', email: 'bob@example.com', image: null },
      }),
    ] as never);
    mockedTicketFindMany.mockResolvedValueOnce([
      makeTicket({ assignedToId: 'user-123', status: 'open' }),
      makeTicket({ assignedToId: 'user-123', status: 'open' }),
      makeTicket({ assignedToId: 'user-456', status: 'in_progress' }),
    ] as never);

    const result = await getWorkload();

    expect(result.summary).toMatchObject({
      totalAssigned: 3,
      active: 3,
      memberCount: 2,
    });
  });

  it('never trusts a client-supplied workspace id from getCurrentMembership', async () => {
    // getCurrentMembership is the single source of workspace truth.
    // Verify the service uses only membership.workspaceId.
    mockedGetCurrentMembership.mockResolvedValueOnce(fakeMembership as never);
    mockedMembershipFindMany.mockResolvedValueOnce([makeMember()] as never);
    mockedTicketFindMany.mockResolvedValueOnce([] as never);

    await getWorkload();

    expect(mockedMembershipFindMany).toHaveBeenCalledTimes(1);
    expect(mockedTicketFindMany).toHaveBeenCalledTimes(1);
    expect(mockedTicketFindMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ workspaceId: 'workspace-123' }),
      }),
    );
  });
});
