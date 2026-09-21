import { describe, it, expect } from 'vitest';
import {
  CONDITION_FIELDS_BY_TRIGGER,
  getConditionFields,
  STATUS_VALUES,
  PRIORITY_VALUES,
  SLA_TYPE_VALUES,
} from '@/lib/automation/condition-fields';
import type { AutomationTriggerType } from '@/lib/automation/types';

describe('automation condition-fields', () => {
  describe('CONDITION_FIELDS_BY_TRIGGER', () => {
    const ALL_TRIGGERS: AutomationTriggerType[] = [
      'ticket.created',
      'ticket.status_changed',
      'ticket.priority_changed',
      'ticket.assigned',
      'ticket.unassigned',
      'ticket.tag_added',
      'ticket.tag_removed',
      'ticket.customer_linked',
      'ticket.customer_unlinked',
      'sla.at_risk',
      'sla.breached',
    ];

    it('has entries for all 11 trigger types', () => {
      for (const trigger of ALL_TRIGGERS) {
        expect(CONDITION_FIELDS_BY_TRIGGER[trigger]).toBeDefined();
        expect(CONDITION_FIELDS_BY_TRIGGER[trigger].length).toBeGreaterThan(0);
      }
    });

    it('ticket.created exposes priority, status, assignee, customer, createdBy', () => {
      const fields = CONDITION_FIELDS_BY_TRIGGER['ticket.created'];
      const fieldNames = fields.map((f) => f.field);
      expect(fieldNames).toContain('priority');
      expect(fieldNames).toContain('status');
      expect(fieldNames).toContain('assignedToId');
      expect(fieldNames).toContain('customerId');
      expect(fieldNames).toContain('createdById');
    });

    it('customerId uses dedicated "customer" type, NOT "agent"', () => {
      const fields = CONDITION_FIELDS_BY_TRIGGER['ticket.created'];
      const customerField = fields.find((f) => f.field === 'customerId');
      expect(customerField).toBeDefined();
      expect(customerField!.type).toBe('customer');
    });

    it('status_changed exposes both current (status) and previous (from) values', () => {
      const fields = CONDITION_FIELDS_BY_TRIGGER['ticket.status_changed'];
      const statusField = fields.find((f) => f.field === 'status');
      const fromField = fields.find((f) => f.field === 'from');
      expect(statusField).toBeDefined();
      expect(fromField).toBeDefined();
    });

    it('priority_changed exposes both current (priority) and previous (from) values', () => {
      const fields = CONDITION_FIELDS_BY_TRIGGER['ticket.priority_changed'];
      const priorityField = fields.find((f) => f.field === 'priority');
      const fromField = fields.find((f) => f.field === 'from');
      expect(priorityField).toBeDefined();
      expect(fromField).toBeDefined();
    });

    it('sla.at_risk exposes slaType and assignedToId', () => {
      const fields = CONDITION_FIELDS_BY_TRIGGER['sla.at_risk'];
      const fieldNames = fields.map((f) => f.field);
      expect(fieldNames).toContain('slaType');
      expect(fieldNames).toContain('assignedToId');
    });

    it('every exposed field has at least one operator', () => {
      for (const trigger of ALL_TRIGGERS) {
        for (const field of CONDITION_FIELDS_BY_TRIGGER[trigger]) {
          expect(field.operators.length).toBeGreaterThan(0);
        }
      }
    });

    it('every exposed field has a non-empty label', () => {
      for (const trigger of ALL_TRIGGERS) {
        for (const field of CONDITION_FIELDS_BY_TRIGGER[trigger]) {
          expect(field.label.length).toBeGreaterThan(0);
        }
      }
    });
  });

  describe('getConditionFields', () => {
    it('returns fields for a valid trigger type', () => {
      const fields = getConditionFields('ticket.created');
      expect(fields.length).toBeGreaterThan(0);
    });

    it('returns empty array for unknown trigger type', () => {
      // @ts-expect-error - testing runtime fallback
      const fields = getConditionFields('unknown.trigger');
      expect(fields).toEqual([]);
    });
  });

  describe('value catalogs', () => {
    it('STATUS_VALUES contains the 5 supported statuses', () => {
      expect(STATUS_VALUES).toContain('open');
      expect(STATUS_VALUES).toContain('in_progress');
      expect(STATUS_VALUES).toContain('waiting_customer');
      expect(STATUS_VALUES).toContain('resolved');
      expect(STATUS_VALUES).toContain('closed');
    });

    it('PRIORITY_VALUES contains the 4 supported priorities', () => {
      expect(PRIORITY_VALUES).toContain('low');
      expect(PRIORITY_VALUES).toContain('medium');
      expect(PRIORITY_VALUES).toContain('high');
      expect(PRIORITY_VALUES).toContain('urgent');
    });

    it('SLA_TYPE_VALUES contains response and resolution', () => {
      expect(SLA_TYPE_VALUES).toContain('response');
      expect(SLA_TYPE_VALUES).toContain('resolution');
    });
  });
});
