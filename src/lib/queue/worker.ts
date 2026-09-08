import { OutboxJobSchema } from './job-types';
import { getHandler } from './handlers/registry';
import { claimNextOutboxEvent, markOutboxEventProcessed, markOutboxEventFailed } from '@/lib/outbox/outbox';
import { prisma } from '@/lib/db/prisma';

export async function processOutboxJob(job: { id: string; data: unknown }) {
  const parsed = OutboxJobSchema.parse(job.data);
  const handler = getHandler(parsed.eventType);

  const result = await claimNextOutboxEvent(prisma, parsed.attempt);

  if (!result.claimed || !result.event) {
    return { handled: false };
  }

  try {
    await handler(result.event);

    await markOutboxEventProcessed(prisma, result.event.id);

    return { handled: true };
  } catch (error) {
    await markOutboxEventFailed(prisma, result.event.id, error);

    throw error;
  }
}
