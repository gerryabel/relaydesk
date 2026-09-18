import type { AutomationRuleConfig, AutomationTriggerType } from './types';
import { evaluateConditionGroup, type Condition } from './conditions';

export interface EvaluationContext {
  triggerType: AutomationTriggerType;
  triggerPayload: Record<string, unknown>;
  ticketId: string;
  workspaceId: string;
  actorId: string | null;
}

export interface RuleMatchResult {
  matched: boolean;
  rule: AutomationRuleConfig | null;
}

export function shouldEvaluateEvent(automationContext: { causedByAutomation: boolean }): boolean {
  return !automationContext.causedByAutomation;
}

export function matchRule(
  rule: AutomationRuleConfig,
  triggerType: AutomationTriggerType,
): boolean {
  if (!rule.enabled) return false;
  return rule.triggerType === triggerType;
}

export function evaluateRule(
  rule: AutomationRuleConfig,
  context: EvaluationContext,
): RuleMatchResult {
  if (!matchRule(rule, context.triggerType)) {
    return { matched: false, rule: null };
  }

  const conditions = rule.conditions as unknown as Condition[];

  if (!Array.isArray(conditions) || conditions.length === 0) {
    return { matched: false, rule: null };
  }

  const conditionGroup = { conditions: conditions as Condition[] };
  const matched = evaluateConditionGroup(conditionGroup, context.triggerPayload);

  return { matched, rule: matched ? rule : null };
}

export function findMatchingRules(
  rules: AutomationRuleConfig[],
  context: EvaluationContext,
): AutomationRuleConfig[] {
  const matching: AutomationRuleConfig[] = [];

  for (const rule of rules) {
    const result = evaluateRule(rule, context);
    if (result.matched) {
      matching.push(result.rule!);
    }
  }

  return matching;
}
