import { prisma } from '@/lib/db/prisma';
import type { Prisma } from '@/generated/prisma';
import { createOutboxEvent } from '@/lib/outbox/outbox';
import { getActionHandler } from './handlers';
import { validateActionConfig } from './schema';
import type { ActionContext, ActionHandlerResult } from './types';
import type { AutomationActionType } from './schema';

/**
 * Result of executing a single action within a transaction.
 */
export interface ExecuteActionResult {
  /** The action reached a terminal state in this call. */
  terminal: true;
  /** Whether the action succeeded or failed. */
  outcome: 'completed' | 'failed';
  /** Optional summary or error message. */
  detail?: string;
}

/**
 * Result when the action failed transiently (retryable).
 * The transaction is rolled back; BullMQ will retry the outbox event.
 */
export interface ExecuteActionRetryable {
  terminal: false;
  retryable: true;
  error: string;
}

export type ExecuteActionOutcome = ExecuteActionResult | ExecuteActionRetryable;

/**
 * Finds the next pending action for an execution, in index order.
 */
export async function findNextPendingAction(
  tx: Prisma.TransactionClient,
  executionId: string,
) {
  return tx.automationActionExecution.findFirst({
    where: { executionId, status: 'pending' },
    orderBy: { actionIndex: 'asc' },
  });
}

/**
 * Loads all actions for an execution, ordered by index.
 */
export async function loadActions(
  tx: Prisma.TransactionClient,
  executionId: string,
) {
  return tx.automationActionExecution.findMany({
    where: { executionId },
    orderBy: { actionIndex: 'asc' },
  });
}

/**
 * Marks a single action as failed (retry exhausted) and either schedules the
 * next pending action or finalizes the execution. This is the retry-exhaustion
 * path: when BullMQ will not retry again, we must drive the action chain
 * forward from the outbox handler rather than leaving the action stranded in
 * `pending`.
 *
 * Caller must NOT be inside a transaction with other uncommitted side effects,
 * because this function commits its own transaction.
 */
export async function markActionFailedAndContinue(
  executionId: string,
  actionIndex: number,
  errorMessage: string,
): Promise<void> {
  const execution = await prisma.automationExecution.findUnique({
    where: { id: executionId },
  });
  if (!execution) {
    return;
  }

  await prisma.$transaction(async (tx) => {
    // Only update if still pending — a concurrent worker may have completed it.
    const { count } = await tx.automationActionExecution.updateMany({
      where: {
        executionId,
        actionIndex,
        status: 'pending',
      },
      data: {
        status: 'failed',
        error: errorMessage,
        completedAt: new Date(),
      },
    });

    if (count === 0) {
      // Already in a terminal state — nothing to do.
      return;
    }

    await scheduleNextOrFinalize(tx, executionId, actionIndex, execution);
  });
}

/**
 * Creates the AUTOMATION_ACTION_EXECUTION outbox event for a specific action.
 *
 * The payload encodes which execution + actionIndex to run so the handler
 * can dispatch to the correct pending action.
 */
export async function queueAutomationActionExecution(
  tx: Prisma.TransactionClient,
  executionId: string,
  actionIndex: number,
  workspaceId: string,
  ticketId: string,
  ruleId: string | null,
  actorId: string | null,
): Promise<void> {
  await createOutboxEvent(
    {
      eventType: 'AUTOMATION_ACTION_EXECUTION',
      aggregateType: 'Ticket',
      aggregateId: ticketId,
      payload: {
        executionId,
        actionIndex,
        workspaceId,
        ticketId,
        automationContext: {
          causedByAutomation: true,
          ruleId,
          executionId,
          actionIndex,
          actorId,
        },
      },
    },
    tx,
  );
}

/**
 * Finalizes an AutomationExecution by computing the aggregate status from
 * its action outcomes.
 *
 * Status aggregation rules (per Phase 8 spec):
 *   - all actions completed            → completed
 *   - some actions failed, some ok     → partial_failure
 *   - all actions failed               → failed
 *
 * This is race-safe: it uses updateMany with a WHERE clause that only
 * matches executions in `awaiting_actions` status, so concurrent calls
 * cannot finalize the same execution twice.
 */
