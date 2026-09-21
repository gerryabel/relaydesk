import { z } from 'zod';

/**
 * Supported automation action types (Phase 8 Task 3).
 *
 * These are the 8 action types required by the Phase 8 specification:
 * assign, unassign, status change, priority change, add tag, remove tag,
 * internal note, in-app notification.
 */
export const AUTOMATION_ACTION_TYPES = {
  ASSIGN: 'assign',
  UNASSIGN: 'unassign',
  SET_STATUS: 'set-status',
  SET_PRIORITY: 'set-priority',
  ADD_TAG: 'add-tag',
  REMOVE_TAG: 'remove-tag',
  INTERNAL_NOTE: 'internal-note',
  NOTIFICATION: 'notification',
} as const;

export type AutomationActionType = (typeof AUTOMATION_ACTION_TYPES)[keyof typeof AUTOMATION_ACTION_TYPES];

export const automationActionTypeSchema = z.enum([
  'assign',
  'unassign',
  'set-status',
  'set-priority',
  'add-tag',
  'remove-tag',
  'internal-note',
  'notification',
]);

// ── assign ──────────────────────────────────────────────────────────────────
export const assignActionSchema = z.object({
  assigneeId: z.string().min(1, 'Assignee ID is required'),
});
export type AssignActionConfig = z.infer<typeof assignActionSchema>;

// ── unassign ────────────────────────────────────────────────────────────────
export const unassignActionSchema = z.object({});
export type UnassignActionConfig = z.infer<typeof unassignActionSchema>;

// ── set-status ──────────────────────────────────────────────────────────────
export const setStatusActionSchema = z.object({
  status: z.enum(['open', 'in_progress', 'waiting_customer', 'resolved', 'closed']),
});
export type SetStatusActionConfig = z.infer<typeof setStatusActionSchema>;

// ── set-priority ────────────────────────────────────────────────────────────
export const setPriorityActionSchema = z.object({
  priority: z.enum(['low', 'medium', 'high', 'urgent']),
});
export type SetPriorityActionConfig = z.infer<typeof setPriorityActionSchema>;

// ── add-tag ─────────────────────────────────────────────────────────────────
export const addTagActionSchema = z.object({
  tagId: z.string().min(1, 'Tag ID is required'),
});
export type AddTagActionConfig = z.infer<typeof addTagActionSchema>;

// ── remove-tag ──────────────────────────────────────────────────────────────
export const removeTagActionSchema = z.object({
  tagId: z.string().min(1, 'Tag ID is required'),
});
export type RemoveTagActionConfig = z.infer<typeof removeTagActionSchema>;

// ── internal-note ───────────────────────────────────────────────────────────
export const internalNoteActionSchema = z.object({
  body: z.string().min(1, 'Note body is required').max(10_000, 'Note body too long'),
  /**
   * Required author ID — the workspace member who "owns" this automation note.
   * Must be a valid User who is a member of the execution workspace.
   * The [Automation] prefix in the body marks the note as automation-originated.
   */
  authorId: z.string().min(1, 'Author ID is required'),
});
export type InternalNoteActionConfig = z.infer<typeof internalNoteActionSchema>;

// ── notification ────────────────────────────────────────────────────────────
export const notificationActionSchema = z.object({
  recipientId: z.string().min(1, 'Recipient ID is required'),
  title: z.string().min(1, 'Title is required').max(200, 'Title too long'),
  body: z.string().min(1, 'Body is required').max(2000, 'Body too long'),
});
export type NotificationActionConfig = z.infer<typeof notificationActionSchema>;

/**
 * Map of action type → Zod schema for its config.
 * Used by the registry to validate action configs before execution.
 */
/**
 * Generic action entry schema — used by the rule builder to validate
 * the shape of a single action entry (actionType + actionConfig) before
 * deep-validating the config against the type-specific schema.
 */
export const automationActionConfigSchema = z.object({
  actionType: automationActionTypeSchema,
  actionConfig: z.record(z.string(), z.unknown()),
});

export const ACTION_CONFIG_SCHEMAS: Record<AutomationActionType, z.ZodTypeAny> = {
  assign: assignActionSchema,
  unassign: unassignActionSchema,
  'set-status': setStatusActionSchema,
  'set-priority': setPriorityActionSchema,
  'add-tag': addTagActionSchema,
  'remove-tag': removeTagActionSchema,
  'internal-note': internalNoteActionSchema,
  notification: notificationActionSchema,
};

/**
 * Validate an action's config against its type-specific schema.
 * Returns { valid: true } or { valid: false, error }.
 */
export function validateActionConfig(
  actionType: string,
  actionConfig: Record<string, unknown>,
): { valid: true } | { valid: false; error: string } {
  const schema = ACTION_CONFIG_SCHEMAS[actionType as AutomationActionType];
  if (!schema) {
    return { valid: false, error: `Unknown action type: ${actionType}` };
  }
  const result = schema.safeParse(actionConfig);
  if (!result.success) {
    const message = result.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('; ');
    return { valid: false, error: message };
  }
  return { valid: true };
}
