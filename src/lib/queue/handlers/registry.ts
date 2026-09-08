import { OutboxEventType } from '@/lib/outbox/types';
import type { OutboxHandler } from './types';

export const HandlerRegistry: Record<OutboxEventType, OutboxHandler> = {
  TICKET_CREATED: async () => {},
  TICKET_ASSIGNED: async () => {},
  TICKET_REPLIED: async () => {},
  TICKET_RESOLVED: async () => {},
  SLA_AT_RISK: async () => {},
};

export function getHandler(eventType: string): OutboxHandler {
  if (eventType in HandlerRegistry) {
    return HandlerRegistry[eventType as OutboxEventType];
  }

  throw new Error(`No handler registered for event type: ${eventType}`);
}