export async function finalizeExecution(
  tx: Prisma.TransactionClient,
  executionId: string,
): Promise<{ finalized: boolean; status: string | null }> {
  const actions = await tx.automationActionExecution.findMany({
    where: { executionId },
    select: { status: true },
  });

  if (actions.length === 0) {
    // No actions — nothing to finalize against.
    return { finalized: false, status: null };
  }

  const completedCount = actions.filter((a) => a.status === 'completed').length;
  const failedCount = actions.filter((a) => a.status === 'failed').length;

  let aggregateStatus: string;
  if (failedCount === 0) {
    aggregateStatus = 'completed';
  } else if (completedCount === 0) {
    aggregateStatus = 'failed';
  } else {
    aggregateStatus = 'partial_failure';
  }

  // Race-safe: only update if still awaiting_actions.
  const { count } = await tx.automationExecution.updateMany({
    where: {
      id: executionId,
      status: 'awaiting_actions',
    },
    data: {
      status: aggregateStatus as 'completed' | 'partial_failure' | 'failed',
      completedAt: new Date(),
      leasedBy: null,
      leasedAt: null,
    },
  });

  if (count === 0) {
    // Another worker already finalized (or it's in an unexpected state).
    return { finalized: false, status: null };
  }

  return { finalized: true, status: aggregateStatus };
}

/**
 * Executes the action identified by executionId + actionIndex.
 *
 * This is the core execution function. It:
 * 1. Loads the action and validates it's still pending.
 * 2. Validates the action config.
 * 3. Runs the handler.
 * 4. On terminal result, persists the action state and either schedules
 *    the next action or finalizes the execution.
 *
 * The entire operation runs in a single transaction for crash safety:
 * if the worker crashes after commit, both the action state and the next
 * outbox event (or finalization) are durable.
 *
 * @returns the outcome, indicating whether the action reached a terminal
 *          state or needs to be retried.
 */
