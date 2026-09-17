import { prisma } from '@/lib/db/prisma';
import { getCurrentMembership } from '@/lib/workspace/server';
import { ACTIONABLE_STATUSES } from '@/lib/tickets/queue';
import {
  getResponseSlaMonitoringStatus,
  getResolutionSlaMonitoringStatus,
} from '@/lib/tickets/sla';
import { ticketStatusSchema } from '@/lib/tickets/schema';
import type { TicketStatus, TicketPriority } from '@/generated/prisma';
import { z } from 'zod';

type Status = z.infer<typeof ticketStatusSchema>;

/**
 * Agent Workload — computed from current Ticket and Membership/User data.
 *
 * No new persistence, counters, or background aggregation. All metrics are
 * derived from existing ticket assignment, status, priority, and SLA data.
 *
 * Definitions (see docs/phase-7/spec.md §5.4 and docs/phase-7/task-4.md):
 *  - totalAssigned: all currently assigned tickets, regardless of status
 *  - open/inProgress/waitingCustomer/resolved/closed: per-status counts
 *  - active: open + in_progress + waiting_customer
 *  - highPriority: actionable assigned tickets with priority = high
 *  - urgent: actionable assigned tickets with priority = urgent
 *  - slaAtRisk: actionable assigned tickets where response OR resolution SLA
 *    monitoring returns 'at_risk'. A ticket at risk in both counts once.
 *
 * No arbitrary capacity thresholds (overloaded/underutilized) are introduced.
 */

export type AgentWorkload = {
  userId: string;
  name: string;
  email: string;
  image: string | null;
  role: 'owner' | 'member';
  joinedAt: string;
  totalAssigned: number;
  open: number;
  inProgress: number;
  waitingCustomer: number;
  resolved: number;
  closed: number;
  active: number;
  highPriority: number;
  urgent: number;
  slaAtRisk: number;
};

export type WorkloadSummary = {
  totalAssigned: number;
  active: number;
  highPriority: number;
  urgent: number;
  slaAtRisk: number;
  memberCount: number;
};

export type WorkloadResult = {
  members: AgentWorkload[];
  summary: WorkloadSummary;
};

type WorkspaceMemberRow = {
  userId: string;
  role: 'owner' | 'member';
  createdAt: Date;
  user: {
    id: string;
    name: string;
    email: string;
    image: string | null;
  };
};

type AssignedTicketRow = {
  assignedToId: string | null;
  status: TicketStatus;
  priority: TicketPriority;
  createdAt: Date;
  responseSlaDeadline: Date | null;
  resolutionSlaDeadline: Date | null;
  firstResponseAt: Date | null;
  resolvedAt: Date | null;
};

function isActionable(status: Status): boolean {
  return ACTIONABLE_STATUSES.has(status);
}

function isAtRisk(ticket: AssignedTicketRow, now: Date): boolean {
  const responseStatus = getResponseSlaMonitoringStatus(
    ticket.responseSlaDeadline,
    ticket.firstResponseAt,
    ticket.createdAt,
    now,
  );
  if (responseStatus === 'at_risk') {
    return true;
  }
  const resolutionStatus = getResolutionSlaMonitoringStatus(
    ticket.resolutionSlaDeadline,
    ticket.resolvedAt,
    ticket.createdAt,
    now,
  );
  return resolutionStatus === 'at_risk';
}

function emptyWorkload(member: WorkspaceMemberRow): AgentWorkload {
  return {
    userId: member.userId,
    name: member.user.name,
    email: member.user.email,
    image: member.user.image,
    role: member.role,
    joinedAt: member.createdAt.toISOString(),
    totalAssigned: 0,
    open: 0,
    inProgress: 0,
    waitingCustomer: 0,
    resolved: 0,
    closed: 0,
    active: 0,
    highPriority: 0,
    urgent: 0,
    slaAtRisk: 0,
  };
}

/**
 * Computes agent workload for the current workspace.
 *
 * Workspace isolation: the workspace is derived server-side from the
 * authenticated membership via getCurrentMembership(). No client-supplied
 * workspace identifier is trusted. Members and tickets are both queried
 * scoped to that workspace, so a member from Workspace A can never see
 * workload data from Workspace B.
 *
 * Query strategy:
 *  1. Resolve the current workspace from the session.
 *  2. Fetch all workspace members (single query, scoped to workspaceId).
 *  3. Fetch all assigned tickets for the workspace (single query,
 *     scoped to workspaceId with non-null assignedToId).
 *  4. Aggregate counts in memory and evaluate SLA risk with the existing
 *     SLA helper functions.
 *
 * This avoids N+1 queries: two workspace-scoped queries, then in-memory
 * aggregation. Zero-work members are still represented so the distribution
 * across the whole workspace is understandable.
 */
export async function getWorkload(): Promise<WorkloadResult> {
  const membership = await getCurrentMembership();
  const workspaceId = membership.workspaceId;
  const now = new Date();

  const [memberRows, ticketRows] = await Promise.all([
    prisma.membership.findMany({
      where: { workspaceId },
      include: {
        user: {
          select: { id: true, name: true, email: true, image: true },
        },
      },
      orderBy: { user: { name: 'asc' } },
    }),
    prisma.ticket.findMany({
      where: {
        workspaceId,
        assignedToId: { not: null },
      },
      select: {
        assignedToId: true,
        status: true,
        priority: true,
        createdAt: true,
        responseSlaDeadline: true,
        resolutionSlaDeadline: true,
        firstResponseAt: true,
        resolvedAt: true,
      },
    }),
  ]);

  const workloadByUserId = new Map<string, AgentWorkload>();

  for (const member of memberRows) {
    workloadByUserId.set(member.userId, emptyWorkload(member));
  }

  for (const ticket of ticketRows) {
    const assigneeId = ticket.assignedToId;
    if (!assigneeId) {
      continue;
    }

    const workload = workloadByUserId.get(assigneeId);
    if (!workload) {
      // Ticket assigned to a user that is not a current workspace member.
      // Skip — workload is computed over current workspace members only.
      continue;
    }

    workload.totalAssigned += 1;

    switch (ticket.status as Status) {
      case 'open':
        workload.open += 1;
        break;
      case 'in_progress':
        workload.inProgress += 1;
        break;
      case 'waiting_customer':
        workload.waitingCustomer += 1;
        break;
      case 'resolved':
        workload.resolved += 1;
        break;
      case 'closed':
        workload.closed += 1;
        break;
    }

    if (isActionable(ticket.status as Status)) {
      workload.active += 1;

      if (ticket.priority === 'high') {
        workload.highPriority += 1;
      }
      if (ticket.priority === 'urgent') {
        workload.urgent += 1;
      }
      if (isAtRisk(ticket, now)) {
        workload.slaAtRisk += 1;
      }
    }
  }

  const members = Array.from(workloadByUserId.values());

  const summary: WorkloadSummary = {
    totalAssigned: 0,
    active: 0,
    highPriority: 0,
    urgent: 0,
    slaAtRisk: 0,
    memberCount: members.length,
  };

  for (const workload of members) {
    summary.totalAssigned += workload.totalAssigned;
    summary.active += workload.active;
    summary.highPriority += workload.highPriority;
    summary.urgent += workload.urgent;
    summary.slaAtRisk += workload.slaAtRisk;
  }

  return { members, summary };
}
