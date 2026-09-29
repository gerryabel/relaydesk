import { prisma } from '@/lib/db/prisma';
import type { Prisma } from '@/generated/prisma';
import { AutomationExecutionStatus } from '@/generated/prisma';
import { getCurrentMembership, assertWorkspaceOwner } from '@/lib/workspace/server';
import { queueAutomationActionExecution } from '@/lib/automation/actions/execution';
import { ExecutionNotFoundError } from '@/lib/automation/execution-service';
import { normalizeTicketPagination, type TicketPaginationResult } from '@/lib/tickets/pagination';

// ── Constants ────────────────────────────────────────────────────────────────

/**
 * Execution statuses a manual retry may reopen.
 *
 * Only terminal-with-failure states qualify: if the execution is still
 * `awaiting_actions`/`evaluating`/`executing` the worker is already driving
 * the action chain, so a second enqueue would race it.
 */
export const RETRYABLE_EXECUTION_STATUSES = [
  AutomationExecutionStatus.failed,
  AutomationExecutionStatus.partial_failure,
] as const satisfies readonly AutomationExecutionStatus[];

// ── Errors ───────────────────────────────────────────────────────────────────

export class ActionNotFoundError extends Error {
  constructor(message = 'Automation action execution not found') {
    super(message);
    this.name = 'ActionNotFoundError';
  }
}

/**
 * The execution/action pair exists but is not in a state that permits a manual
 * retry (non-terminal execution, non-failed action, or a non-final action).
 * Surfaced as HTTP 409.
 */
export class ExecutionNotRetryableError extends Error {
  constructor(message = 'This automation action cannot be retried') {
    super(message);
    this.name = 'ExecutionNotRetryableError';
  }
}

/**
 * The requested retry has already been performed.
 *
 * Covers both the concurrent loser of the conditional `failed → pending`
 * update and a request that arrives *after* a successful retry, when the
 * action has already been reopened to `pending` and the execution is back in
 * `awaiting_actions`. Surfaced as HTTP 409 with a stable code so a caller
 * never assumes a second enqueue happened, and so both orderings report the
 * same reason.
 */
export class ExecutionRetryConflictError extends Error {
  constructor(message = 'This automation action has already been retried') {
    super(message);
    this.name = 'ExecutionRetryConflictError';
  }
}

// ── Types ────────────────────────────────────────────────────────────────────

export interface AutomationExecutionFilters {
  page?: number;
  limit?: number;
  status?: string;
  ruleId?: string;
  sourceEventType?: string;
  ticketId?: string;
  /** Inclusive lower bound, applied as `createdAt >= from`. */
  from?: Date;
  /** Exclusive upper bound, applied as `createdAt < to` (half-open `[from, to)`). */
  to?: Date;
}

export type AutomationExecutionListItem = {
  id: string;
  workspaceId: string;
  ruleId: string | null;
  ruleNameSnapshot: string;
  sourceEventType: string;
  sourceEventId: string;
  sourceAggregateId: string;
  ticketId: string | null;
  status: AutomationExecutionStatus;
  evaluatedConditions: boolean;
  skipReason: string | null;
  error: string | null;
  actionCount: number;
  failedActionCount: number;
  startedAt: string;
  completedAt: string | null;
  createdAt: string;
  /** Wall-clock duration in ms, or null while the execution is unfinished. */
  durationMs: number | null;
  /**
   * True only when the execution *currently* has a retryable final failed
   * action, i.e. `execution.status IN (failed, partial_failure)` AND the
   * highest-index action is `failed`.
   *
   * It describes execution state, not permission: a workspace member may see
   * `true` here, but the retry control is withheld server-side (`canRetry` on
   * the detail payload). The action index is intentionally not exposed here —
   * the retry control lives on the detail page, which already returns the full
   * ordered action timeline.
   */
  isRetryable: boolean;
};

export type AutomationExecutionListResult = TicketPaginationResult<AutomationExecutionListItem>;

