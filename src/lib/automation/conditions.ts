import { z } from 'zod';

export const conditionOperatorSchema = z.enum([
  'equals',
  'not_equals',
  'includes',
  'excludes',
  'is_set',
  'is_not_set',
]);
export type ConditionOperator = z.infer<typeof conditionOperatorSchema>;

export const conditionSchema = z.object({
  field: z.string().min(1),
  operator: conditionOperatorSchema,
  value: z.unknown().optional(),
});
export type Condition = z.infer<typeof conditionSchema>;

export const conditionGroupSchema = z.object({
  conditions: z.array(conditionSchema).min(1).max(10, 'At most 10 conditions are allowed'),
});
export type ConditionGroup = z.infer<typeof conditionGroupSchema>;

export function validateConditionGroup(conditions: unknown): { valid: boolean; errors?: string[] } {
  if (!Array.isArray(conditions) || conditions.length === 0) {
    return { valid: false, errors: ['Condition group must contain at least one condition'] };
  }

  const errors: string[] = [];
  const parsed = conditionGroupSchema.safeParse({ conditions });

  if (!parsed.success) {
    errors.push(...parsed.error.issues.map((issue) => issue.message));
    return { valid: false, errors };
  }

  return { valid: true };
}

function evaluateCondition(condition: Condition, context: Record<string, unknown>): boolean {
  const fieldValue = context[condition.field];

  switch (condition.operator) {
    case 'equals':
      return fieldValue === condition.value;
    case 'not_equals':
      return fieldValue !== condition.value;
    case 'includes':
      if (Array.isArray(fieldValue)) {
        return fieldValue.includes(condition.value);
      }
      if (typeof fieldValue === 'string' && typeof condition.value === 'string') {
        return fieldValue.includes(condition.value);
      }
      return false;
    case 'excludes':
      if (Array.isArray(fieldValue)) {
        return !fieldValue.includes(condition.value);
      }
      if (typeof fieldValue === 'string' && typeof condition.value === 'string') {
        return !fieldValue.includes(condition.value);
      }
      return true;
    case 'is_set':
      return fieldValue !== null && fieldValue !== undefined;
    case 'is_not_set':
      return fieldValue === null || fieldValue === undefined;
    default:
      return false;
  }
}

export function evaluateConditionGroup(
  group: { conditions: Condition[] },
  context: Record<string, unknown>,
): boolean {
  return group.conditions.every((condition) => evaluateCondition(condition, context));
}
