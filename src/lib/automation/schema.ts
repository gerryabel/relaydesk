import { z } from 'zod';
import { triggerTypeSchema } from './triggers';
import { conditionGroupSchema } from './conditions';
import { automationActionConfigSchema, validateActionConfig } from './actions/schema';

/**
 * Tightened rule configuration schema that reuses existing bounded schemas:
 * - triggerType: validated against the 11 supported trigger types
 * - conditions: validated via conditionGroupSchema (AND semantics, 1–10 conditions)
 * - actions: validated via automationActionConfigSchema + validateActionConfig
 *
 * Limits per Phase 8 spec:
 *   - max 10 conditions per rule
 *   - max 5 actions per rule
 */
export const automationRuleConfigSchema = z.object({
  name: z.string().trim().min(1, 'Name is required').max(100, 'Name must be at most 100 characters'),
  description: z
    .string()
    .trim()
    .max(500, 'Description must be at most 500 characters')
    .optional()
    .nullable(),
  enabled: z.boolean().default(true),
  priority: z.number().int().optional(),
  triggerType: triggerTypeSchema,
  conditions: conditionGroupSchema,
  actions: z
    .array(automationActionConfigSchema)
    .min(1, 'At least one action is required')
    .max(5, 'At most 5 actions are allowed'),
});

export type AutomationRuleConfigInput = z.infer<typeof automationRuleConfigSchema>;

export function validateRuleConfig(input: unknown): {
  valid: boolean;
  errors?: string[];
  data?: AutomationRuleConfigInput;
} {
  const result = automationRuleConfigSchema.safeParse(input);

  if (!result.success) {
    return {
      valid: false,
      errors: result.error.issues.map((issue) => `${issue.path.join('.')}: ${issue.message}`),
    };
  }

  // Deep-validate each action's config against its type-specific schema.
  const errors: string[] = [];
  const actions = (input as { actions?: Array<{ actionType?: string; actionConfig?: Record<string, unknown> }> }).actions;
  if (Array.isArray(actions)) {
    for (let i = 0; i < actions.length; i++) {
      const action = actions[i]!;
      const result = validateActionConfigDeep(action.actionType ?? '', action.actionConfig ?? {});
      if (!result.valid) {
        errors.push(`actions[${i}]: ${result.error}`);
      }
    }
  }

  if (errors.length > 0) {
    return { valid: false, errors };
  }

  return { valid: true, data: result.data };
}

export function validateActionConfigDeep(
  actionType: string,
  actionConfig: Record<string, unknown>,
): { valid: true } | { valid: false; error: string } {
  return validateActionConfig(actionType, actionConfig);
}
