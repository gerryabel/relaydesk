import { prisma } from '@/lib/db/prisma';
import type { Prisma } from '@/generated/prisma';

/**
 * Worker-safe notification creation for automation.
 *
 * Unlike `createNotification` in schema.ts, this function does NOT use
 * `getCurrentMembership()` — it accepts explicit recipient and workspace
 * context, making it safe to call from a background worker.
 *
 * The notification title is prefixed with an automation-origin marker so
 * that automation-created notifications are clearly distinguishable.
 *
 * Idempotency: a stable deduplication key (`automationDedupeKey`) is
 * stored on the Notification. If a notification with the same key already
 * exists (e.g., due to a BullMQ retry after a crash between creation and
 * outbox-event completion), the existing notification is returned instead
 * of creating a duplicate.
 */
export async function createAutomationNotification(args: {
  recipientId: string;
  workspaceId: string;
  ticketId: string | null;
  title: string;
  body: string;
  /**
   * Stable deduplication key, typically `executionId:actionIndex`.
   * Guarantees at-most-one notification per automation action even under redelivery.
   */
  dedupeKey: string;
  tx?: Prisma.TransactionClient;
}) {
  const { recipientId, workspaceId, ticketId, title, body, dedupeKey } = args;
  const client = args.tx ?? prisma;

  // Verify the recipient is a member of the workspace.
  const membership = await client.membership.findFirst({
    where: { userId: recipientId, workspaceId },
    select: { id: true },
  });
  if (!membership) {
    throw new Error(`Recipient ${recipientId} is not a member of workspace ${workspaceId}`);
  }

  // If a ticketId is provided, verify it belongs to the workspace.
  if (ticketId) {
    const ticket = await client.ticket.findFirst({
      where: { id: ticketId, workspaceId },
      select: { id: true },
    });
    if (!ticket) {
      throw new Error(`Ticket ${ticketId} not found in workspace ${workspaceId}`);
    }
  }

  // Deduplication: if a notification with this automation key already exists, return it.
  const existing = await client.notification.findFirst({
    where: { automationDedupeKey: dedupeKey },
    include: {
      ticket: { select: { id: true, title: true, status: true } },
    },
  });
  if (existing) {
    return existing;
  }

  const markedTitle = `[Automation] ${title}`;

  return client.notification.create({
    data: {
      userId: recipientId,
      workspaceId,
      ticketId,
      // Automation notifications use TICKET_ASSIGNED as the closest existing type.
      // The automation-origin marker in the title/body makes the source clear.
      type: 'TICKET_ASSIGNED',
      title: markedTitle,
      body,
      automationDedupeKey: dedupeKey,
    },
    include: {
      ticket: { select: { id: true, title: true, status: true } },
    },
  });
}
