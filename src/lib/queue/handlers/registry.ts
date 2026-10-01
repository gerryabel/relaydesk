import { handleEmailOutboxEvent } from './email-handler';
import { handleCustomerEmailEvent } from './customer-email';
import { handleSlaAtRiskEvent } from './sla';
import { handleSlaBreachedEvent } from './sla-breached';
import { handleAutomationEvaluation } from './automation';
import { handleAutomationActionExecution } from './automation-action';
import { handleCustomerMagicLinkEvent } from './customer-magic-link';

export const HandlerRegistry: Record<import('@/lib/outbox/types').OutboxEventType, import('./types').OutboxHandler> = {
  TICKET_CREATED: async () => {},
  TICKET_ASSIGNED: handleEmailOutboxEvent,
  TICKET_REPLIED: handleCustomerEmailEvent,
  TICKET_STATUS_CHANGED: handleCustomerEmailEvent,
  TICKET_RESOLVED: async () => {},
  SLA_AT_RISK: handleSlaAtRiskEvent,
  SLA_BREACHED: handleSlaBreachedEvent,
  AUTOMATION_EVALUATION: handleAutomationEvaluation,
  AUTOMATION_ACTION_EXECUTION: handleAutomationActionExecution,
  CUSTOMER_MAGIC_LINK_REQUESTED: handleCustomerMagicLinkEvent,
};

export function getHandler(eventType: string): import('./types').OutboxHandler {
  if (eventType in HandlerRegistry) {
    return HandlerRegistry[eventType as import('@/lib/outbox/types').OutboxEventType];
  }

  throw new Error(`No handler registered for event type: ${eventType}`);
}
