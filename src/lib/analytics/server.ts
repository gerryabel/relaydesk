import { prisma } from '@/lib/db/prisma';
import { getCurrentMembership } from '@/lib/workspace/server';
import {
  getResponseSlaMonitoringStatus,
  getResolutionSlaMonitoringStatus,
} from '@/lib/tickets/sla';
import type { TicketStatus, TicketPriority } from '@/generated/prisma';
import { z } from 'zod';
import { ticketStatusSchema, ticketPrioritySchema } from '@/lib/tickets/schema';
import { dateRangeQuerySchema, formatDuration } from './schema';
import type { DateRange } from './types';
import type {
  AnalyticsResult,
  AssignmentAgent,
  AverageResolutionTime,
  DailyPoint,
  PriorityDistribution,
  StatusDistribution,
} from './types';

type Status = z.infer<typeof ticketStatusSchema>;
type Priority = z.infer<typeof ticketPrioritySchema>;

const STATUSES: Status[] = ['open', 'in_progress', 'waiting_customer', 'resolved', 'closed'];
const PRIORITIES: Priority[] = ['low', 'medium', 'high', 'urgent'];

function emptyStatusDistribution(): StatusDistribution {
  return { open: 0, in_progress: 0, waiting_customer: 0, resolved: 0, closed: 0 };
}

function emptyPriorityDistribution(): PriorityDistribution {
  return { low: 0, medium: 0, high: 0, urgent: 0 };
}

export type AnalyticsTicketRow = {
  id: string;
  status: TicketStatus;
  priority: TicketPriority;
  createdAt: Date;
  resolvedAt: Date | null;
  assignedToId: string | null;
  responseSlaDeadline: Date | null;
  resolutionSlaDeadline: Date | null;
  firstResponseAt: Date | null;
};

type MemberUserRow = {
  userId: string;
  role: 'owner' | 'member';
  user: {
    id: string;
    name: string;
    email: string;
    image: string | null;
  };
};

/**
 * Analytics domain/query service (see docs/phase-7/spec.md §5.5 and
 * docs/phase-7/task-5.md).
 *
 * Implements the bounded metric set:
 *
 * Range metrics (bound to [start, end) UTC):
 *   - ticketVolume:          tickets with createdAt in [start, end)
 *   - resolutionCount:       tickets with resolvedAt in [start, end)
 *   - averageResolutionTime: mean createdAt→resolvedAt for those; unresolved excluded
 *   - daily series:          created/resolved counts per UTC day, zero-filled
 *
 * Current snapshot metrics (at query time, range-independent):
 *   - statusDistribution:    current status counts (all tickets)
 *   - priorityDistribution:  current priority counts (all tickets)
 *   - slaRiskCount:          currently open tickets with response OR resolution
 *                            SLA == at_risk (counted once)
 *   - slaBreachCount:        tickets with response OR resolution SLA == breached
 *                            (counted once)
 *
 * Owner-only agent-level metric:
 *   - assignmentDistribution: currently assigned tickets grouped by assignee
 *
 * Workspace isolation: the workspace is resolved server-side from the session
 * via getCurrentMembership(); no client-supplied workspace id is trusted.
 *
 * Query strategy: a small number of workspace-scoped queries, in-memory
 * aggregation. No N+1.
 */
export async function getAnalytics(rawParams: {
  from?: string;
  to?: string;
}): Promise<AnalyticsResult> {
  const membership = await getCurrentMembership();
  const workspaceId = membership.workspaceId;

  const range = dateRangeQuerySchema.parse({ from: rawParams.from, to: rawParams.to });

  const now = new Date();

  // Single workspace-scoped query returns all tickets with the columns needed
  // for both range and snapshot metrics.
  const tickets = (await prisma.ticket.findMany({
    where: { workspaceId },
    select: {
      id: true,
      status: true,
      priority: true,
      createdAt: true,
      resolvedAt: true,
      assignedToId: true,
      responseSlaDeadline: true,
      resolutionSlaDeadline: true,
      firstResponseAt: true,
    },
  })) as AnalyticsTicketRow[];

  const result = computeAnalytics(tickets, range, now);

  // Owner-only agent-level assignment distribution.
  let assignmentDistribution: AssignmentAgent[] | undefined;
  if (membership.role === 'owner') {
    assignmentDistribution = await getAssignmentDistribution(workspaceId);
  }

  return {
    ...result,
    role: membership.role,
    ...(assignmentDistribution ? { owner: { assignmentDistribution } } : {}),
  };
}

/**
 * Computes all metrics from the ticket rows. Extracted for unit-testability
 * so tests can assert metric logic without Prisma mocking.
 */
