import type { OutboxHandler, OutboxHandlerResult } from './types';

export const handleSlaBreachedEvent: OutboxHandler = async (): Promise<OutboxHandlerResult> => {
  // SLA_BREACHED is a semantic domain event for future consumers.
  // No-op in Task 1 — the breach is recorded in SentSlaBreachNotification
  // by the SLA evaluation service.
  return { status: 'success' };
};
