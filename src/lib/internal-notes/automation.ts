import { prisma } from '@/lib/db/prisma';
import type { Prisma } from '@/generated/prisma';

/**
 * Worker-safe internal note creation for automation.
 *
 * Unlike `createInternalNote` in server.ts, this function does NOT use
 * `getCurrentMembership()` — it accepts explicit actor and workspace
 * context, making it safe to call from a background worker.
 *
 * The note body is prefixed with an automation-origin marker so that
 * automation-created notes are clearly distinguishable in the UI.
 *
 * Idempotency: a stable deduplication key (`automationDedupeKey`) is
 * stored on the InternalNote. If a note with the same key already exists
 * (e.g., due to a BullMQ retry after a crash between note creation and
 * outbox-event completion), the existing note is returned instead of
 * creating a duplicate.
 *
 * @returns the created (or already-existing) internal note.
 */
export async function createAutomationInternalNote(args: {
  ticketId: string;
  workspaceId: string;
  authorId: string;
  body: string;
  /**
   * Stable deduplication key, typically `executionId:actionIndex`.
   * Guarantees at-most-one note per automation action even under redelivery.
   */
  dedupeKey: string;
  tx?: Prisma.TransactionClient;
}) {
  const { ticketId, workspaceId, authorId, body, dedupeKey } = args;
  const client = args.tx ?? prisma;

  // Verify the ticket belongs to the claimed workspace.
  const ticket = await client.ticket.findFirst({
    where: { id: ticketId, workspaceId },
    select: { id: true },
  });
  if (!ticket) {
    throw new Error(`Ticket ${ticketId} not found in workspace ${workspaceId}`);
  }

  // Verify the author is a member of the workspace.
  const authorMembership = await client.membership.findFirst({
    where: { userId: authorId, workspaceId },
    select: { id: true },
  });
  if (!authorMembership) {
    throw new Error(`Author ${authorId} is not a member of workspace ${workspaceId}`);
  }

  // Deduplication: if a note with this automation key already exists, return it.
  const existing = await client.internalNote.findFirst({
    where: { automationDedupeKey: dedupeKey },
    include: {
      author: { select: { id: true, name: true, email: true } },
    },
  });
  if (existing) {
    return existing;
  }

  const markedBody = `[Automation] ${body}`;

  const note = await client.internalNote.create({
    data: {
      ticketId,
      authorId,
      body: markedBody,
      automationDedupeKey: dedupeKey,
    },
    include: {
      author: { select: { id: true, name: true, email: true } },
    },
  });

  await client.ticketActivity.create({
    data: {
      ticketId,
      actorId: authorId,
      type: 'INTERNAL_NOTE_CREATED',
      metadata: { internalNoteId: note.id, automationOrigin: true } as never,
    },
  });

  return note;
}
