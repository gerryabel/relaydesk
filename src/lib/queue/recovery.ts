/**
 * Stale outbox recovery helpers for the async infrastructure.
 *
 * Provides typed queries that classify OutboxEvent rows into recovery
 * categories. These are read-only diagnostics — they never mutate state.
 *
 * Startup recovery (see runStartupRecovery) logs stranded events but does
 * NOT re-dispatch them, avoiding thundering herd. Operators recover
 * manually using the documented procedure in docs/phase-6/operations.md.
 *
 * Category semantics (based on current outbox lease model):
 *
 *   processedAt = null        -> never claimed, or claim released by retryable failure
 *   processedAt = future      -> active lease (currently being processed)
 *   processedAt = past        -> lease expired (if not completed/failed)
 *   completedAt != null       -> successfully completed
 *   failedAt != null          -> permanently failed
 *
 * The OutboxEvent.attempts field is incremented at each claim, never
 * decremented. So attempts > 0 with processedAt = null means the event
 * was claimed and then its lease was released by a retryable failure.
 */

import type { Prisma } from '@/generated/prisma';

/**
 * Lightweight outbox event summary returned by recovery queries.
 * Intentionally avoids leaking the full payload.
 */
export interface OutboxEventSummary {
  id: string;
  eventType: string;
  attempts: number;
  lastError: string | null;
  createdAt: Date;
  processedAt: Date | null;
}

/**
 * Classification result aggregating all stale-event categories.
 */
export interface RecoveryReport {
  /** Brand new events that have never been claimed. */
  pending: OutboxEventSummary[];
  /** Claimed at least once, lease released by retryable failure. */
  stranded: OutboxEventSummary[];
  /** Currently leased (lease deadline in the future). */
  activeLeases: OutboxEventSummary[];
  /** Lease deadline passed without completion or failure. */
  expiredLeases: OutboxEventSummary[];
  /** Permanently failed (terminal). */
  failed: OutboxEventSummary[];
  /** Successfully completed. */
  completed: OutboxEventSummary[];
}

const SUMMARY_SELECT = {
  id: true,
  eventType: true,
  attempts: true,
  lastError: true,
  createdAt: true,
  processedAt: true,
} satisfies Prisma.OutboxEventSelect;

type OutboxEventRow = Prisma.OutboxEventGetPayload<{ typeof: undefined; select: typeof SUMMARY_SELECT }>;

function toSummary(row: OutboxEventRow): OutboxEventSummary {
  return {
    id: row.id,
    eventType: row.eventType,
    attempts: row.attempts,
    lastError: row.lastError,
    createdAt: row.createdAt,
    processedAt: row.processedAt,
  };
}

/**
 * Events that have never been claimed: no processing attempts, no lease.
 * These will be picked up by the dispatcher on its next poll.
 */
export async function getPendingEvents(
  tx: Prisma.TransactionClient,
): Promise<OutboxEventSummary[]> {
  const rows = await tx.outboxEvent.findMany({
    where: {
      failedAt: null,
      completedAt: null,
      processedAt: null,
      attempts: 0,
    },
    select: SUMMARY_SELECT,
    orderBy: { createdAt: 'asc' },
  });

  return rows.map(toSummary);
}

/**
 * Stranded events: claimed at least once (attempts > 0), but their lease
 * was released by a retryable failure (processedAt = null) without being
 * completed or permanently failed.
 *
 * The dispatcher will naturally re-claim these on its next poll. They are
 * reported at startup for operator visibility only.
 */
export async function getStrandedEvents(
  tx: Prisma.TransactionClient,
): Promise<OutboxEventSummary[]> {
  const rows = await tx.outboxEvent.findMany({
    where: {
      failedAt: null,
      completedAt: null,
      processedAt: null,
      attempts: { gt: 0 },
    },
    select: SUMMARY_SELECT,
    orderBy: { createdAt: 'asc' },
  });

  return rows.map(toSummary);
}

/**
 * Currently leased events: lease deadline is in the future.
 * These are actively being processed by a worker.
 */
export async function getActiveLeases(
  tx: Prisma.TransactionClient,
  now: Date = new Date(),
): Promise<OutboxEventSummary[]> {
  const rows = await tx.outboxEvent.findMany({
    where: {
      failedAt: null,
      completedAt: null,
      processedAt: { gt: now },
    },
    select: SUMMARY_SELECT,
    orderBy: { processedAt: 'asc' },
  });

  return rows.map(toSummary);
}

