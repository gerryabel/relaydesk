export class EmailProviderError extends Error {
  constructor(
    message: string,
    public readonly code: string,
    public readonly retryable: boolean,
  ) {
    super(message);
    this.name = 'EmailProviderError';
  }
}

export function classifyProviderError(error: unknown): EmailProviderError {
  const raw = error instanceof Error ? error.message : String(error);
  const lower = raw.toLowerCase();

  if (lower.includes('invalid recipient') || lower.includes('bad recipient') || lower.includes('does not exist') || lower.includes('unverified')) {
    return new EmailProviderError(raw, 'INVALID_RECIPIENT', false);
  }

  if (lower.includes('invalid api key') || lower.includes('authentication') || lower.includes('unauthorized')) {
    return new EmailProviderError(raw, 'INVALID_CONFIGURATION', false);
  }

  if (lower.includes('invalid request') || lower.includes('missing required')) {
    return new EmailProviderError(raw, 'INVALID_MESSAGE', false);
  }

  if (lower.includes('timeout') || lower.includes('network') || lower.includes('temporarily unavailable') || lower.includes('rate limit')) {
    return new EmailProviderError(raw, 'RETRYABLE_FAILURE', true);
  }

  return new EmailProviderError(raw, 'PROVIDER_FAILURE', false);
}
