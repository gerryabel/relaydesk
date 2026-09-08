import { OutboxJobSchema } from './job-types';

export async function enqueueOutboxJob(
  event: { id: string; eventType: string; aggregateType: string; aggregateId: string; payload: Record<string, unknown> },
  queue: { add: (name: string, data: unknown, opts?: { attempts: number }) => Promise<{ id: string }> },
) {
  const data = OutboxJobSchema.parse({
    outboxEventId: event.id,
    eventType: event.eventType,
    aggregateType: event.aggregateType,
    aggregateId: event.aggregateId,
    payload: event.payload,
    attempt: 0,
  });

  return queue.add('outbox-event', data, { attempts: 3 });
}

export async function dispatchNextOutboxEvent() {
  // Task 3 stub: dispatcher loop will be implemented here.
  return { dispatched: false };
}
