import type { TicketStatus, TicketPriority } from '@/generated/prisma';

/**
 * Analytics domain types (see docs/phase-7/spec.md §5.5 and docs/phase-7/task-5.md).
 *
 * Two classes of metric exist:
 *
 *  - Range metrics: bound to the selected [start, end) UTC range.
 *      ticketVolume, resolutionCount, averageResolutionTime, daily series.
 *
 *  - Current snapshot metrics: reflect persisted state at query time,
 *      independent of the selected range.
 *      statusDistribution, priorityDistribution, assignmentDistribution,
 *      slaRiskCount, slaBreachCount.
 *
 * The distinction is intentional and surfaced in the UI.
 */

export type DateRange = {
  /** YYYY-MM-DD inclusive, user-facing. */
  from: string;
  /** YYYY-MM-DD inclusive, user-facing. */
  to: string;
  /** UTC midnight of `from`, inclusive. */
  start: Date;
  /** UTC midnight immediately after `to`, exclusive. */
  end: Date;
  /** Number of UTC calendar days in the range (from..to inclusive). */
  totalDays: number;
};

export type StatusDistribution = Record<TicketStatus, number>;
export type PriorityDistribution = Record<TicketPriority, number>;

export type DailyPoint = {
  /** YYYY-MM-DD UTC. */
  date: string;
  ticketVolume: number;
  resolutionCount: number;
};

export type AssignmentAgent = {
  userId: string;
  name: string;
  email: string;
  image: string | null;
  assignedCount: number;
};

export type AverageResolutionTime = {
  /** Number of qualifying resolved tickets (those with resolvedAt in range). */
  count: number;
  /** Arithmetic mean duration in milliseconds, or null when count === 0. */
  averageMs: number | null;
  /** Human-readable duration, e.g. "2d 5h 30m", or null when count === 0. */
  human: string | null;
};

export type AnalyticsRangeMetrics = {
  range: DateRange;
  ticketVolume: number;
  resolutionCount: number;
  averageResolutionTime: AverageResolutionTime;
  daily: DailyPoint[];
};

export type AnalyticsSnapshotMetrics = {
  statusDistribution: StatusDistribution;
  priorityDistribution: PriorityDistribution;
  slaRiskCount: number;
  slaBreachCount: number;
};

/**
 * Owner-only agent-level part of the analytics response. When the caller is
 * not a workspace owner, this is undefined and must never be serialized to
 * a non-owner client.
 */
export type AnalyticsOwnerMetrics = {
  assignmentDistribution: AssignmentAgent[];
};

export type AnalyticsResult = AnalyticsRangeMetrics &
  AnalyticsSnapshotMetrics & {
    /** Authenticated membership role for the current user. */
    role: 'owner' | 'member';
    /** Present only when the current user is the workspace owner. */
    owner?: AnalyticsOwnerMetrics;
  };
