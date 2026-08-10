import { describe, it, expect } from 'vitest';
import { getSlaPolicy, calculateResponseDeadline, calculateResolutionDeadline, getResponseSlaStatus, getResolutionSlaStatus, DEFAULT_SLA_POLICIES } from '@/lib/tickets/sla';

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
