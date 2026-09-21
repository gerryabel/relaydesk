import type { OutboxEventRecord } from '@/lib/outbox/types';

export type OutboxHandlerResult =
  | { status: 'success' }
  | { status: 'failure'; error: { message: string; retryable: boolean } };

/**
 * Context passed to handlers so they can make attempt-aware decisions.
 *
 * `attempt` is the current processing attempt (0-indexed). `maxAttempts`
 * is the total number of attempts BullMQ will make (per the job's `attempts`
 * option at enqueue time). Handlers can use these to detect the final attempt
 * and avoid throwing RetryableError when no retries remain.
 */
export interface OutboxHandlerContext {
  attempt: number;
  maxAttempts: number;
}

export type OutboxHandler = (
  event: OutboxEventRecord,
  context?: OutboxHandlerContext,
) => Promise<OutboxHandlerResult | void>;
