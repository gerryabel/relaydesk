import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { calculateBackoffMs, EMAIL_RETRY_POLICY, DEFAULT_RETRY_POLICY } from '@/lib/queue/retry-policy';

describe('retry policy', () => {
  beforeEach(() => {
    vi.useFakeTimers().setSystemTime(new Date('2026-09-08T00:00:00Z'));
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('returns zero for zero or negative attempt', () => {
    expect(calculateBackoffMs(0, EMAIL_RETRY_POLICY)).toBe(0);
    expect(calculateBackoffMs(-1, EMAIL_RETRY_POLICY)).toBe(0);
  });

  it('uses exponential backoff within max cap', () => {
    expect(calculateBackoffMs(1, EMAIL_RETRY_POLICY)).toBe(5_000);
    expect(calculateBackoffMs(2, EMAIL_RETRY_POLICY)).toBe(10_000);
    expect(calculateBackoffMs(3, EMAIL_RETRY_POLICY)).toBe(20_000);
    expect(calculateBackoffMs(10, EMAIL_RETRY_POLICY)).toBe(30_000);
  });

  it('supports fixed backoff', () => {
    const fixed = { ...DEFAULT_RETRY_POLICY, backoffType: 'fixed' } as typeof DEFAULT_RETRY_POLICY;
    expect(calculateBackoffMs(1, fixed)).toBe(5_000);
    expect(calculateBackoffMs(5, fixed)).toBe(5_000);
  });
});