export type AutomationExecutionActionView = {
  id: string;
  actionIndex: number;
  actionType: string;
  /** Historical configuration captured when the execution started. */
  actionConfig: Prisma.JsonValue;
  status: string;
  error: string | null;
  startedAt: string | null;
  completedAt: string | null;
  createdAt: string;
  updatedAt: string;
  durationMs: number | null;
  isFinalAction: boolean;
  /** True only for a failed final action of a retryable execution. */
  isRetryable: boolean;
};

export type AutomationExecutionSourceEventView = {
  id: string;
  eventType: string;
  aggregateType: string;
  aggregateId: string;
  payload: Prisma.JsonValue;
  createdAt: string;
  processedAt: string | null;
  completedAt: string | null;
  failedAt: string | null;
  attempts: number;
  lastError: string | null;
};

export type AutomationExecutionDetailResult = {
  execution: {
    id: string;
    workspaceId: string;
    ruleId: string | null;
    ruleNameSnapshot: string;
    /** Current rule state, or null when the originating rule was deleted. */
    rule: { id: string; name: string; enabled: boolean; triggerType: string } | null;
    sourceEventType: string;
    sourceEventId: string;
    sourceAggregateId: string;
    ticketId: string | null;
    status: AutomationExecutionStatus;
    evaluatedConditions: boolean;
    skipReason: string | null;
    error: string | null;
    leasedBy: string | null;
    leasedAt: string | null;
    startedAt: string;
    completedAt: string | null;
    createdAt: string;
    updatedAt: string;
    durationMs: number | null;
    isRetryable: boolean;
  };
  actions: AutomationExecutionActionView[];
  /** Optional debugging context; null when the outbox event is unavailable. */
  sourceEvent: AutomationExecutionSourceEventView | null;
  /** Server-derived: the caller holds the owner role required to retry. */
  canRetry: boolean;
};

export type RetryAutomationActionResult = {
  executionId: string;
  actionIndex: number;
  actionStatus: 'pending';
  executionStatus: 'awaiting_actions';
};

type ExecutionWithActionStates = Prisma.AutomationExecutionGetPayload<{
  include: { actions: { select: { actionIndex: true; status: true } } };
}>;

// ── Helpers ──────────────────────────────────────────────────────────────────

function isRetryableExecutionStatus(status: string): boolean {
  return (RETRYABLE_EXECUTION_STATUSES as readonly string[]).includes(status);
}

function computeDuration(start: Date | null, end: Date | null): number | null {
  if (!start || !end) return null;
  return end.getTime() - start.getTime();
}

/**
 * True when the execution's final action is `failed` and the execution itself
 * sits in a retryable terminal state. Actions are expected in `actionIndex`
 * order by every caller of this helper.
 */
function hasRetryableFinalAction(
  actions: Array<{ actionIndex: number; status: string }>,
  executionStatus: string,
): boolean {
  if (!isRetryableExecutionStatus(executionStatus) || actions.length === 0) return false;
  const finalAction = actions[actions.length - 1]!;
  return finalAction.status === 'failed';
}

// ── Retry rejection classification ────────────────────────────────────────────

/** The action/execution statuses that explain why a retry was refused. */
type RetryStateSnapshot = {
  actionStatus: string;
  executionStatus: string;
};

/**
 * True when the action/execution pair sits in the reopened state that
 * `retryFailedFinalAction` itself produces: the final action was reset to
 * `pending` and the execution moved back to `awaiting_actions`.
 *
 * Observing this pair means the requested retry has already been performed,
 * whether the losing request arrived concurrently (it lost the conditional
 * `failed → pending` update) or afterwards (it failed the terminal-state and
 * failed-action checks).
 *
 * Note the one ambiguity: an execution that has been handed off but whose
 * first action has not been picked up yet is also `awaiting_actions` +
 * `pending`. Row data alone cannot separate the two, and both mean the same
 * thing to a caller — the action is not in a retryable `failed` state and must
 * not be re-enqueued — so both are reported as a conflict. The retry control
 * is never offered for a non-failed action, so the UI cannot produce this
 * state in the first place.
 */
