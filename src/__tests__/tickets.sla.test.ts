import { describe, it, expect } from 'vitest';
import { getSlaPolicy, calculateResponseDeadline, calculateResolutionDeadline, getResponseSlaStatus, getResolutionSlaStatus, DEFAULT_SLA_POLICIES } from '@/lib/tickets/sla';
import {
  getResponseSlaMonitoringStatus,
  getResolutionSlaMonitoringStatus,
  getSlaRemainingMsFromNow,
  getElapsedRatio,
  isSlaOverdue,
  AT_RISK_THRESHOLD_RATIO,
} from '@/lib/tickets/sla';

describe('SLA policy', () => {
  const fixedStart = new Date('2025-01-01T00:00:00Z');

  it('resolves every supported priority', () => {
    for (const priority of ['low', 'medium', 'high', 'urgent'] as const) {
      const policy = getSlaPolicy(priority);
      expect(policy.priority).toBe(priority);
      expect(policy.responseDurationMs).toBe(DEFAULT_SLA_POLICIES[priority].responseDurationMs);
      expect(policy.resolutionDurationMs).toBe(DEFAULT_SLA_POLICIES[priority].resolutionDurationMs);
    }
  });

  it('rejects unknown priority', () => {
    expect(() => getSlaPolicy('extreme' as 'low')).toThrow('SLA policy is not configured yet for priority: extreme');
  });

  it('calculates deadlines from the canonical start time', () => {
    expect(calculateResponseDeadline(fixedStart, 'medium')).toEqual(new Date('2025-01-01T08:00:00Z'));
    expect(calculateResolutionDeadline(fixedStart, 'medium')).toEqual(new Date('2025-01-04T00:00:00Z'));
  });
});

describe('SLA status', () => {
  const deadline = new Date('2025-01-01T12:00:00Z');
  const before = new Date('2025-01-01T11:00:00Z');
  const atDeadline = new Date('2025-01-01T12:00:00Z');
  const after = new Date('2025-01-01T13:00:00Z');

  it('response SLA is pending when no deadline is set', () => {
    expect(getResponseSlaStatus(null, null, after)).toBe('pending');
  });

  it('response SLA is completed when first response is before deadline', () => {
    expect(getResponseSlaStatus(deadline, before, after)).toBe('completed');
  });

  it('response SLA is completed when first response is exactly at deadline', () => {
    expect(getResponseSlaStatus(deadline, atDeadline, after)).toBe('completed');
  });

  it('response SLA is overdue when deadline passes without first response', () => {
    expect(getResponseSlaStatus(deadline, null, after)).toBe('overdue');
  });

  it('response SLA is pending before deadline without first response', () => {
    expect(getResponseSlaStatus(deadline, null, before)).toBe('pending');
  });

  it('resolution SLA follows the same boundary rules', () => {
    expect(getResolutionSlaStatus(deadline, null, after)).toBe('overdue');
    expect(getResolutionSlaStatus(deadline, before, after)).toBe('completed');
    expect(getResolutionSlaStatus(null, null, after)).toBe('pending');
  });
});

