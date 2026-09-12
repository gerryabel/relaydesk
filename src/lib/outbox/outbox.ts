import { z } from 'zod';
import { PermanentError } from '@/lib/queue/errors';
import type { Prisma } from '@/generated/prisma';
import type { OutboxEventType, OutboxAggregateType, OutboxEventRecord } from './types';

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
      failedAt: null,
      completedAt: null,
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
      completedAt: true,
      failedAt: true,
      attempts: true,
      lastError: true,
    },
  });

  if (!event || event.failedAt !== null) {
    return { event: null, claimed: false };
  }

  const wasPending = event.processedAt === null;

  const { count } = await tx.outboxEvent.updateMany({
    where: {
      id: event.id,
      failedAt: null,
      completedAt: null,
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
  const completedAt = new Date();
  await tx.outboxEvent.updateMany({
    where: { id: outboxEventId, failedAt: null },
    data: { processedAt: completedAt, completedAt, lastError: null },
  });
}

export async function markOutboxEventPermanentlyFailed(
  tx: Prisma.TransactionClient,
  outboxEventId: string,
  error: unknown,
): Promise<void> {
  const message = error instanceof Error ? error.message : String(error);
  await tx.outboxEvent.updateMany({
    where: { id: outboxEventId, failedAt: null },
    data: {
      failedAt: new Date(),
      lastError: `[task-5:permanent-failure] ${message}`,
    },
  });
}

export async function recordOutboxFailure(
  tx: Prisma.TransactionClient,
  outboxEventId: string,
  error: unknown,
): Promise<void> {
  const message = error instanceof Error ? error.message : String(error);
  const isPermanent = error instanceof PermanentError;

  await tx.outboxEvent.updateMany({
    where: { id: outboxEventId, failedAt: null },
    data: {
      processedAt: null,
      lastError: isPermanent ? `[task-5:permanent-failure] ${message}` : message,
      ...(isPermanent ? { failedAt: new Date() } : {}),
    },
  });
}

/**
 * @deprecated Use `recordOutboxFailure` for new code.
 * Kept for backward compatibility with existing Task 3/4 tests.
 */
export async function markOutboxEventFailed(
  tx: Prisma.TransactionClient,
  outboxEventId: string,
  error: unknown,
): Promise<void> {
  await recordOutboxFailure(tx, outboxEventId, error);
}
