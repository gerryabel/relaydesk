export type OutboxEventType =
  | 'TICKET_CREATED'
  | 'TICKET_ASSIGNED'
  | 'TICKET_REPLIED'
  | 'TICKET_RESOLVED'
  | 'SLA_AT_RISK';

export type OutboxAggregateType = 'Ticket';

export type OutboxPayload = Record<string, unknown>;

export interface OutboxEventRecord {
  id: string;
  eventType: OutboxEventType;
  aggregateType: OutboxAggregateType;
  aggregateId: string;
  payload: OutboxPayload;
  createdAt: Date;
  processedAt: Date | null;
  completedAt: Date | null;
  failedAt: Date | null;
  attempts: number;
  lastError: string | null;
}

export interface DispatchOutboxEventInput {
  eventType: OutboxEventType;
  aggregateType: OutboxAggregateType;
  aggregateId: string;
  payload: OutboxPayload;
}