function isReopenedByRetry(snapshot: RetryStateSnapshot): boolean {
  return snapshot.actionStatus === 'pending' && snapshot.executionStatus === 'awaiting_actions';
}

/**
 * Maps a refused retry onto the right domain error.
 *
 * A retry that has already happened is always a conflict, so serialized and
 * concurrent second retries report the same code. Every other invalid state
 * keeps the more descriptive `ExecutionNotRetryableError`, which prevents
 * unrelated bad states from being reported as conflicts.
 */
function rejectRetry(snapshot: RetryStateSnapshot, message: string): never {
  if (isReopenedByRetry(snapshot)) {
    throw new ExecutionRetryConflictError();
  }
  throw new ExecutionNotRetryableError(message);
}

/** Re-reads the live statuses so a lost conditional update can be classified. */
async function readRetryStateSnapshot(
  tx: Prisma.TransactionClient,
  executionId: string,
  actionIndex: number,
): Promise<RetryStateSnapshot> {
  // Sequential reads: this runs on a single transaction connection.
  const execution = await tx.automationExecution.findUnique({
    where: { id: executionId },
    select: { status: true },
  });
  const action = await tx.automationActionExecution.findUnique({
    where: { executionId_actionIndex: { executionId, actionIndex } },
    select: { status: true },
  });

  if (!action) {
    throw new ActionNotFoundError();
  }

  return {
    actionStatus: action.status,
    executionStatus: execution?.status ?? 'unknown',
  };
}

/**
 * Builds the workspace-scoped Prisma `where` clause.
 *
 * `workspaceId` always comes from the authenticated membership — never from
 * caller input — so executions belonging to other workspaces can never be
 * selected.
 *
 * Date filtering is a half-open UTC interval: `createdAt >= from` AND
 * `createdAt < to`.
 */
function buildExecutionWhere(
  workspaceId: string,
  filters: AutomationExecutionFilters,
): Prisma.AutomationExecutionWhereInput {
  const createdAt =
    filters.from || filters.to
      ? {
          ...(filters.from ? { gte: filters.from } : {}),
          ...(filters.to ? { lt: filters.to } : {}),
        }
      : undefined;

  return {
    workspaceId,
    ...(filters.status ? { status: filters.status as AutomationExecutionStatus } : {}),
    ...(filters.ruleId ? { ruleId: filters.ruleId } : {}),
    ...(filters.sourceEventType ? { sourceEventType: filters.sourceEventType } : {}),
    ...(filters.ticketId ? { ticketId: filters.ticketId } : {}),
    ...(createdAt ? { createdAt } : {}),
  };
}

function toListItem(execution: ExecutionWithActionStates): AutomationExecutionListItem {
  const failedActionCount = execution.actions.filter((a) => a.status === 'failed').length;

  return {
    id: execution.id,
    workspaceId: execution.workspaceId,
    ruleId: execution.ruleId,
    ruleNameSnapshot: execution.ruleNameSnapshot,
    sourceEventType: execution.sourceEventType,
    sourceEventId: execution.sourceEventId,
    sourceAggregateId: execution.sourceAggregateId,
    ticketId: execution.ticketId,
    status: execution.status,
    evaluatedConditions: execution.evaluatedConditions,
    skipReason: execution.skipReason,
    error: execution.error,
    actionCount: execution.actions.length,
    failedActionCount,
    startedAt: execution.startedAt.toISOString(),
    completedAt: execution.completedAt ? execution.completedAt.toISOString() : null,
    createdAt: execution.createdAt.toISOString(),
    durationMs: computeDuration(execution.startedAt, execution.completedAt),
    isRetryable: hasRetryableFinalAction(execution.actions, execution.status),
  };
}

// ── Reads ────────────────────────────────────────────────────────────────────

/**
 * Lists automation executions for the current workspace.
 *
 * Readable by any workspace member. Ordering is deterministic
 * (`createdAt DESC, id DESC`) so pagination stays stable.
 *
 * Page clamping matches the repository ticket convention: a page beyond the
 * last page resolves to the last valid page instead of erroring.
 */