export async function executeAction(
  executionId: string,
  actionIndex: number,
): Promise<ExecuteActionOutcome> {
  try {
    return await prisma.$transaction(async (tx) => {
      // 1. Load the action — must be pending and match executionId+actionIndex.
      const action = await tx.automationActionExecution.findUnique({
        where: {
          executionId_actionIndex: { executionId, actionIndex },
        },
      });

      if (!action) {
        // Action doesn't exist — permanent failure (shouldn't happen).
        return {
          terminal: true,
          outcome: 'failed',
          detail: `Action ${executionId}:${actionIndex} not found`,
        } satisfies ExecuteActionResult;
      }

      // Natural idempotency at the worker level: if the action already
      // reached a terminal state, treat this as a no-op completion.
      if (action.status === 'completed') {
        return {
          terminal: true,
          outcome: 'completed',
          detail: 'already-completed',
        } satisfies ExecuteActionResult;
      }
      if (action.status === 'failed') {
        return {
          terminal: true,
          outcome: 'failed',
          detail: action.error ?? 'already-failed',
        } satisfies ExecuteActionResult;
      }
      if (action.status !== 'pending') {
        // Unknown/non-terminal state — skip.
        return {
          terminal: true,
          outcome: 'failed',
          detail: `Unexpected action status: ${action.status}`,
        } satisfies ExecuteActionResult;
      }

      // Load the execution for context + ruleId.
      const execution = await tx.automationExecution.findUnique({
        where: { id: executionId },
      });
      if (!execution) {
        return {
          terminal: true,
          outcome: 'failed',
          detail: `Execution ${executionId} not found`,
        } satisfies ExecuteActionResult;
      }

      // 2. Validate the action config.
      const actionType = action.actionType;
      const actionConfig = action.actionConfig as Record<string, unknown>;

      const validation = validateActionConfig(actionType, actionConfig);
      if (!validation.valid) {
        // Permanent failure: invalid config.
        await tx.automationActionExecution.update({
          where: { id: action.id },
          data: {
            status: 'failed',
            error: validation.error,
            completedAt: new Date(),
          },
        });
        // Schedule next action or finalize.
        await scheduleNextOrFinalize(tx, executionId, actionIndex, execution);
        return {
          terminal: true,
          outcome: 'failed',
          detail: validation.error,
        } satisfies ExecuteActionResult;
      }

      // 3. Run the handler.
      const handler = getActionHandler(actionType);
      if (!handler) {
        await tx.automationActionExecution.update({
          where: { id: action.id },
          data: {
            status: 'failed',
            error: `No handler registered for action type: ${actionType}`,
            completedAt: new Date(),
          },
        });
        await scheduleNextOrFinalize(tx, executionId, actionIndex, execution);
        return {
          terminal: true,
          outcome: 'failed',
          detail: `No handler for ${actionType}`,
        } satisfies ExecuteActionResult;
      }

      const ctx: ActionContext = {
        executionId,
        workspaceId: execution.workspaceId,
        ticketId: execution.ticketId ?? '',
        actionIndex,
        actionType: actionType as AutomationActionType,
        actionConfig,
        automationContext: {
          causedByAutomation: true,
          ruleId: execution.ruleId,
          executionId,
          actionIndex,
          // System/automation action — no human actor. This matches the
          // established pattern in sla/evaluation.ts for system events.
          actorId: null,
        },
      };

      let result: ActionHandlerResult;
      try {
        result = await handler(ctx, tx);
      } catch (error) {
        // Handler threw — classify as permanent vs retryable.
        const message = error instanceof Error ? error.message : String(error);
        // Thrown errors from handlers we don't recognize as permanent are
        // treated as retryable (transient infrastructure failure).
        result = { status: 'retryable', error: message };
      }

      // 4. Process the result.
      if (result.status === 'retryable') {
        // Transient failure — do NOT persist a terminal state.
        // The transaction returns without committing an action state change
        // other than startedAt. BullMQ will retry the outbox event.
        // We return a signal to the outbox handler to throw RetryableError.
        return {
          terminal: false,
          retryable: true,
          error: result.error,
        } satisfies ExecuteActionRetryable;
      }

      if (result.status === 'completed') {
        await tx.automationActionExecution.update({
          where: { id: action.id },
          data: {
            status: 'completed',
            completedAt: new Date(),
          },
        });
      } else {
        // failed (permanent)
        await tx.automationActionExecution.update({
          where: { id: action.id },
          data: {
            status: 'failed',
            error: result.error,
            completedAt: new Date(),
          },
        });
      }

      // 5. Schedule next action or finalize.
      await scheduleNextOrFinalize(tx, executionId, actionIndex, execution);

      return {
        terminal: true,
        outcome: result.status,
        detail: result.status === 'completed' ? result.summary : (result as { error: string }).error,
      } satisfies ExecuteActionResult;
    });
  } catch (error) {
    // Transaction-level failure (e.g., DB connection lost).
    // Signal retryable so the outbox event can be retried.
    return {
      terminal: false,
      retryable: true,
      error: error instanceof Error ? error.message : String(error),
    } satisfies ExecuteActionRetryable;
  }
}

/**
 * After a terminal action result, either:
 *   - create the outbox event for the next action (actionIndex + 1), or
 *   - finalize the execution if this was the last action.
 *
 * Must be called within the same transaction as the action state update
 * so that the action state + next outbox event are atomic.
 */
async function scheduleNextOrFinalize(
  tx: Prisma.TransactionClient,
  executionId: string,
  currentActionIndex: number,
  execution: { workspaceId: string; ticketId: string | null; ruleId: string | null },
): Promise<void> {
  const nextAction = await tx.automationActionExecution.findFirst({
    where: {
      executionId,
      actionIndex: currentActionIndex + 1,
      status: 'pending',
    },
    select: { actionIndex: true },
  });

  if (nextAction) {
    // All current automation actions are ticket-scoped. An execution with a
    // null ticketId violates the invariant that actions operate on a ticket;
    // fail loud rather than silently producing an outbox event with an
    // empty-string aggregateId that would hide the bug.
    const ticketId = execution.ticketId;
    if (!ticketId) {
      throw new Error(
        `Cannot schedule action ${nextAction.actionIndex} for execution ${executionId}: ticketId is null`,
      );
    }

    // Schedule the next action.
    await queueAutomationActionExecution(
      tx,
      executionId,
      nextAction.actionIndex,
      execution.workspaceId,
      ticketId,
      execution.ruleId ?? null,
      // Actor id threaded from automation context.
      null,
    );
  } else {
    // No more pending actions — finalize.
    await finalizeExecution(tx, executionId);
  }
}
