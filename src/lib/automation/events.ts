import { z } from 'zod';

export const automationEvaluationPayloadSchema = z.object({
  triggerType: z.string().min(1),
  triggerPayload: z.record(z.string(), z.unknown()),
  automationContext: z.object({
    causedByAutomation: z.boolean(),
    ruleId: z.string().optional(),
    executionId: z.string().optional(),
    actionIndex: z.number().int().optional(),
    actorId: z.string().nullable(),
  }),
  workspaceId: z.string().min(1),
  ticketId: z.string().min(1),
  actorId: z.string().nullable(),
});

export type AutomationEvaluationPayload = z.infer<typeof automationEvaluationPayloadSchema>;