export async function listAutomationExecutions(
  filters: AutomationExecutionFilters = {},
): Promise<AutomationExecutionListResult> {
  const membership = await getCurrentMembership();

  const { page, limit } = normalizeTicketPagination({
    page: filters.page,
    limit: filters.limit,
  });

  const where = buildExecutionWhere(membership.workspaceId, filters);

  const total = await prisma.automationExecution.count({ where });
  const totalPages = Math.max(1, Math.ceil(total / limit));
  const normalizedPage = Math.min(page, totalPages);

  const executions = await prisma.automationExecution.findMany({
    where,
    // Only per-action state is needed to derive the row counters and to decide
    // whether a manual retry is possible. Ordering matters: "final action" is
    // the highest actionIndex, so the relation must be explicitly ordered.
    include: {
      actions: {
        select: { actionIndex: true, status: true },
        orderBy: { actionIndex: 'asc' },
      },
    },
    orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
    skip: (normalizedPage - 1) * limit,
    take: limit,
  });

  return {
    data: executions.map(toListItem),
    page: normalizedPage,
    limit,
    total,
    totalPages,
    hasPreviousPage: normalizedPage > 1,
    hasNextPage: normalizedPage < totalPages,
  };
}

/**
 * Returns one execution with its action timeline and (best-effort) source
 * outbox event, scoped to the current workspace.
 *
 * Readable by any workspace member. Throws ExecutionNotFoundError when the
 * execution does not exist in the caller's workspace — an identical response
 * for "does not exist" and "belongs to another workspace", so ownership is
 * never leaked.
 */
export async function getAutomationExecutionById(
  id: string,
): Promise<AutomationExecutionDetailResult> {
  const membership = await getCurrentMembership();

  const execution = await prisma.automationExecution.findFirst({
    where: { id, workspaceId: membership.workspaceId },
    include: {
      rule: { select: { id: true, name: true, enabled: true, triggerType: true } },
      actions: { orderBy: { actionIndex: 'asc' } },
    },
  });

  if (!execution) {
    throw new ExecutionNotFoundError();
  }

  // The source outbox event is optional debugging context. It is resolved only
  // after the execution has been authorized for this workspace, so unrelated
  // workspace events can never be reached through this path. A missing event
  // must not break the detail view.
  const sourceEvent = await prisma.outboxEvent.findFirst({
    where: { id: execution.sourceEventId },
    select: {
      id: true,
      eventType: true,
      aggregateType: true,
      aggregateId: true,
      payload: true,
      createdAt: true,
      processedAt: true,
      completedAt: true,
      failedAt: true,
      attempts: true,
      lastError: true,
    },
  });

  const executionRetryable = isRetryableExecutionStatus(execution.status);
  const finalActionIndex = execution.actions.length
    ? execution.actions[execution.actions.length - 1]!.actionIndex
    : null;

  return {
    execution: {
      id: execution.id,
      workspaceId: execution.workspaceId,
      ruleId: execution.ruleId,
      ruleNameSnapshot: execution.ruleNameSnapshot,
      rule: execution.rule,
      sourceEventType: execution.sourceEventType,
      sourceEventId: execution.sourceEventId,
      sourceAggregateId: execution.sourceAggregateId,
      ticketId: execution.ticketId,
      status: execution.status,
      evaluatedConditions: execution.evaluatedConditions,
      skipReason: execution.skipReason,
      error: execution.error,
      leasedBy: execution.leasedBy,
      leasedAt: execution.leasedAt ? execution.leasedAt.toISOString() : null,
      startedAt: execution.startedAt.toISOString(),
      completedAt: execution.completedAt ? execution.completedAt.toISOString() : null,
      createdAt: execution.createdAt.toISOString(),
      updatedAt: execution.updatedAt.toISOString(),
      durationMs: computeDuration(execution.startedAt, execution.completedAt),
      isRetryable: executionRetryable,
    },
    actions: execution.actions.map((action) => ({
      id: action.id,
      actionIndex: action.actionIndex,
      actionType: action.actionType,
      // Historical snapshot captured at handoff time — never re-read from the
      // current rule configuration.
      actionConfig: action.actionConfig,
      status: action.status,
      error: action.error,
      startedAt: action.startedAt ? action.startedAt.toISOString() : null,
      completedAt: action.completedAt ? action.completedAt.toISOString() : null,
      createdAt: action.createdAt.toISOString(),
      updatedAt: action.updatedAt.toISOString(),
      durationMs: computeDuration(action.startedAt, action.completedAt),
      isFinalAction: action.actionIndex === finalActionIndex,
      isRetryable:
        executionRetryable &&
        action.actionIndex === finalActionIndex &&
        action.status === 'failed',
    })),
    sourceEvent: sourceEvent
      ? {
          id: sourceEvent.id,
          eventType: sourceEvent.eventType,
          aggregateType: sourceEvent.aggregateType,
          aggregateId: sourceEvent.aggregateId,
          payload: sourceEvent.payload,
          createdAt: sourceEvent.createdAt.toISOString(),
          processedAt: sourceEvent.processedAt ? sourceEvent.processedAt.toISOString() : null,
          completedAt: sourceEvent.completedAt ? sourceEvent.completedAt.toISOString() : null,
          failedAt: sourceEvent.failedAt ? sourceEvent.failedAt.toISOString() : null,
          attempts: sourceEvent.attempts,
          lastError: sourceEvent.lastError,
        }
      : null,
    canRetry: membership.role === 'owner',
  };
}

