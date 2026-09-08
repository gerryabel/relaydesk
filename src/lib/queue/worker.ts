import { OutboxJobSchema } from './job-types';
import { getHandler } from './handlers/registry';
import { claimNextOutboxEvent, markOutboxEventProcessed, markOutboxEventFailed } from '@/lib/outbox/outbox';
import { prisma } from '@/lib/db/prisma';
import type { OutboxHandlerResult } from './handlers/types';

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
      const error = new Error(handlerResult.error.message);
      await markOutboxEventFailed(prisma, result.event.id, error);
      throw error;
    }

    await markOutboxEventProcessed(prisma, result.event.id);
    return { handled: true };
  } catch (error) {
    await markOutboxEventFailed(prisma, result.event.id, error);
    throw error;
  }
}