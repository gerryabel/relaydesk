import { OutboxJobSchema } from './job-types';
import { getHandler } from './handlers/registry';
import { claimNextOutboxEvent, markOutboxEventProcessed, recordOutboxFailure } from '@/lib/outbox/outbox';
import { prisma } from '@/lib/db/prisma';
import type { OutboxHandlerResult } from './handlers/types';
import { PermanentError, RetryableError } from '@/lib/queue/errors';

function isFailureResult(result: unknown): result is { status: 'failure'; error: { message: string; retryable: boolean } } {
  return typeof result === 'object' && result !== null && 'status' in result && (result as { status: string }).status === 'failure';
}

export async function processOutboxJob(job: { id: string; data: unknown }): Promise<{ handled: boolean }> {
  const parsed = OutboxJobSchema.parse(job.data);
  const handler = getHandler(parsed.eventType);

  const result = await claimNextOutboxEvent(prisma, parsed.attempt);
  if (!result.claimed || !result.event) {
    return { handled: false };
  }

  try {
    const handlerResult: OutboxHandlerResult | void = await handler(result.event);

    if (isFailureResult(handlerResult)) {
      if (handlerResult.error.retryable) {
        throw new RetryableError(handlerResult.error.message);
      }
      throw new PermanentError(handlerResult.error.message);
    }

    await markOutboxEventProcessed(prisma, result.event.id);
    return { handled: true };
  } catch (error) {
    await recordOutboxFailure(prisma, result.event.id, error);
    const errorMessage = error instanceof Error ? error.message : String(error);
    throw new Error(`Outbox job failed for ${result.event.eventType} ${result.event.id}: ${errorMessage}`);
  }
}
