import type { PrismaClient, Prisma } from '@/generated/prisma';
import { createOutboxEvent } from '@/lib/outbox/outbox';

export type SlaType = 'response' | 'resolution';

export interface ClaimBreachResult {
  claimed: boolean;
  isNew: boolean;
}

export async function claimBreachSlot(
  db: PrismaClient | Prisma.TransactionClient,
  ticketId: string,
  slaType: SlaType,
  now: Date = new Date(),
): Promise<ClaimBreachResult> {
  try {
    await db.sentSlaBreachNotification.create({
      data: { ticketId, slaType, sentAt: now },
    });
    return { claimed: true, isNew: true };
  } catch (error) {
    if (!isUniqueConstraintError(error)) {
      throw error;
    }
  }

  return { claimed: false, isNew: false };
}

export async function createSlaBreachedOutboxEvent(
  ticketId: string,
  slaType: SlaType,
  workspaceId: string,
  assignedToId: string | null,
  tx: Prisma.TransactionClient,
): Promise<void> {
  await createOutboxEvent(
    {
      eventType: 'SLA_BREACHED',
      aggregateType: 'Ticket',
      aggregateId: ticketId,
      payload: {
        ticketId,
        slaType,
        workspaceId,
        assignedToId,
      },
    },
    tx,
  );
}

function isUniqueConstraintError(error: unknown): boolean {
  return (
    typeof error === 'object' &&
    error !== null &&
    'code' in error &&
    (error as { code?: string }).code === 'P2002'
  );
}
