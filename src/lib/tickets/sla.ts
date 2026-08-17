export type TicketPriority = 'low' | 'medium' | 'high' | 'urgent';

export type SlaPolicy = {
  priority: TicketPriority;
  responseDurationMs: number | null;
  resolutionDurationMs: number | null;
};

export type SlaStatus = 'pending' | 'completed' | 'overdue';

export type SlaMonitoringStatus = 'on_track' | 'at_risk' | 'breached' | 'completed' | 'not_applicable';

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

export const AT_RISK_THRESHOLD_RATIO = 0.8;

export function getSlaPolicyDurationMs(deadline: Date | null, policyDurationMs: number | null): number | null {
  if (!deadline || policyDurationMs == null) {
    return null;
  }

  return policyDurationMs;
}

export function getElapsedRatio(deadline: Date | null, createdAt: Date | null, now: Date): number | null {
  if (!deadline || !createdAt) {
    return null;
  }

  const duration = deadline.getTime() - createdAt.getTime();

  if (duration <= 0) {
    return 1;
  }

  const elapsed = now.getTime() - createdAt.getTime();

  if (elapsed <= 0) {
    return 0;
  }

  if (elapsed >= duration) {
    return 1;
  }

  return elapsed / duration;
}

export function getSlaRemainingMsFromNow(deadline: Date | null, now: Date): number | null {
  if (!deadline) {
    return null;
  }

  return deadline.getTime() - now.getTime();
}

export function isSlaOverdue(deadline: Date | null, completedAt: Date | null, now: Date): boolean {
  if (!deadline) {
    return false;
  }

  if (completedAt) {
    return completedAt.getTime() > deadline.getTime();
  }

  return now.getTime() > deadline.getTime();
}

export function getResponseSlaMonitoringStatus(
  deadline: Date | null,
  firstResponseAt: Date | null,
  createdAt: Date | null,
  now: Date,
): SlaMonitoringStatus {
  if (!deadline || !createdAt) {
    return 'not_applicable';
  }

  if (firstResponseAt && firstResponseAt.getTime() <= deadline.getTime()) {
    return 'completed';
  }

  if (firstResponseAt && firstResponseAt.getTime() > deadline.getTime()) {
    return 'breached';
  }

  if (now.getTime() >= deadline.getTime()) {
    return 'breached';
  }

  const elapsedRatio = getElapsedRatio(deadline, createdAt, now);

  if (elapsedRatio == null) {
    return 'not_applicable';
  }

  return elapsedRatio >= AT_RISK_THRESHOLD_RATIO ? 'at_risk' : 'on_track';
}

export function getResolutionSlaMonitoringStatus(
  deadline: Date | null,
  resolvedAt: Date | null,
  createdAt: Date | null,
  now: Date,
): SlaMonitoringStatus {
  if (!deadline || !createdAt) {
    return 'not_applicable';
  }

  if (resolvedAt && resolvedAt.getTime() <= deadline.getTime()) {
    return 'completed';
  }

  if (resolvedAt && resolvedAt.getTime() > deadline.getTime()) {
    return 'breached';
  }

  if (now.getTime() >= deadline.getTime()) {
    return 'breached';
  }

  const elapsedRatio = getElapsedRatio(deadline, createdAt, now);

  if (elapsedRatio == null) {
    return 'not_applicable';
  }

  return elapsedRatio >= AT_RISK_THRESHOLD_RATIO ? 'at_risk' : 'on_track';
}
