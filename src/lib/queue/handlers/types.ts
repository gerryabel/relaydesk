import type { OutboxEventRecord } from '@/lib/outbox/types';

export type OutboxHandlerResult =
  | { status: 'success' }
  | { status: 'failure'; error: { message: string; retryable: boolean } };

export type OutboxHandler = (event: OutboxEventRecord) => Promise<OutboxHandlerResult | void>;
