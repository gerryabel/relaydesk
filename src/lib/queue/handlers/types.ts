import type { OutboxEventRecord } from '@/lib/outbox/types';

export type OutboxHandler = (event: OutboxEventRecord) => Promise<void>;