// ── Mutation ─────────────────────────────────────────────────────────────────

/**
 * Manually retries the **final** failed action of a terminal execution.
 *
 * Owner-only. The whole operation runs in a single transaction, so the action
 * reset, the execution reopen and the `AUTOMATION_ACTION_EXECUTION` outbox
 * event either all commit or all roll back. The event is consumed by the
 * existing dispatcher → BullMQ → worker pipeline; this layer never invokes
 * the worker directly.
 *
 * Race safety: both the action reset and the execution reopen use conditional
 * `updateMany` guards (`status = 'failed'` / `status IN (...)`). Under
 * PostgreSQL READ COMMITTED a competing request blocks on the row lock and then
 * re-evaluates the predicate against the committed row, so it observes
 * `count === 0` instead of enqueueing a second retry.
 *
 * Conflict reporting is the same whether the losing request raced the winner
 * or arrived afterwards. A conditional miss re-reads the live statuses and
 * reports ExecutionRetryConflictError when the action is `pending` and the
 * execution is `awaiting_actions` — the reopened state a retry produces — and
 * keeps ExecutionNotRetryableError for every other invalid state. A serialized
 * repeat request hits the same reopened state and is rejected by the explicit
 * already-retried check before the terminal-state test, so it also yields
 * ExecutionRetryConflictError rather than a generic refusal.
 *
 * Deleted rules stay retryable: the action's historical `actionConfig` and the
 * execution's `ruleNameSnapshot` are authoritative, and `ruleId` is threaded
 * through as null.
 */
