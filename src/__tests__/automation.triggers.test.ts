import { describe, it, expect } from 'vitest';
import {
  triggerTypeSchema,
  isTriggerType,
  mapDomainEventToTriggerType,
} from '@/lib/automation/triggers';

describe('automation triggers', () => {
  describe('triggerTypeSchema', () => {
    it('accepts valid trigger types', () => {
      const validTypes = [
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
      ];

      for (const type of validTypes) {
        expect(triggerTypeSchema.safeParse(type).success).toBe(true);
      }
    });

    it('rejects invalid trigger types', () => {
      const invalidTypes = [
        'ticket.invalid',
        'sla.invalid',
        '',
        'TICKET_CREATED',
        'random.string',
      ];

      for (const type of invalidTypes) {
        expect(triggerTypeSchema.safeParse(type).success).toBe(false);
      }
    });
  });

  describe('isTriggerType', () => {
    it('returns true for valid trigger types', () => {
      expect(isTriggerType('ticket.created')).toBe(true);
      expect(isTriggerType('sla.breached')).toBe(true);
    });

    it('returns false for invalid trigger types', () => {
      expect(isTriggerType('invalid')).toBe(false);
      expect(isTriggerType('')).toBe(false);
      expect(isTriggerType(null)).toBe(false);
      expect(isTriggerType(undefined)).toBe(false);
    });
  });

  describe('mapDomainEventToTriggerType', () => {
    it('maps domain events to trigger types', () => {
      expect(mapDomainEventToTriggerType('TICKET_CREATED')).toBe('ticket.created');
      expect(mapDomainEventToTriggerType('TICKET_ASSIGNED')).toBe('ticket.assigned');
      expect(mapDomainEventToTriggerType('TICKET_UNASSIGNED')).toBe('ticket.unassigned');
      expect(mapDomainEventToTriggerType('STATUS_CHANGED')).toBe('ticket.status_changed');
      expect(mapDomainEventToTriggerType('PRIORITY_CHANGED')).toBe('ticket.priority_changed');
      expect(mapDomainEventToTriggerType('TAG_ADDED')).toBe('ticket.tag_added');
      expect(mapDomainEventToTriggerType('TAG_REMOVED')).toBe('ticket.tag_removed');
      expect(mapDomainEventToTriggerType('CUSTOMER_LINKED')).toBe('ticket.customer_linked');
      expect(mapDomainEventToTriggerType('CUSTOMER_UNLINKED')).toBe('ticket.customer_unlinked');
      expect(mapDomainEventToTriggerType('SLA_AT_RISK')).toBe('sla.at_risk');
      expect(mapDomainEventToTriggerType('SLA_BREACHED')).toBe('sla.breached');
    });

    it('returns null for unknown events', () => {
      expect(mapDomainEventToTriggerType('UNKNOWN_EVENT')).toBeNull();
      expect(mapDomainEventToTriggerType('')).toBeNull();
    });
  });
});
