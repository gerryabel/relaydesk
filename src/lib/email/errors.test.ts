import { describe, it, expect } from 'vitest';
import { classifyProviderError } from '@/lib/email/errors';

describe('email provider error classification', () => {
  it('classifies invalid recipient as permanent', () => {
    const error = classifyProviderError(new Error('Invalid recipient provided'));
    expect(error.retryable).toBe(false);
    expect(error.code).toBe('INVALID_RECIPIENT');
  });

  it('classifies provider outage as retryable', () => {
    const error = classifyProviderError(new Error('Provider is temporarily unavailable'));
    expect(error.retryable).toBe(true);
    expect(error.code).toBe('RETRYABLE_FAILURE');
  });

  it('classifies network timeout as retryable', () => {
    const error = classifyProviderError(new Error('Network timeout while delivering email'));
    expect(error.retryable).toBe(true);
    expect(error.code).toBe('RETRYABLE_FAILURE');
  });

  it('falls back to permanent failure for unknown provider errors', () => {
    const error = classifyProviderError(new Error('Unknown provider failure'));
    expect(error.retryable).toBe(false);
    expect(error.code).toBe('PROVIDER_FAILURE');
  });
});
