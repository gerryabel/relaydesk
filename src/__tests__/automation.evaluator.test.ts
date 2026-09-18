import { describe, it, expect } from 'vitest';
import {
  shouldEvaluateEvent,
  matchRule,
  evaluateRule,
  findMatchingRules,
  type EvaluationContext,
} from '@/lib/automation/evaluator';
import type { AutomationRuleConfig } from '@/lib/automation/types';

describe('automation evaluator', () => {
  describe('shouldEvaluateEvent', () => {
    it('returns true when event is not caused by automation', () => {
      expect(shouldEvaluateEvent({ causedByAutomation: false })).toBe(true);
    });

    it('returns false when event is caused by automation (recursion prevention)', () => {
      expect(shouldEvaluateEvent({ causedByAutomation: true })).toBe(false);
    });
  });

  describe('matchRule', () => {
    const baseRule: AutomationRuleConfig = {
      id: 'rule-1',
      workspaceId: 'workspace-1',
      name: 'Test Rule',
      enabled: true,
      triggerType: 'ticket.created',
      conditions: [],
      actions: [],
    };

    it('returns true for enabled rule with matching trigger', () => {
      expect(matchRule(baseRule, 'ticket.created')).toBe(true);
    });

    it('returns false for disabled rule', () => {
      const disabledRule = { ...baseRule, enabled: false };
      expect(matchRule(disabledRule, 'ticket.created')).toBe(false);
    });

    it('returns false for non-matching trigger', () => {
      expect(matchRule(baseRule, 'ticket.assigned')).toBe(false);
    });
  });

  describe('evaluateRule', () => {
    const context: EvaluationContext = {
      triggerType: 'ticket.created',
      triggerPayload: { priority: 'high', status: 'open' },
      ticketId: 'ticket-1',
      workspaceId: 'workspace-1',
      actorId: 'user-1',
    };

    it('returns matched when all conditions pass', () => {
      const rule: AutomationRuleConfig = {
        id: 'rule-1',
        workspaceId: 'workspace-1',
        name: 'High Priority Rule',
        enabled: true,
        triggerType: 'ticket.created',
        conditions: [
          { field: 'priority', operator: 'equals', value: 'high' },
        ],
        actions: [{ actionType: 'notify', actionConfig: {} }],
      };

      const result = evaluateRule(rule, context);
      expect(result.matched).toBe(true);
      expect(result.rule).toEqual(rule);
    });

    it('returns not matched when condition fails', () => {
      const rule: AutomationRuleConfig = {
        id: 'rule-1',
        workspaceId: 'workspace-1',
        name: 'Low Priority Rule',
        enabled: true,
        triggerType: 'ticket.created',
        conditions: [
          { field: 'priority', operator: 'equals', value: 'low' },
        ],
        actions: [],
      };

      const result = evaluateRule(rule, context);
      expect(result.matched).toBe(false);
      expect(result.rule).toBeNull();
    });

    it('returns not matched for empty conditions', () => {
      const rule: AutomationRuleConfig = {
        id: 'rule-1',
        workspaceId: 'workspace-1',
        name: 'No Conditions Rule',
        enabled: true,
        triggerType: 'ticket.created',
        conditions: [],
        actions: [],
      };

      const result = evaluateRule(rule, context);
      expect(result.matched).toBe(false);
      expect(result.rule).toBeNull();
    });

    it('evaluates multiple conditions with AND semantics', () => {
      const rule: AutomationRuleConfig = {
        id: 'rule-1',
        workspaceId: 'workspace-1',
        name: 'Complex Rule',
        enabled: true,
        triggerType: 'ticket.created',
        conditions: [
          { field: 'priority', operator: 'equals', value: 'high' },
          { field: 'status', operator: 'equals', value: 'open' },
        ],
        actions: [],
      };

      const result = evaluateRule(rule, context);
      expect(result.matched).toBe(true);

      // Change one condition to fail
      const failContext = {
        ...context,
        triggerPayload: { priority: 'low', status: 'open' },
      };
      const failResult = evaluateRule(rule, failContext);
      expect(failResult.matched).toBe(false);
    });
  });

  describe('findMatchingRules', () => {
    const context: EvaluationContext = {
      triggerType: 'ticket.created',
      triggerPayload: { priority: 'high' },
      ticketId: 'ticket-1',
      workspaceId: 'workspace-1',
      actorId: 'user-1',
    };

    it('returns only matching rules', () => {
      const rules: AutomationRuleConfig[] = [
        {
          id: 'rule-1',
          workspaceId: 'workspace-1',
          name: 'Matching Rule',
          enabled: true,
          triggerType: 'ticket.created',
          conditions: [{ field: 'priority', operator: 'equals', value: 'high' }],
          actions: [],
        },
        {
          id: 'rule-2',
          workspaceId: 'workspace-1',
          name: 'Non-matching Rule',
          enabled: true,
          triggerType: 'ticket.created',
          conditions: [{ field: 'priority', operator: 'equals', value: 'low' }],
          actions: [],
        },
        {
          id: 'rule-3',
          workspaceId: 'workspace-1',
          name: 'Wrong Trigger',
          enabled: true,
          triggerType: 'ticket.assigned',
          conditions: [{ field: 'priority', operator: 'equals', value: 'high' }],
          actions: [],
        },
      ];

      const matching = findMatchingRules(rules, context);
      expect(matching).toHaveLength(1);
      expect(matching[0].id).toBe('rule-1');
    });

    it('returns empty array when no rules match', () => {
      const rules: AutomationRuleConfig[] = [
        {
          id: 'rule-1',
          workspaceId: 'workspace-1',
          name: 'Disabled Rule',
          enabled: false,
          triggerType: 'ticket.created',
          conditions: [{ field: 'priority', operator: 'equals', value: 'high' }],
          actions: [],
        },
      ];

      const matching = findMatchingRules(rules, context);
      expect(matching).toHaveLength(0);
    });
  });
});
