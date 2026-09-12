import { z } from 'zod';

export const OutboxJobSchema = z.object({
  outboxEventId: z.string().min(1),
  eventType: z.string().min(1),
  aggregateType: z.string().min(1),
  aggregateId: z.string().min(1),
  payload: z.record(z.string(), z.unknown()),
  attempt: z.number().int().min(0),
});

export function validateOutboxJob(data) {
  return OutboxJobSchema.parse(data);
}
