import { handleEmailOutboxEvent } from './email-handler';

export const HandlerRegistry: Record<import('@/lib/outbox/types').OutboxEventType, import('./types').OutboxHandler> = {
  TICKET_CREATED: async () => {},
  TICKET_ASSIGNED: handleEmailOutboxEvent,
  TICKET_REPLIED: async () => {},
  TICKET_RESOLVED: async () => {},
  SLA_AT_RISK: async () => {},
};

export function getHandler(eventType: string): import('./types').OutboxHandler {
  if (eventType in HandlerRegistry) {
    return HandlerRegistry[eventType as import('@/lib/outbox/types').OutboxEventType];
  }

  throw new Error(`No handler registered for event type: ${eventType}`);
}
