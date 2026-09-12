import { prisma } from "@/lib/db/prisma";
import {
  getResponseSlaMonitoringStatus,
  getResolutionSlaMonitoringStatus,
  type SlaMonitoringStatus,
} from "@/lib/tickets/sla";
import { createOutboxEvent } from "@/lib/outbox/outbox";
import type { SlaType } from "./duplicate-suppression";

export const SLA_EVALUATION_BATCH_SIZE = 100;

export interface SlaAtRiskResult {
  ticketId: string;
  slaType: SlaType;
}

export interface SlaEvaluationSummary {
  evaluated: number;
  atRisk: SlaAtRiskResult[];
  cleared: number;
  errors: Array<{ ticketId: string; error: string }>;
}

/**
 * Runs a single SLA evaluation pass over all active tickets.
 *
 * Active tickets are those with status NOT IN ('resolved', 'closed') and
 * at least one non-null SLA deadline. Evaluation reuses the existing SLA
 * domain functions from src/lib/tickets/sla.ts — no logic is duplicated.
 *
 * Each ticket is evaluated with a single consistent timestamp so that
 * boundary decisions are stable across both SLA types.
 *
 * Per-ticket errors are caught and logged; they do not abort the entire
 * evaluation job (only infrastructural failures should trigger a retry).
 */
export async function runSlaEvaluation(
  now: Date = new Date(),
): Promise<SlaEvaluationSummary> {
  const summary: SlaEvaluationSummary = {
    evaluated: 0,
    atRisk: [],
    cleared: 0,
    errors: [],
  };

  let offset = 0;

  for (;;) {
    const tickets = await prisma.ticket.findMany({
      where: {
        status: { notIn: ["resolved", "closed"] },
        OR: [
          { responseSlaDeadline: { not: null } },
          { resolutionSlaDeadline: { not: null } },
        ],
      },
      select: {
        id: true,
        workspaceId: true,
        assignedToId: true,
        createdAt: true,
        responseSlaDeadline: true,
        resolutionSlaDeadline: true,
        firstResponseAt: true,
        resolvedAt: true,
      },
      orderBy: { createdAt: "asc" },
      skip: offset,
      take: SLA_EVALUATION_BATCH_SIZE,
    });

    if (tickets.length === 0) {
      break;
    }

    for (const ticket of tickets) {
      try {
        const result = await evaluateTicket(ticket, now);
        summary.evaluated += 1;

        if (result.cleared > 0) {
          summary.cleared += result.cleared;
        }
        if (result.atRisk.length > 0) {
          summary.atRisk.push(...result.atRisk);
        }
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        summary.errors.push({ ticketId: ticket.id, error: message });
      }
    }

    if (tickets.length < SLA_EVALUATION_BATCH_SIZE) {
      break;
    }

    offset += SLA_EVALUATION_BATCH_SIZE;
  }

  return summary;
}

interface TicketSlaFields {
  id: string;
  workspaceId: string;
  assignedToId: string | null;
  createdAt: Date;
  responseSlaDeadline: Date | null;
  resolutionSlaDeadline: Date | null;
  firstResponseAt: Date | null;
  resolvedAt: Date | null;
}

interface TicketEvaluationResult {
  atRisk: SlaAtRiskResult[];
  cleared: number;
}

async function evaluateTicket(
  ticket: TicketSlaFields,
  now: Date,
): Promise<TicketEvaluationResult> {
  const result: TicketEvaluationResult = { atRisk: [], cleared: 0 };

  const responseStatus = getResponseSlaMonitoringStatus(
    ticket.responseSlaDeadline,
    ticket.firstResponseAt,
    ticket.createdAt,
    now,
  );

  const resolutionStatus = getResolutionSlaMonitoringStatus(
    ticket.resolutionSlaDeadline,
    ticket.resolvedAt,
    ticket.createdAt,
    now,
  );

  // Handle response SLA type.
  const responseOutcome = await evaluateSlaType(
    ticket,
    "response",
    responseStatus,
    now,
  );
  if (responseOutcome === "at_risk") {
    result.atRisk.push({ ticketId: ticket.id, slaType: "response" });
  } else if (responseOutcome === "cleared") {
    result.cleared += 1;
  }

  // Handle resolution SLA type.
  const resolutionOutcome = await evaluateSlaType(
    ticket,
    "resolution",
    resolutionStatus,
    now,
  );
  if (resolutionOutcome === "at_risk") {
    result.atRisk.push({ ticketId: ticket.id, slaType: "resolution" });
  } else if (resolutionOutcome === "cleared") {
    result.cleared += 1;
  }

  return result;
}

type SlaTypeOutcome = "at_risk" | "cleared" | "none";

async function evaluateSlaType(
  ticket: TicketSlaFields,
  slaType: SlaType,
  status: SlaMonitoringStatus,
  now: Date,
): Promise<SlaTypeOutcome> {
  if (status === "at_risk") {
    const claimed = await claimSlotForTicket(ticket.id, slaType, now);
    if (claimed) {
      await createSlaAtRiskOutboxEvent(ticket, slaType, now);
      return "at_risk";
    }
    return "none";
  }

  if (status === "breached" || status === "completed") {
    // Clear the suppression slot for this specific SLA type so that a
    // future re-entry into at_risk can generate a new notification.
    await releaseSlotForType(ticket.id, slaType);
    return "cleared";
  }

  // on_track or not_applicable: leave suppression state untouched.
  return "none";
}

async function claimSlotForTicket(
  ticketId: string,
  slaType: SlaType,
  now: Date,
): Promise<boolean> {
  const { claimNotificationSlot } = await import("./duplicate-suppression");
  const result = await claimNotificationSlot(prisma, ticketId, slaType, now);
  return result.claimed;
}

async function createSlaAtRiskOutboxEvent(
  ticket: TicketSlaFields,
  slaType: SlaType,
  now: Date,
): Promise<void> {
  try {
    await prisma.$transaction(async (tx) => {
      await createOutboxEvent(
        {
          eventType: "SLA_AT_RISK",
          aggregateType: "Ticket",
          aggregateId: ticket.id,
          payload: {
            ticketId: ticket.id,
            slaType,
            workspaceId: ticket.workspaceId,
            assignedToId: ticket.assignedToId,
          },
        },
        tx,
      );
    });
  } catch (error) {
    // Outbox creation failed — release the suppression slot so future
    // evaluations can retry. Without this, the slot would be permanently
    // claimed and no notification would ever be delivered.
    const { releaseNotificationSlot } = await import("./duplicate-suppression");
    await releaseNotificationSlot(prisma, ticket.id, slaType, now);
    throw error;
  }
}

async function releaseSlotForType(
  ticketId: string,
  slaType: SlaType,
): Promise<void> {
  const { clearNotificationSlotForType } = await import("./duplicate-suppression");
  await clearNotificationSlotForType(prisma, ticketId, slaType);
}
