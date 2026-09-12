import { prisma } from '@/lib/db/prisma';
import { claimNextOutboxEvent } from '@/lib/outbox/outbox';
import { OutboxJobSchema } from './job-types';
import { EMAIL_RETRY_POLICY } from './retry-policy';
import { getQueue } from './producer';

export async function enqueueOutboxJob(
  event: { id: string; eventType: string; aggregateType: string; aggregateId: string; payload: Record<string, unknown> },
  queue: { add: (name: string, data: unknown, opts?: { attempts?: number; backoff?: { type?: 'fixed' | 'exponential'; delay?: number } }) => Promise<{ id: string }> },
) {
  const data = OutboxJobSchema.parse({
    outboxEventId: event.id,
    eventType: event.eventType,
    aggregateType: event.aggregateType,
    aggregateId: event.aggregateId,
    payload: event.payload,
    attempt: 0,
  });

  const backoffType = EMAIL_RETRY_POLICY.backoffType === 'exponential' ? 'exponential' : 'fixed';
  const backoff = backoffType === 'exponential'
    ? { type: 'exponential' as const, delay: EMAIL_RETRY_POLICY.backoffDelayMs }
    : { type: 'fixed' as const, delay: EMAIL_RETRY_POLICY.backoffDelayMs };

  return queue.add('outbox-event', data, {
    attempts: EMAIL_RETRY_POLICY.maxAttempts,
    backoff,
  });
}

export interface DispatchResult {
  dispatched: boolean;
  eventId?: string;
}

export async function dispatchNextOutboxEvent(): Promise<DispatchResult> {
  const claimed = await claimNextOutboxEvent(prisma);

  if (!claimed.claimed || !claimed.event) {
    return { dispatched: false };
  }

  const queue = getQueue() as Parameters<typeof enqueueOutboxJob>[1];
  await enqueueOutboxJob(claimed.event, queue);

  return { dispatched: true, eventId: claimed.event.id };
}