export function computeAnalytics(
  tickets: AnalyticsTicketRow[],
  range: DateRange,
  now: Date,
): Omit<AnalyticsResult, 'role' | 'owner'> {
  const statusDistribution = emptyStatusDistribution();
  const priorityDistribution = emptyPriorityDistribution();

  let slaRiskCount = 0;
  let slaBreachCount = 0;

  let ticketVolume = 0;
  let resolutionCount = 0;
  let resolutionDurationSum = 0;
  let resolutionDurationCount = 0;

  const createdByDay = new Map<string, number>();
  const resolvedByDay = new Map<string, number>();

  const startMs = range.start.getTime();
  const endMs = range.end.getTime();
  const dayMs = 24 * 60 * 60 * 1000;

  for (const ticket of tickets) {
    // Current snapshot: status and priority distributions (all tickets).
    statusDistribution[ticket.status as Status] += 1;
    priorityDistribution[ticket.priority as Priority] += 1;

    // SLA risk uses current persisted state + now. Spec: currently open tickets
    // where response OR resolution SLA == at_risk (counted once).
    if (ticket.status === 'open') {
      const responseStatus = getResponseSlaMonitoringStatus(
        ticket.responseSlaDeadline,
        ticket.firstResponseAt,
        ticket.createdAt,
        now,
      );
      const resolutionStatus = getResolutionSlaMonitoringStatus(
        ticket.resolutionSlaDeadline,
        ticket.resolvedAt,
        ticket.createdAt,
        now,
      );
      if (responseStatus === 'at_risk' || resolutionStatus === 'at_risk') {
        slaRiskCount += 1;
      }
    }

    // SLA breach: a ticket counts once if either SLA is breached.
    {
      const responseStatus = getResponseSlaMonitoringStatus(
        ticket.responseSlaDeadline,
        ticket.firstResponseAt,
        ticket.createdAt,
        now,
      );
      const resolutionStatus = getResolutionSlaMonitoringStatus(
        ticket.resolutionSlaDeadline,
        ticket.resolvedAt,
        ticket.createdAt,
        now,
      );
      if (responseStatus === 'breached' || resolutionStatus === 'breached') {
        slaBreachCount += 1;
      }
    }

    // Range metric: ticket volume (createdAt in [start, end)).
    const createdMs = ticket.createdAt.getTime();
    if (createdMs >= startMs && createdMs < endMs) {
      ticketVolume += 1;
      const dayKey = formatUtcDay(createdMs, dayMs);
      createdByDay.set(dayKey, (createdByDay.get(dayKey) ?? 0) + 1);
    }

    // Range metric: resolution count + average resolution time
    // (resolvedAt in [start, end); unresolved excluded).
    if (ticket.resolvedAt) {
      const resolvedMs = ticket.resolvedAt.getTime();
      if (resolvedMs >= startMs && resolvedMs < endMs) {
        resolutionCount += 1;
        resolutionDurationSum += resolvedMs - createdMs;
        resolutionDurationCount += 1;
        const dayKey = formatUtcDay(resolvedMs, dayMs);
        resolvedByDay.set(dayKey, (resolvedByDay.get(dayKey) ?? 0) + 1);
      }
    }
  }

  const daily = buildDaily(range, createdByDay, resolvedByDay);

  const averageResolutionTime: AverageResolutionTime =
    resolutionDurationCount > 0
      ? {
          count: resolutionDurationCount,
          averageMs: Math.round(resolutionDurationSum / resolutionDurationCount),
          human: formatDuration(Math.round(resolutionDurationSum / resolutionDurationCount)),
        }
      : { count: 0, averageMs: null, human: null };

  return {
    range,
    ticketVolume,
    resolutionCount,
    averageResolutionTime,
    daily,
    statusDistribution,
    priorityDistribution,
    slaRiskCount,
    slaBreachCount,
  };
}

function formatUtcDay(ms: number, dayMs: number): string {
  const daysSinceEpoch = Math.floor(ms / dayMs);
  const date = new Date(daysSinceEpoch * dayMs);
  const year = date.getUTCFullYear();
  const month = String(date.getUTCMonth() + 1).padStart(2, '0');
  const day = String(date.getUTCDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

function buildDaily(
  range: DateRange,
  createdByDay: Map<string, number>,
  resolvedByDay: Map<string, number>,
): DailyPoint[] {
  const points: DailyPoint[] = [];
  for (let i = 0; i < range.totalDays; i += 1) {
    const day = new Date(range.start.getTime() + i * 24 * 60 * 60 * 1000);
    const key = formatDateOnlyUtc(day);
    points.push({
      date: key,
      ticketVolume: createdByDay.get(key) ?? 0,
      resolutionCount: resolvedByDay.get(key) ?? 0,
    });
  }
  return points;
}

function formatDateOnlyUtc(date: Date): string {
  const year = date.getUTCFullYear();
  const month = String(date.getUTCMonth() + 1).padStart(2, '0');
  const day = String(date.getUTCDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

/**
 * OWNER-ONLY: currently assigned tickets grouped by assignee across the
 * workspace. Includes workspace members with zero assignments so the
 * distribution is complete. Scoped to the workspace.
 */
async function getAssignmentDistribution(workspaceId: string): Promise<AssignmentAgent[]> {
  const members = await prisma.membership.findMany({
    where: { workspaceId },
    include: {
      user: { select: { id: true, name: true, email: true, image: true } },
    },
    orderBy: { user: { name: 'asc' } },
  });

  const assignedCounts = await prisma.ticket.groupBy({
    by: ['assignedToId'],
    where: { workspaceId, assignedToId: { not: null } },
    _count: { _all: true },
  });

  const countByUserId = new Map<string, number>();
  for (const row of assignedCounts) {
    if (row.assignedToId) {
      countByUserId.set(row.assignedToId, row._count._all);
    }
  }

  return (members as MemberUserRow[]).map((m) => ({
    userId: m.userId,
    name: m.user.name,
    email: m.user.email,
    image: m.user.image,
    assignedCount: countByUserId.get(m.userId) ?? 0,
  }));
}

export { STATUSES, PRIORITIES };
