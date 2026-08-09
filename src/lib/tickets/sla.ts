export type TicketPriority = 'low' | 'medium' | 'high' | 'urgent';

export type SlaPolicy = {
  priority: TicketPriority;
  responseDurationMs: number | null;
  resolutionDurationMs: number | null;
};

export type SlaStatus = 'pending' | 'completed' | 'overdue';

export const DEFAULT_SLA_POLICIES: Record<TicketPriority, SlaPolicy> = {
  low: {
    priority: 'low',
    responseDurationMs: 24 * 60 * 60 * 1000,
    resolutionDurationMs: 5 * 24 * 60 * 60 * 1000,
  },
  medium: {
    priority: 'medium',
    responseDurationMs: 8 * 60 * 60 * 1000,
    resolutionDurationMs: 3 * 24 * 60 * 60 * 1000,
  },
  high: {
    priority: 'high',
    responseDurationMs: 4 * 60 * 60 * 1000,
    resolutionDurationMs: 24 * 60 * 60 * 1000,
  },
  urgent: {
    priority: 'urgent',
    responseDurationMs: 60 * 60 * 1000,
    resolutionDurationMs: 4 * 60 * 60 * 1000,
  },
};

export function getSlaPolicy(priority: TicketPriority): SlaPolicy {
  const policy = DEFAULT_SLA_POLICIES[priority];

  if (!policy || policy.responseDurationMs == null || policy.resolutionDurationMs == null) {
    throw new Error(`SLA policy is not configured yet for priority: ${priority}`);
  }

  return policy;
}

export function calculateResponseDeadline(start: Date, priority: TicketPriority): Date {
  const policy = getSlaPolicy(priority);
  return new Date(start.getTime() + policy.responseDurationMs!);
}

export function calculateResolutionDeadline(start: Date, priority: TicketPriority): Date {
  const policy = getSlaPolicy(priority);
  return new Date(start.getTime() + policy.resolutionDurationMs!);
}

export function getResponseSlaStatus(deadline: Date | null, firstResponseAt: Date | null, now: Date): SlaStatus {
  if (!deadline) {
    return 'pending';
  }

  if (firstResponseAt && firstResponseAt.getTime() <= deadline.getTime()) {
    return 'completed';
  }

  return now.getTime() >= deadline.getTime() ? 'overdue' : 'pending';
}

export function getResolutionSlaStatus(deadline: Date | null, resolvedAt: Date | null, now: Date): SlaStatus {
  if (!deadline) {
    return 'pending';
  }

  if (resolvedAt && resolvedAt.getTime() <= deadline.getTime()) {
    return 'completed';
  }

  return now.getTime() >= deadline.getTime() ? 'overdue' : 'pending';
}