describe('SLA monitoring status', () => {
  const createdAt = new Date('2025-01-01T00:00:00Z');
  const deadline = new Date('2025-01-01T12:00:00Z');
  const completedBefore = new Date('2025-01-01T06:00:00Z');
  const completedAt = new Date('2025-01-01T12:00:00Z');
  const completedAfter = new Date('2025-01-01T13:00:00Z');
  const threshold = new Date('2025-01-01T09:36:00Z');
  const beforeThreshold = new Date('2025-01-01T09:35:59Z');
  const afterThreshold = new Date('2025-01-01T09:36:01Z');

  it('is not applicable without deadline or created time', () => {
    expect(getResponseSlaMonitoringStatus(null, null, createdAt, afterThreshold)).toBe('not_applicable');
    expect(getResponseSlaMonitoringStatus(deadline, null, null, afterThreshold)).toBe('not_applicable');
    expect(getResolutionSlaMonitoringStatus(null, null, createdAt, afterThreshold)).toBe('not_applicable');
  });

  it('is completed when responded before deadline', () => {
    expect(getResponseSlaMonitoringStatus(deadline, completedBefore, createdAt, completedAfter)).toBe('completed');
  });

  it('is completed when responded exactly at deadline', () => {
    expect(getResponseSlaMonitoringStatus(deadline, completedAt, createdAt, completedAfter)).toBe('completed');
  });

  it('is breached when responded after deadline', () => {
    expect(getResponseSlaMonitoringStatus(deadline, completedAfter, createdAt, completedBefore)).toBe('breached');
  });

  it('is breached when deadline passed without response', () => {
    expect(getResponseSlaMonitoringStatus(deadline, null, createdAt, completedAfter)).toBe('breached');
  });

  it('is on track when plenty of time remains', () => {
    expect(getResponseSlaMonitoringStatus(deadline, null, createdAt, completedBefore)).toBe('on_track');
  });

  it('is at risk exactly at threshold', () => {
    expect(getResponseSlaMonitoringStatus(deadline, null, createdAt, threshold)).toBe('at_risk');
  });

  it('is on track just before threshold', () => {
    expect(getResponseSlaMonitoringStatus(deadline, null, createdAt, beforeThreshold)).toBe('on_track');
  });

  it('is at risk just after threshold', () => {
    expect(getResponseSlaMonitoringStatus(deadline, null, createdAt, afterThreshold)).toBe('at_risk');
  });

  it('resolution SLA follows the same monitoring rules', () => {
    expect(getResolutionSlaMonitoringStatus(deadline, completedBefore, createdAt, completedAfter)).toBe('completed');
    expect(getResolutionSlaMonitoringStatus(deadline, completedAfter, createdAt, completedBefore)).toBe('breached');
    expect(getResolutionSlaMonitoringStatus(deadline, null, createdAt, completedAfter)).toBe('breached');
    expect(getResolutionSlaMonitoringStatus(deadline, null, createdAt, completedBefore)).toBe('on_track');
    expect(getResolutionSlaMonitoringStatus(deadline, null, createdAt, threshold)).toBe('at_risk');
  });
});

describe('SLA remaining time', () => {
  const now = new Date('2025-01-01T11:00:00Z');
  const deadline = new Date('2025-01-01T12:00:00Z');
  const pastDeadline = new Date('2025-01-01T10:00:00Z');

  it('returns positive remaining time', () => {
    expect(getSlaRemainingMsFromNow(deadline, now)).toBe(60 * 60 * 1000);
  });

  it('returns zero at deadline', () => {
    expect(getSlaRemainingMsFromNow(deadline, deadline)).toBe(0);
  });

  it('returns negative remaining time when overdue', () => {
    expect(getSlaRemainingMsFromNow(pastDeadline, now)).toBeLessThan(0);
  });

  it('returns null when deadline is missing', () => {
    expect(getSlaRemainingMsFromNow(null, now)).toBeNull();
  });
});

describe('SLA elapsed ratio', () => {
  const createdAt = new Date('2025-01-01T00:00:00Z');
  const deadline = new Date('2025-01-01T12:00:00Z');

  it('computes positive remaining elapsed ratio', () => {
    expect(getElapsedRatio(deadline, createdAt, new Date('2025-01-01T06:00:00Z'))).toBe(0.5);
  });

  it('returns 0 before any elapsed time', () => {
    expect(getElapsedRatio(deadline, createdAt, createdAt)).toBe(0);
  });

  it('returns 1 after deadline', () => {
    expect(getElapsedRatio(deadline, createdAt, new Date('2025-01-01T13:00:00Z'))).toBe(1);
  });

  it('returns null without deadline or created time', () => {
    expect(getElapsedRatio(null, createdAt, deadline)).toBeNull();
    expect(getElapsedRatio(deadline, null, deadline)).toBeNull();
  });
});

describe('SLA overdue detection', () => {
  const deadline = new Date('2025-01-01T12:00:00Z');

  it('is overdue after deadline without completion', () => {
    expect(isSlaOverdue(deadline, null, new Date('2025-01-01T13:00:00Z'))).toBe(true);
  });

  it('is not overdue before deadline', () => {
    expect(isSlaOverdue(deadline, null, new Date('2025-01-01T11:00:00Z'))).toBe(false);
  });

  it('is not overdue when completed before deadline', () => {
    expect(isSlaOverdue(deadline, new Date('2025-01-01T11:00:00Z'), new Date('2025-01-01T13:00:00Z'))).toBe(false);
  });

  it('is overdue when completed after deadline', () => {
    expect(isSlaOverdue(deadline, new Date('2025-01-01T13:00:00Z'), new Date('2025-01-01T13:00:00Z'))).toBe(true);
  });

  it('is not overdue when deadline is missing', () => {
    expect(isSlaOverdue(null, null, new Date('2025-01-01T13:00:00Z'))).toBe(false);
  });
});

describe('at risk threshold', () => {
  it('uses a fixed default threshold', () => {
    expect(AT_RISK_THRESHOLD_RATIO).toBe(0.8);
  });
});
