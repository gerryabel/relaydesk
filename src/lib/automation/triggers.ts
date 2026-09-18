import { z } from 'zod';
import type { AutomationTriggerType } from './types';

export const triggerTypeSchema = z.enum([
  'ticket.created',
  'ticket.assigned',
  'ticket.unassigned',
  'ticket.status_changed',
  'ticket.priority_changed',
  'ticket.tag_added',
  'ticket.tag_removed',
  'ticket.customer_linked',
  'ticket.customer_unlinked',
  'sla.at_risk',
  'sla.breached',
]);

export type TriggerType = z.infer<typeof triggerTypeSchema>;

export function isTriggerType(value: unknown): value is TriggerType {
  return triggerTypeSchema.safeParse(value).success;
}

export const triggerSchema = z.object({
  triggerType: triggerTypeSchema,
  triggerPayload: z.record(z.string(), z.unknown()),
});

export type Trigger = z.infer<typeof triggerSchema>;

export function mapDomainEventToTriggerType(eventType: string): AutomationTriggerType | null {
  const mapping: Record<string, AutomationTriggerType> = {
    TICKET_CREATED: 'ticket.created',
    TICKET_ASSIGNED: 'ticket.assigned',
    TICKET_UNASSIGNED: 'ticket.unassigned',
    STATUS_CHANGED: 'ticket.status_changed',
    PRIORITY_CHANGED: 'ticket.priority_changed',
    TAG_ADDED: 'ticket.tag_added',
    TAG_REMOVED: 'ticket.tag_removed',
    CUSTOMER_LINKED: 'ticket.customer_linked',
    CUSTOMER_UNLINKED: 'ticket.customer_unlinked',
    SLA_AT_RISK: 'sla.at_risk',
    SLA_BREACHED: 'sla.breached',
  };

  return mapping[eventType] ?? null;
}
