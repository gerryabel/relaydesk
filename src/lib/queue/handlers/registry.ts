import { handleEmailOutboxEvent } from './email-handler';
import { handleSlaAtRiskEvent } from './sla';
import { handleSlaBreachedEvent } from './sla-breached';
import { handleAutomationEvaluation } from './automation';

export const HandlerRegistry: Record<import('@/lib/outbox/types').OutboxEventType, import('./types').OutboxHandler> = {
  TICKET_CREATED: async () => {},
  TICKET_ASSIGNED: handleEmailOutboxEvent,
  TICKET_REPLIED: async () => {},
  TICKET_RESOLVED: async () => {},
  SLA_AT_RISK: handleSlaAtRiskEvent,
  SLA_BREACHED: handleSlaBreachedEvent,
  AUTOMATION_EVALUATION: handleAutomationEvaluation,
};

export function getHandler(eventType: string): import('./types').OutboxHandler {
  if (eventType in HandlerRegistry) {
    return HandlerRegistry[eventType as import('@/lib/outbox/types').OutboxEventType];
  }

  throw new Error(`No handler registered for event type: ${eventType}`);
}
