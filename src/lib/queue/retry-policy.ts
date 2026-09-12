export interface RetryPolicy {
  maxAttempts: number;
  backoffType: 'exponential' | 'fixed';
  backoffDelayMs: number;
  maxBackoffDelayMs: number;
}

export const EMAIL_RETRY_POLICY: RetryPolicy = {
  maxAttempts: 3,
  backoffType: 'exponential',
  backoffDelayMs: 5_000,
  maxBackoffDelayMs: 30_000,
};

export const DEFAULT_RETRY_POLICY: RetryPolicy = EMAIL_RETRY_POLICY;

export function calculateBackoffMs(attempt: number, policy: RetryPolicy): number {
  if (attempt < 1) {
    return 0;
  }

  if (policy.backoffType === 'fixed') {
    return policy.backoffDelayMs;
  }

  const exponential = policy.backoffDelayMs * 2 ** (attempt - 1);
  return Math.min(exponential, policy.maxBackoffDelayMs);
}
