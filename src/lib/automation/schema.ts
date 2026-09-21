import { z } from 'zod';

export const automationActionConfigSchema = z.object({
  actionType: z.string().min(1),
  actionConfig: z.record(z.string(), z.unknown()),
});

export const automationRuleConfigSchema = z.object({
  name: z.string().min(1).max(100),
  description: z.string().max(500).optional(),
  enabled: z.boolean(),
  triggerType: z.string().min(1),
  conditions: z.array(z.record(z.string(), z.unknown())).max(10),
  actions: z.array(automationActionConfigSchema).min(1).max(5),
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

  return { valid: true, data: result.data };
}
