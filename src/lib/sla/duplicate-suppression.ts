import type { Prisma, PrismaClient } from "@/generated/prisma";

export const DEFAULT_SUPPRESSION_WINDOW_MS = 24 * 60 * 60 * 1000; // 24 hours

export type SlaType = "response" | "resolution";

/**
 * Result of a suppression-slot claim attempt.
 *
 * - `claimed`: true if this evaluator won the slot and may proceed to
 *   create a notification; false if the slot is already held within
 *   the suppression window.
 * - `isNew`: true when the slot was newly created (first notification
 *   for this ticket + slaType); false when an expired slot was reclaimed.
 */
export type ClaimResult = { claimed: boolean; isNew: boolean };

/**
 * Attempts to claim the suppression slot for a given (ticketId, slaType).
 *
 * This is a race-safe compare-and-swap implemented with auto-commit
 * operations (NOT inside a Prisma interactive transaction). A unique
 * constraint violation inside an aborted PostgreSQL transaction cannot
 * be recovered from, so we avoid that pattern entirely.
 *
 * Algorithm:
 *   1. Try to INSERT a new row. On success, this evaluator owns the slot.
 *   2. On P2002 (unique violation), a row already exists:
 *      a. If sentAt is within the suppression window → suppressed.
 *      b. If sentAt is outside the window → atomically UPDATE only if
 *         sentAt is still <= windowStart (compare-and-swap). Only the
 *         evaluator that successfully updates the row wins.
 *
 * @param db - a PrismaClient or TransactionClient for auto-commit use
 * @param ticketId - the ticket id
 * @param slaType - 'response' | 'resolution'
 * @param now - the evaluation timestamp (single consistent instant)
 * @param windowMs - suppression window in milliseconds (default 24h)
 */
export async function claimNotificationSlot(
  db: PrismaClient | Prisma.TransactionClient,
  ticketId: string,
  slaType: SlaType,
  now: Date = new Date(),
  windowMs: number = DEFAULT_SUPPRESSION_WINDOW_MS,
): Promise<ClaimResult> {
  try {
    await db.sentSlaNotification.create({
      data: { ticketId, slaType, sentAt: now },
    });
    return { claimed: true, isNew: true };
  } catch (error) {
    if (!isUniqueConstraintError(error)) {
      throw error;
    }
  }

  // Unique violation: a row already exists. Check if the window expired
  // and attempt an atomic compare-and-swap update.
  const windowStart = new Date(now.getTime() - windowMs);

  const updated = await db.sentSlaNotification.updateMany({
    where: {
      ticketId,
      slaType,
      sentAt: { lte: windowStart },
    },
    data: { sentAt: now },
  });

  if (updated.count > 0) {
    return { claimed: true, isNew: false };
  }

  return { claimed: false, isNew: false };
}

/**
 * Releases a previously claimed suppression slot.
 *
 * Called when outbox event creation fails after a successful claim,
 * so that future evaluations can retry.
 */
export async function releaseNotificationSlot(
  db: PrismaClient | Prisma.TransactionClient,
  ticketId: string,
  slaType: SlaType,
  sentAt: Date,
): Promise<void> {
  await db.sentSlaNotification.deleteMany({
    where: { ticketId, slaType, sentAt },
  });
}

/**
 * Clears all suppression slots for a given ticket.
 *
 * Called when a ticket's SLA status changes to breached or completed,
 * allowing future at-risk notifications if the ticket re-enters the
 * at-risk state.
 */
export async function clearNotificationSlots(
  db: PrismaClient | Prisma.TransactionClient,
  ticketId: string,
): Promise<void> {
  await db.sentSlaNotification.deleteMany({
    where: { ticketId },
  });
}

/**
 * Clears the suppression slot for a specific (ticketId, slaType).
 *
 * Used when only one SLA type changes to breached/completed while the
 * other remains at_risk.
 */
export async function clearNotificationSlotForType(
  db: PrismaClient | Prisma.TransactionClient,
  ticketId: string,
  slaType: SlaType,
): Promise<void> {
  await db.sentSlaNotification.deleteMany({
    where: { ticketId, slaType },
  });
}

function isUniqueConstraintError(error: unknown): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    (error as { code?: string }).code === "P2002"
  );
}
