import { OutboxJobSchema } from './job-types';
import { getHandler } from './handlers/registry';
import {
  markOutboxEventProcessed,
  markOutboxEventPermanentlyFailed,
  recordOutboxFailure,
} from '@/lib/outbox/outbox';
import { prisma } from '@/lib/db/prisma';
import type { OutboxEventRecord } from '@/lib/outbox/types';
import type { OutboxHandlerResult } from './handlers/types';
import { PermanentError, RetryableError } from '@/lib/queue/errors';
import { info, warn, error as logError } from './logger';

/**
 * Minimal view of a BullMQ Job as seen by the outbox processor.
 *
 * `attemptsMade` is BullMQ's authoritative processing-attempt counter
 * (0 on the first attempt, incremented after each failure). It is optional
 * so unit tests can call processOutboxJob without a full Job instance.
 *
 * When `attemptsMade` is absent, the attempt is derived from the job
 * payload's `attempt` field (always 0 as set by the dispatcher).
 */
export interface OutboxJob {
  id: string;
  name?: string;
  data: unknown;
  attemptsMade?: number;
}

function isFailureResult(result: unknown): result is { status: 'failure'; error: { message: string; retryable: boolean } } {
  return typeof result === 'object' && result !== null && 'status' in result && (result as { status: string }).status === 'failure';
}

/**
 * Resolve the current processing attempt for logging.
 *
 * Prefers BullMQ's runtime `attemptsMade` (the authoritative processing
 * attempt counter). Falls back to the static payload `attempt` field when
 * the job object does not carry runtime attempt metadata (e.g. unit tests).
 */
function resolveAttempt(job: OutboxJob, parsedAttempt: number): number {
  if (typeof job.attemptsMade === 'number') {
    return job.attemptsMade;
  }
  return parsedAttempt;
}

export async function processOutboxJob(job: OutboxJob): Promise<{ handled: boolean }> {
  // Safety net: outbox jobs must carry outboxEventId. Scheduler jobs (e.g.
  // SLA_EVALUATION) have `data: {}` and must be routed away by the worker
  // processor before reaching this function. If we get here without an
  // outboxEventId, fail fast with a clear error rather than a confusing Zod
  // schema-validation failure.
  if (
    !job.data ||
    typeof job.data !== "object" ||
    !("outboxEventId" in job.data)
  ) {
    throw new Error(
      `processOutboxJob received a non-outbox job (name=${job.name ?? "unknown"}). ` +
        `This indicates a routing bug in the worker processor.`,
    );
  }

  const parsed = OutboxJobSchema.parse(job.data);
  const eventType = parsed.eventType;
  const attempt = resolveAttempt(job, parsed.attempt);

  const logContext = {
    outboxEventId: parsed.outboxEventId,
    jobId: job.id,
    eventType,
    attempt,
  };

  const handler = getHandler(eventType);

  const event = await prisma.outboxEvent.findUnique({
    where: { id: parsed.outboxEventId },
  });

  if (!event) {
    warn('Outbox event not found, skipping job', logContext);
    return { handled: false };
  }

  if (event.failedAt !== null) {
    info('Outbox event permanently failed, skipping job', logContext);
    return { handled: false };
  }

  if (event.processedAt !== null && event.processedAt <= new Date()) {
    info('Outbox event already processed, skipping job', logContext);
    return { handled: false };
  }

  const eventRecord = event as unknown as OutboxEventRecord;
  const startedAt = Date.now();

  info('Handler starting', logContext);

  try {
    const handlerResult: OutboxHandlerResult | void = await handler(eventRecord);
    const durationMs = Date.now() - startedAt;

    if (isFailureResult(handlerResult)) {
      if (handlerResult.error.retryable) {
        warn('Handler returned retryable failure', {
          ...logContext,
          durationMs,
          error: handlerResult.error.message,
        });
        throw new RetryableError(handlerResult.error.message);
      }
      logError('Handler returned permanent failure', {
        ...logContext,
        durationMs,
        error: handlerResult.error.message,
      });
      throw new PermanentError(handlerResult.error.message);
    }

    await markOutboxEventProcessed(prisma, event.id);
    info('Job completed successfully', { ...logContext, durationMs });
    return { handled: true };
  } catch (error) {
    const durationMs = Date.now() - startedAt;

    if (error instanceof PermanentError) {
      await markOutboxEventPermanentlyFailed(prisma, event.id, error);
      logError('Job permanently failed', {
        ...logContext,
        durationMs,
        error: error.message,
      });
    } else {
      await recordOutboxFailure(prisma, event.id, error);
      warn('Job failed with retryable error', {
        ...logContext,
        durationMs,
        error: error instanceof Error ? error.message : String(error),
      });
    }

    const errorMessage = error instanceof Error ? error.message : String(error);
    throw new Error(`Outbox job failed for ${eventRecord.eventType} ${event.id}: ${errorMessage}`);
  }
}
