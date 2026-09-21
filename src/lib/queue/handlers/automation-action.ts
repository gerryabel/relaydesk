import type { OutboxHandler, OutboxHandlerResult, OutboxHandlerContext } from './types';
import type { OutboxEventRecord } from '@/lib/outbox/types';
import {
  executeAction,
  markActionFailedAndContinue,
} from '@/lib/automation/actions/execution';
import { RetryableError } from '@/lib/queue/errors';

/**
 * Handler for AUTOMATION_ACTION_EXECUTION outbox events.
 *
 * Each event encodes an (executionId, actionIndex) pair identifying a single
 * pending action to execute. The handler delegates to `executeAction`,
 * which runs the action in a transaction and either:
 *   - reaches a terminal state (completed/failed), persists it, and creates
 *     the next action's outbox event (or finalizes the execution), all in
 *     the same transaction; or
 *   - reports a transient failure, in which case this handler throws
 *     RetryableError so BullMQ retries the event.
 *
 * Idempotency: `executeAction` is safe across redelivery. If the action
 * already reached a terminal state (e.g., the worker crashed after commit
 * but before BullMQ acknowledged the job), the handler returns success.
 *
 * Retry exhaustion: on the final BullMQ attempt, a retryable failure cannot
 * be retried further. To avoid stranding the action in `pending`, the handler
 * marks the action as failed and drives the chain forward (scheduling the
 * next action or finalizing the execution) via `markActionFailedAndContinue`.
 * The outbox event is then reported as processed so BullMQ does not move it
 * to the failed set.
 */
export const handleAutomationActionExecution: OutboxHandler = async (
  event: OutboxEventRecord,
  context?: OutboxHandlerContext,
): Promise<OutboxHandlerResult> => {
  const payload = event.payload as {
    executionId: string;
    actionIndex: number;
    workspaceId: string;
    ticketId: string;
    automationContext: {
      causedByAutomation: boolean;
      ruleId: string;
      executionId: string;
      actionIndex: number;
      actorId: string | null;
    };
  };

  const { executionId, actionIndex } = payload;

  const outcome = await executeAction(executionId, actionIndex);

  if (outcome.terminal) {
    // Terminal state reached — the outbox event is considered processed.
    return { status: 'success' };
  }

  // Transient failure. If this is the final attempt, drive the chain forward
  // by marking the action as failed inline, so the action does not remain
  // stranded in `pending`.
  const isFinalAttempt = context ? context.attempt >= context.maxAttempts - 1 : false;
  if (isFinalAttempt) {
    await markActionFailedAndContinue(
      executionId,
      actionIndex,
      `Retry exhausted after ${context!.attempt + 1} attempt(s): ${outcome.error}`,
    );
    return { status: 'success' };
  }

  // Retryable — ask BullMQ to retry.
  throw new RetryableError(outcome.error);
};
