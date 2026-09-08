import type { Prisma } from '@/generated/prisma';

export type OutboxEventType = 'TICKET_ASSIGNED';

export type OutboxAggregateType = 'Ticket';

export type OutboxPayload = Record<string, unknown>;

export type CreateOutboxEventInput = {
  eventType: OutboxEventType;
  aggregateType: OutboxAggregateType;
  aggregateId: string;
  payload: OutboxPayload;
};

export async function createOutboxEvent(
  input: CreateOutboxEventInput,
  tx: Prisma.TransactionClient,
): Promise<void> {
  await tx.outboxEvent.create({
    data: {
      eventType: input.eventType,
      aggregateType: input.aggregateType,
      aggregateId: input.aggregateId,
      payload: input.payload as Prisma.InputJsonValue,
    },
  });
}