export async function retryFailedFinalAction(
  executionId: string,
  actionIndex: number,
): Promise<RetryAutomationActionResult> {
  const membership = await assertWorkspaceOwner();

  return prisma.$transaction(async (tx) => {
    // 1. The execution must exist inside the caller's workspace. Workspace
    //    identity comes from the authenticated membership, never the request.
    const execution = await tx.automationExecution.findFirst({
      where: { id: executionId, workspaceId: membership.workspaceId },
      select: { id: true, workspaceId: true, ticketId: true, ruleId: true, status: true },
    });

    if (!execution) {
      throw new ExecutionNotFoundError();
    }

    // 2. The action must belong to this execution.
    const action = await tx.automationActionExecution.findUnique({
      where: { executionId_actionIndex: { executionId, actionIndex } },
      select: { id: true, actionIndex: true, status: true },
    });

    if (!action) {
      throw new ActionNotFoundError();
    }

    // 3. Only the final action may be retried. Replaying an earlier action
    //    after later actions already ran could duplicate or reorder sequential
    //    side effects, so earlier failed actions stay display-only.
    const finalAction = await tx.automationActionExecution.findFirst({
      where: { executionId },
      orderBy: { actionIndex: 'desc' },
      select: { actionIndex: true },
    });

    if (!finalAction || finalAction.actionIndex !== actionIndex) {
      throw new ExecutionNotRetryableError(
        'Only the final automation action of an execution can be retried',
      );
    }

    // 4. Already-retried check, ahead of the terminal/failed-state checks.
    //
    //    A previous retry of this exact action leaves the final action at
    //    `pending` and the execution at `awaiting_actions`, so a repeat
    //    request is a conflict — not a generic "not retryable" refusal.
    //    Checking this first means serialized and concurrent second retries
    //    both answer ExecutionRetryConflictError, while every other invalid
    //    state still falls through to ExecutionNotRetryableError below.
    if (isReopenedByRetry({ actionStatus: action.status, executionStatus: execution.status })) {
      throw new ExecutionRetryConflictError();
    }

    // 5. The execution must be terminal-with-failure and the action must have
    //    actually failed.
    if (!isRetryableExecutionStatus(execution.status)) {
      throw new ExecutionNotRetryableError(
        `Execution is in status "${execution.status}" and is not retryable`,
      );
    }

    if (action.status !== 'failed') {
      rejectRetry(
        { actionStatus: action.status, executionStatus: execution.status },
        `Action is in status "${action.status}" and is not retryable`,
      );
    }

    // 6. Automation actions are ticket-scoped. An execution without a ticket
    //    cannot produce a valid outbox event, so fail loudly rather than
    //    enqueue an event with an empty aggregateId (the same invariant the
    //    worker's scheduleNextOrFinalize enforces).
    if (!execution.ticketId) {
      throw new ExecutionNotRetryableError(
        'Execution has no ticket, so the action cannot be re-enqueued',
      );
    }

    // 7. Race-safe action reset: failed -> pending. A competing request that
    //    already flipped this row observes count === 0, and the live state is
    //    re-read to decide between "already retried" and another invalid
    //    state.
    const actionReset = await tx.automationActionExecution.updateMany({
      where: { executionId, actionIndex, status: 'failed' },
      data: {
        status: 'pending',
        error: null,
        startedAt: null,
        completedAt: null,
      },
    });

    if (actionReset.count !== 1) {
      rejectRetry(
        await readRetryStateSnapshot(tx, executionId, actionIndex),
        'Automation action state changed while the retry was being applied',
      );
    }

    // 8. Race-safe reopen: only a still-terminal execution may be reopened.
    const executionReopen = await tx.automationExecution.updateMany({
      where: { id: executionId, status: { in: [...RETRYABLE_EXECUTION_STATUSES] } },
      data: {
        status: 'awaiting_actions',
        error: null,
        completedAt: null,
        leasedBy: null,
        leasedAt: null,
      },
    });

    if (executionReopen.count !== 1) {
      rejectRetry(
        await readRetryStateSnapshot(tx, executionId, actionIndex),
        'Automation execution state changed while the retry was being applied',
      );
    }

    // 9. Exactly one AUTOMATION_ACTION_EXECUTION outbox event, created in the
    //    same transaction so a pending action can never be left without a
    //    durable way to drive it. The owner who triggered the retry is recorded
    //    as the action's actor so downstream automations can see that a human
    //    (not another automation) caused it.
    await queueAutomationActionExecution(
      tx,
      executionId,
      actionIndex,
      execution.workspaceId,
      execution.ticketId,
      execution.ruleId ?? null,
      membership.userId,
    );

    return {
      executionId,
      actionIndex,
      actionStatus: 'pending',
      executionStatus: 'awaiting_actions',
    } satisfies RetryAutomationActionResult;
  });
}
