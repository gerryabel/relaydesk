import { describe, it, expect } from 'vitest';
import {
  automationRuleConfigSchema,
  validateRuleConfig,
} from '@/lib/automation/schema';

describe('automation schema', () => {
  describe('automationRuleConfigSchema', () => {
    const validRule = {
      name: 'Notify on high priority',
      description: 'Send notification when high priority ticket is created',
      enabled: true,
      triggerType: 'ticket.created',
      conditions: {
        conditions: [
          { field: 'priority', operator: 'equals', value: 'high' },
        ],
      },
      actions: [
        { actionType: 'notification', actionConfig: { recipientId: 'user-1', message: 'hi' } },
      ],
    };

    it('accepts valid rule config', () => {
      const result = automationRuleConfigSchema.safeParse(validRule);
      expect(result.success).toBe(true);
    });

    it('rejects empty name', () => {
      const result = automationRuleConfigSchema.safeParse({
        ...validRule,
        name: '',
      });
      expect(result.success).toBe(false);
    });

    it('rejects name longer than 100 chars', () => {
      const result = automationRuleConfigSchema.safeParse({
        ...validRule,
        name: 'a'.repeat(101),
      });
      expect(result.success).toBe(false);
    });

    it('rejects empty trigger type', () => {
      const result = automationRuleConfigSchema.safeParse({
        ...validRule,
        triggerType: '',
      });
      expect(result.success).toBe(false);
    });

    it('rejects more than 10 conditions', () => {
      const result = automationRuleConfigSchema.safeParse({
        ...validRule,
        conditions: {
          conditions: Array.from({ length: 11 }, (_, i) => ({
            field: `field${i}`,
            operator: 'equals',
            value: i,
          })),
        },
      });
      expect(result.success).toBe(false);
    });

    it('rejects empty actions array', () => {
      const result = automationRuleConfigSchema.safeParse({
        ...validRule,
        actions: [],
      });
      expect(result.success).toBe(false);
    });

    it('rejects more than 5 actions', () => {
      const result = automationRuleConfigSchema.safeParse({
        ...validRule,
        actions: Array.from({ length: 6 }, () => ({
          actionType: 'assign',
          actionConfig: { assigneeId: 'user-1' },
        })),
      });
      expect(result.success).toBe(false);
    });

    it('rejects action without actionType', () => {
      const result = automationRuleConfigSchema.safeParse({
        ...validRule,
        actions: [{ actionConfig: {} }],
      });
      expect(result.success).toBe(false);
    });
  });

  describe('validateRuleConfig', () => {
    it('returns valid with parsed data', () => {
      const result = validateRuleConfig({
        name: 'Test Rule',
        enabled: true,
        triggerType: 'ticket.created',
        conditions: { conditions: [{ field: 'priority', operator: 'equals', value: 'high' }] },
        actions: [{ actionType: 'unassign', actionConfig: {} }],
      });

      expect(result.valid).toBe(true);
      expect(result.data).toBeDefined();
      expect(result.errors).toBeUndefined();
    });

    it('returns invalid with errors', () => {
      const result = validateRuleConfig({
        name: '',
        enabled: true,
        triggerType: '',
        conditions: { conditions: [] },
        actions: [],
      });

      expect(result.valid).toBe(false);
      expect(result.errors).toBeDefined();
      expect(result.errors!.length).toBeGreaterThan(0);
    });

    it('handles completely invalid input', () => {
      const result = validateRuleConfig('not an object' as unknown);
      expect(result.valid).toBe(false);
      expect(result.errors).toBeDefined();
    });
  });
});
