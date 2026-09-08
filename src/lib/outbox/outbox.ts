import { z } from 'zod';
import type { Prisma } from '@/generated/prisma';
import type { OutboxEventType, OutboxAggregateType, OutboxPayload, OutboxEventRecord, DispatchOutboxEventInput } from './types';

const DispatchInputSchema = z.object({
  eventType: z.custom<OutboxEventType>((val) => typeof val === 'string'),
  aggregateType: z.custom<OutboxAggregateType>((val) => typeof val === 'string'),
  aggregateId: z.string().min(1),
  payload: z.record(z.string(), z.unknown()),
});

export type CreateOutboxEventInput = z.infer<typeof DispatchInputSchema>;

export async function createOutboxEvent(
  input: CreateOutboxEventInput,
  tx: Prisma.TransactionClient,
): Promise<void> {
  const parsed = DispatchInputSchema.parse(input);

  await tx.outboxEvent.create({
    data: {
      eventType: parsed.eventType,
      aggregateType: parsed.aggregateType,
      aggregateId: parsed.aggregateId,
      payload: parsed.payload as Prisma.InputJsonValue,
    },
  });
}

export const DEFAULT_CLAIM_LEASE_MS = 5 * 60 * 1000;

export interface ClaimOutboxEventResult {
  event: OutboxEventRecord | null;
  claimed: boolean;
}

export async function claimNextOutboxEvent(
  tx: Prisma.TransactionClient,
  leaseMs = DEFAULT_CLAIM_LEASE_MS,
): Promise<ClaimOutboxEventResult> {
  const leaseDeadline = new Date(Date.now() + leaseMs);

  const event = await tx.outboxEvent.findFirst({
    where: {
      OR: [
        { processedAt: null },
        { processedAt: { lt: new Date() } },
      ],
    },
    orderBy: { createdAt: 'asc' },
    select: {
      id: true,
      eventType: true,
      aggregateType: true,
      aggregateId: true,
      payload: true,
      createdAt: true,
      processedAt: true,
      attempts: true,
      lastError: true,
    },
  });

  if (!event) {
    return { event: null, claimed: false };
  }

  const wasPending = event.processedAt === null;

  const { count } = await tx.outboxEvent.updateMany({
    where: {
      id: event.id,
      ...(wasPending ? { processedAt: null } : { processedAt: { lt: new Date() } }),
    },
    data: {
      processedAt: leaseDeadline,
      attempts: { increment: 1 },
      lastError: null,
    },
  });

  if (count === 0) {
    return { event: null, claimed: false };
  }

  return {
    event: {
      ...event,
      processedAt: leaseDeadline,
      attempts: event.attempts + 1,
    } as OutboxEventRecord,
    claimed: true,
  };
}

export async function markOutboxEventProcessed(
  tx: Prisma.TransactionClient,
  outboxEventId: string,
): Promise<void> {
  await tx.outboxEvent.updateMany({
    where: { id: outboxEventId },
    data: { processedAt: new Date() },
  });
}

export async function markOutboxEventFailed(
  tx: Prisma.TransactionClient,
  outboxEventId: string,
  error: unknown,
): Promise<void> {
  await tx.outboxEvent.updateMany({
    where: { id: outboxEventId },
    data: {
      processedAt: null,
      attempts: { increment: 1 },
      lastError: error instanceof Error ? error.message : String(error),
    },
  });
}