/**
 * Expired leases: lease deadline has passed but the event was neither
 * completed nor permanently failed. These are eligible for re-claim.
 */
export async function getExpiredLeases(
  tx: Prisma.TransactionClient,
  now: Date = new Date(),
): Promise<OutboxEventSummary[]> {
  const rows = await tx.outboxEvent.findMany({
    where: {
      failedAt: null,
      completedAt: null,
      processedAt: { not: null, lte: now },
    },
    select: SUMMARY_SELECT,
    orderBy: { processedAt: 'asc' },
  });

  return rows.map(toSummary);
}

/**
 * Permanently failed events (terminal state). Not recoverable by re-dispatch
 * unless the operator clears failedAt.
 */
export async function getFailedEvents(
  tx: Prisma.TransactionClient,
): Promise<OutboxEventSummary[]> {
  const rows = await tx.outboxEvent.findMany({
    where: {
      failedAt: { not: null },
    },
    select: SUMMARY_SELECT,
    orderBy: { createdAt: 'asc' },
  });

  return rows.map(toSummary);
}

/**
 * Successfully completed events. Never reported as recoverable.
 */
export async function getCompletedEvents(
  tx: Prisma.TransactionClient,
): Promise<OutboxEventSummary[]> {
  const rows = await tx.outboxEvent.findMany({
    where: {
      completedAt: { not: null },
    },
    select: SUMMARY_SELECT,
    orderBy: { createdAt: 'asc' },
  });

  return rows.map(toSummary);
}

/**
 * Run all recovery queries and return a classified report.
 *
 * Each query is independent; a failure in one does not prevent the others
 * from being reported.
 */
export async function buildRecoveryReport(
  tx: Prisma.TransactionClient,
  now: Date = new Date(),
): Promise<RecoveryReport> {
  const [pending, stranded, activeLeases, expiredLeases, failed, completed] =
    await Promise.all([
      getPendingEvents(tx),
      getStrandedEvents(tx),
      getActiveLeases(tx, now),
      getExpiredLeases(tx, now),
      getFailedEvents(tx),
      getCompletedEvents(tx),
    ]);

  return {
    pending,
    stranded,
    activeLeases,
    expiredLeases,
    failed,
    completed,
  };
}

/**
 * The subset of recovery data the worker logs at startup.
 * Stranded events are the primary concern: they indicate past failures
 * that the operator should be aware of.
 */
export interface StartupRecoverySummary {
  strandedCount: number;
  strandedEventIds: string[];
  pendingCount: number;
  activeLeaseCount: number;
  expiredLeaseCount: number;
  failedCount: number;
  completedCount: number;
}

/**
 * Query only the data needed for the startup recovery log line.
 * Cheaper than buildRecoveryReport because it avoids fetching full
 * stranded event rows when only the count + ids are needed.
 */
export async function getStartupRecoverySummary(
  tx: Prisma.TransactionClient,
  now: Date = new Date(),
): Promise<StartupRecoverySummary> {
  const [stranded, pending, activeLeases, expiredLeases, failed, completed] =
    await Promise.all([
      tx.outboxEvent.findMany({
        where: {
          failedAt: null,
          completedAt: null,
          processedAt: null,
          attempts: { gt: 0 },
        },
        select: { id: true },
        orderBy: { createdAt: 'asc' },
      }),
      tx.outboxEvent.count({
        where: {
          failedAt: null,
          completedAt: null,
          processedAt: null,
          attempts: 0,
        },
      }),
      tx.outboxEvent.count({
        where: {
          failedAt: null,
          completedAt: null,
          processedAt: { gt: now },
        },
      }),
      tx.outboxEvent.count({
        where: {
          failedAt: null,
          completedAt: null,
          processedAt: { not: null, lte: now },
        },
      }),
      tx.outboxEvent.count({
        where: { failedAt: { not: null } },
      }),
      tx.outboxEvent.count({
        where: { completedAt: { not: null } },
      }),
    ]);

  return {
    strandedCount: stranded.length,
    strandedEventIds: stranded.map((e) => e.id),
    pendingCount: pending,
    activeLeaseCount: activeLeases,
    expiredLeaseCount: expiredLeases,
    failedCount: failed,
    completedCount: completed,
  };
}
