import type { EmailDeliveryResult } from '@/lib/email/types';

export class RetryableError extends Error {
  readonly code = 'RETRYABLE_FAILURE';
  readonly retryable = true;

  constructor(message: string) {
    super(message);
    this.name = 'RetryError';
  }
}

export class PermanentError extends Error {
  readonly code = 'PERMANENT_FAILURE';
  readonly retryable = false;

  constructor(message: string) {
    super(message);
    this.name = 'PermanentError';
  }
}

export function asRetryable(message: string): RetryableError {
  return new RetryableError(message);
}

export function asPermanent(message: string): PermanentError {
  return new PermanentError(message);
}

export function classifyDeliveryResult(result: EmailDeliveryResult): Error {
  if (result.status === 'success') {
    return asPermanent('Email provider accepted message unexpectedly');
  }

  if (result.status === 'retryable_failure' || result.status === 'invalid_message') {
    return asRetryable(result.error?.message ?? 'Email provider retryable failure');
  }

  return asPermanent(result.error?.message ?? 'Email provider permanent failure');
}
