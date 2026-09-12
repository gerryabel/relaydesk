import { prisma } from "@/lib/db/prisma";
import { PermanentError } from "@/lib/queue/errors";
import type { OutboxEventRecord } from "@/lib/outbox/types";
import type { OutboxHandlerResult } from "./types";

export interface SlaAtRiskPayload {
  ticketId: string;
  slaType: "response" | "resolution";
  workspaceId: string;
  assignedToId: string | null;
}

function extractPayload(event: OutboxEventRecord): SlaAtRiskPayload {
  const payload = event.payload;

  if (
    typeof payload.ticketId !== "string" ||
    typeof payload.workspaceId !== "string" ||
    (payload.slaType !== "response" && payload.slaType !== "resolution")
  ) {
    throw new PermanentError(
      `Invalid SLA_AT_RISK payload for event ${event.id}: missing or invalid fields`,
    );
  }

  return {
    ticketId: payload.ticketId,
    slaType: payload.slaType as "response" | "resolution",
    workspaceId: payload.workspaceId,
    assignedToId:
      typeof payload.assignedToId === "string" ? payload.assignedToId : null,
  };
}

/**
 * Handler for SLA_AT_RISK outbox events.
 *
 * Creates an in-app notification for the ticket's assignee. This handler
 * runs in the background worker, so it must NOT depend on HTTP session
 * context or getCurrentMembership(). It verifies workspace membership
 * directly against the database, following the same pattern as
 * createTicketAssignedNotification in src/lib/notifications/server.ts.
 *
 * Idempotency: The handler uses `outboxEventId` as a unique key on the
 * Notification. If the notification insert fails with a unique constraint
 * violation (P2002), it means this OutboxEvent already created its
 * notification (e.g., a crash between notification creation and
 * markOutboxEventProcessed, followed by a BullMQ retry). In that case the
 * handler returns success as a safe no-op. The unique constraint also
 * guarantees exactly-one notification under concurrent duplicate processing.
 */
export async function handleSlaAtRiskEvent(
  event: OutboxEventRecord,
): Promise<OutboxHandlerResult> {
  const payload = extractPayload(event);

  // Unassigned ticket: skip notification safely.
  if (!payload.assignedToId) {
    return { status: "success" };
  }

  const slaTypeLabel = payload.slaType === "response" ? "response" : "resolution";

  // Verify the assignee belongs to the ticket's workspace.
  const membership = await prisma.membership.findFirst({
    where: { userId: payload.assignedToId, workspaceId: payload.workspaceId },
    select: { id: true },
  });

  if (!membership) {
    throw new PermanentError(
      `Assignee ${payload.assignedToId} is not a member of workspace ${payload.workspaceId}`,
    );
  }

  // Verify the ticket still exists.
  const ticket = await prisma.ticket.findFirst({
    where: { id: payload.ticketId, workspaceId: payload.workspaceId },
    select: { id: true },
  });

  if (!ticket) {
    throw new PermanentError(
      `Ticket ${payload.ticketId} not found in workspace ${payload.workspaceId}`,
    );
  }

  // Create the notification with outboxEventId as the idempotency key.
  // If this OutboxEvent has already created its notification (e.g., due to
  // a retry after a crash), the unique constraint will raise P2002 and we
  // return success as a safe no-op.
  try {
    await prisma.notification.create({
      data: {
        userId: payload.assignedToId,
        workspaceId: payload.workspaceId,
        ticketId: payload.ticketId,
        type: "SLA_AT_RISK",
        title: "SLA at risk",
        body: `Ticket #${payload.ticketId} is approaching its ${slaTypeLabel} SLA deadline.`,
        outboxEventId: event.id,
      },
    });
  } catch (error) {
    if (isUniqueConstraintError(error)) {
      // Notification already exists for this OutboxEvent — safe no-op.
      return { status: "success" };
    }
    throw error;
  }

  return { status: "success" };
}

function isUniqueConstraintError(error: unknown): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    (error as { code?: string }).code === "P2002"
  );
}
