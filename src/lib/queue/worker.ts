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

function isFailureResult(result: unknown): result is { status: 'failure'; error: { message: string; retryable: boolean } } {
  return typeof result === 'object' && result !== null && 'status' in result && (result as { status: string }).status === 'failure';
}

export async function processOutboxJob(job: { id: string; data: unknown }): Promise<{ handled: boolean }> {
  const parsed = OutboxJobSchema.parse(job.data);
  const handler = getHandler(parsed.eventType);

  const event = await prisma.outboxEvent.findUnique({
    where: { id: parsed.outboxEventId },
  });

  if (!event) {
    return { handled: false };
  }

  if (event.failedAt !== null) {
    return { handled: false };
  }

  if (event.processedAt !== null && event.processedAt <= new Date()) {
    return { handled: false };
  }

  const eventRecord = event as unknown as OutboxEventRecord;

  try {
    const handlerResult: OutboxHandlerResult | void = await handler(eventRecord);

    if (isFailureResult(handlerResult)) {
      if (handlerResult.error.retryable) {
        throw new RetryableError(handlerResult.error.message);
      }
      throw new PermanentError(handlerResult.error.message);
    }

    await markOutboxEventProcessed(prisma, event.id);
    return { handled: true };
  } catch (error) {
    if (error instanceof PermanentError) {
      await markOutboxEventPermanentlyFailed(prisma, event.id, error);
    } else {
      await recordOutboxFailure(prisma, event.id, error);
    }

    const errorMessage = error instanceof Error ? error.message : String(error);
    throw new Error(`Outbox job failed for ${eventRecord.eventType} ${event.id}: ${errorMessage}`);
  }
}
