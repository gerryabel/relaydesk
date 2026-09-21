import { prisma } from '@/lib/db/prisma';
import type { Prisma } from '@/generated/prisma';
import {
  getCurrentMembership,
  assertWorkspaceOwner,
} from '@/lib/workspace/server';
import { triggerTypeSchema } from './triggers';
import { validateConditionGroup } from './conditions';
import { validateActionConfig, type AutomationActionType } from './actions/schema';

// ── Limits ──────────────────────────────────────────────────────────────────

export const MAX_RULES_PER_WORKSPACE = 50;

// ── Errors ──────────────────────────────────────────────────────────────────

export class RuleNotFoundError extends Error {
  constructor(message = 'Automation rule not found') {
    super(message);
    this.name = 'RuleNotFoundError';
  }
}

export class RuleLimitReachedError extends Error {
  constructor(message = `Maximum ${MAX_RULES_PER_WORKSPACE} rules per workspace reached`) {
    super(message);
    this.name = 'RuleLimitReachedError';
  }
}

export class RuleNameConflictError extends Error {
  constructor(message = 'A rule with this name already exists in the workspace') {
    super(message);
    this.name = 'RuleNameConflictError';
  }
}

export class RuleValidationError extends Error {
  constructor(
    message = 'Rule validation failed',
    public readonly details: string[],
  ) {
    super(message);
    this.name = 'RuleValidationError';
  }
}

export class RuleReferencedResourceError extends Error {
  constructor(message = 'Rule references a resource not in this workspace') {
    super(message);
    this.name = 'RuleReferencedResourceError';
  }
}

// ── Types ───────────────────────────────────────────────────────────────────

export interface RuleActionInput {
  actionType: string;
  actionConfig: Record<string, unknown>;
}

export interface CreateRuleInput {
  name: string;
  description?: string;
  enabled?: boolean;
  triggerType: string;
  conditions: unknown;
  actions: RuleActionInput[];
  priority?: number;
}

export interface UpdateRuleInput {
  name?: string;
  description?: string;
  enabled?: boolean;
  triggerType?: string;
  conditions?: unknown;
  actions?: RuleActionInput[];
  priority?: number;
}

export type RuleResponse = {
  id: string;
  workspaceId: string;
  name: string;
  description: string | null;
  enabled: boolean;
  priority: number;
  triggerType: string;
  conditions: unknown;
  actions: unknown;
  createdById: string | null;
  createdAt: string;
  updatedAt: string;
};

// ── Helpers ─────────────────────────────────────────────────────────────────

function isPrismaError(error: unknown): error is Prisma.PrismaClientKnownRequestError {
  return (
    typeof error === 'object' &&
    error !== null &&
    'code' in error &&
    typeof (error as { code?: unknown }).code === 'string'
  );
}

function isUniqueConstraintError(error: unknown): boolean {
  return isPrismaError(error) && error.code === 'P2002';
}

function isSerializationFailure(error: unknown): boolean {
  if (isPrismaError(error)) {
    return error.code === 'P2034';
  }
  if (!error || typeof error !== 'object') return false;
  const message = (error as { message?: unknown }).message;
  return typeof message === 'string' && message.includes('P2034');
}

/**
 * Bounded retry for SERIALIZABLE transactions that may hit P2034 serialization
 * conflicts under concurrency. Reuses the existing pattern from
 * src/lib/members/server.ts.
 */
async function executeWithRetry<T>(operation: () => Promise<T>): Promise<T> {
  const MAX_SERIAL_RETRIES = 3;
  const RETRY_BASE_MS = 25;
  let attempt = 0;

  for (;;) {
    try {
      return await operation();
    } catch (error) {
      const isLastAttempt = attempt >= MAX_SERIAL_RETRIES;
      if (isLastAttempt || !isSerializationFailure(error)) {
        throw error;
      }
      const delay = RETRY_BASE_MS * 2 ** attempt + Math.floor(Math.random() * RETRY_BASE_MS);
      await new Promise((resolve) => setTimeout(resolve, delay));
      attempt += 1;
    }
  }
}

function toRuleResponse(rule: {
  id: string;
  workspaceId: string;
  name: string;
  description: string | null;
  enabled: boolean;
  priority: number;
  triggerType: string;
  conditions: Prisma.JsonValue;
  actions: Prisma.JsonValue;
  createdById: string | null;
  createdAt: Date;
  updatedAt: Date;
}): RuleResponse {
  return {
    id: rule.id,
    workspaceId: rule.workspaceId,
    name: rule.name,
    description: rule.description,
    enabled: rule.enabled,
    priority: rule.priority,
    triggerType: rule.triggerType,
    conditions: rule.conditions,
    actions: rule.actions,
    createdById: rule.createdById,
    createdAt: rule.createdAt.toISOString(),
    updatedAt: rule.updatedAt.toISOString(),
  };
}

// ── Validation ──────────────────────────────────────────────────────────────

/**
 * Validates the rule configuration against existing schemas.
 * Throws RuleValidationError with details on failure.
 *
 * Reuses: triggerTypeSchema, conditionGroupSchema, validateActionConfig.
 */
export function validateRuleConfiguration(input: {
  name?: string;
  triggerType?: string;
  conditions?: unknown;
  actions?: RuleActionInput[];
}): void {
  const errors: string[] = [];

  if (input.name !== undefined) {
    const trimmed = input.name.trim();
    if (trimmed.length === 0) errors.push('name: must not be empty');
    if (trimmed.length > 100) errors.push('name: must be at most 100 characters');
  }

  if (input.triggerType !== undefined) {
    if (!triggerTypeSchema.safeParse(input.triggerType).success) {
      errors.push(`triggerType: invalid trigger type "${input.triggerType}"`);
    }
  }

  if (input.conditions !== undefined) {
    const groupResult = validateConditionGroup(input.conditions);
    if (!groupResult.valid) {
      errors.push(...((groupResult.errors ?? []).map((e) => `conditions: ${e}`)));
    }
  }

  if (input.actions !== undefined) {
    if (!Array.isArray(input.actions) || input.actions.length === 0) {
      errors.push('actions: must contain at least one action');
    } else if (input.actions.length > 5) {
      errors.push('actions: must contain at most 5 actions');
    } else {
      for (let i = 0; i < input.actions.length; i++) {
        const action = input.actions[i]!;
        const result = validateActionConfig(action.actionType, action.actionConfig ?? {});
        if (!result.valid) {
          errors.push(`actions[${i}]: ${result.error}`);
        }
      }
    }
  }

  if (errors.length > 0) {
    throw new RuleValidationError('Rule validation failed', errors);
  }
}

/**
 * Verifies that referenced resources (members, customers, tags) belong to the
 * workspace referenced by the rule.
 *
 * Throws RuleReferencedResourceError on any mismatch.
 */
export async function validateRuleReferences(
  actions: RuleActionInput[],
  workspaceId: string,
): Promise<void> {
  for (let i = 0; i < actions.length; i++) {
    const action = actions[i]!;
    switch (action.actionType as AutomationActionType) {
      case 'assign': {
        const assigneeId = action.actionConfig.assigneeId;
        if (typeof assigneeId === 'string' && assigneeId.length > 0) {
          const membership = await prisma.membership.findFirst({
            where: { userId: assigneeId, workspaceId },
            select: { id: true },
          });
          if (!membership) {
            throw new RuleReferencedResourceError(
              `actions[${i}]: assignee "${assigneeId}" is not a member of this workspace`,
            );
          }
        }
        break;
      }
      case 'internal-note': {
        const authorId = action.actionConfig.authorId;
        if (typeof authorId === 'string' && authorId.length > 0) {
          const membership = await prisma.membership.findFirst({
            where: { userId: authorId, workspaceId },
            select: { id: true },
          });
          if (!membership) {
            throw new RuleReferencedResourceError(
              `actions[${i}]: note author "${authorId}" is not a member of this workspace`,
            );
          }
        }
        break;
      }
      case 'notification': {
        const recipientId = action.actionConfig.recipientId;
        if (typeof recipientId === 'string' && recipientId.length > 0) {
          const membership = await prisma.membership.findFirst({
            where: { userId: recipientId, workspaceId },
            select: { id: true },
          });
          if (!membership) {
            throw new RuleReferencedResourceError(
              `actions[${i}]: notification recipient "${recipientId}" is not a member of this workspace`,
            );
          }
        }
        break;
      }
      case 'add-tag':
      case 'remove-tag': {
        const tagId = action.actionConfig.tagId;
        if (typeof tagId === 'string' && tagId.length > 0) {
          const tag = await prisma.tag.findFirst({
            where: { id: tagId, workspaceId },
            select: { id: true },
          });
          if (!tag) {
            throw new RuleReferencedResourceError(
              `actions[${i}]: tag "${tagId}" does not belong to this workspace`,
            );
          }
        }
        break;
      }
      default:
        // unassign, set-status, set-priority — no reference validation needed
        break;
    }
  }
}

// ── CRUD ────────────────────────────────────────────────────────────────────

/**
 * Lists all rules for the current workspace, ordered deterministically:
 * priority ASC, createdAt ASC, id ASC.
 *
 * Readable by any workspace member.
 */
export async function listRules(): Promise<RuleResponse[]> {
  const membership = await getCurrentMembership();

  const rules = await prisma.automationRule.findMany({
    where: { workspaceId: membership.workspaceId },
    orderBy: [{ priority: 'asc' }, { createdAt: 'asc' }, { id: 'asc' }],
  });

  return rules.map(toRuleResponse);
}

/**
 * Returns a single rule by id, scoped to the current workspace.
 *
 * Readable by any workspace member. Throws RuleNotFoundError if not found.
 */
export async function getRuleById(id: string): Promise<RuleResponse> {
  const membership = await getCurrentMembership();

  const rule = await prisma.automationRule.findFirst({
    where: { id, workspaceId: membership.workspaceId },
  });

  if (!rule) {
    throw new RuleNotFoundError();
  }

  return toRuleResponse(rule);
}

/**
 * Creates a new automation rule.
 *
 * Owner-only. Runs in a SERIALIZABLE transaction with P2034 retry for
 * race-safe rule-limit and priority allocation.
 *
 * Throws:
 *   - ForbiddenError (via assertWorkspaceOwner) when caller is not owner
 *   - RuleValidationError when config is invalid
 *   - RuleReferencedResourceError when references cross-workspace resources
 *   - RuleLimitReachedError when workspace has MAX_RULES_PER_WORKSPACE rules
 *   - RuleNameConflictError when name collides with an existing rule
 */
export async function createRule(input: CreateRuleInput): Promise<RuleResponse> {
  await assertWorkspaceOwner();

  const trimmedName = input.name.trim();
  if (trimmedName.length === 0) {
    throw new RuleValidationError('Rule validation failed', ['name: must not be empty']);
  }
  if (trimmedName.length > 100) {
    throw new RuleValidationError('Rule validation failed', ['name: must be at most 100 characters']);
  }

  // Validate the full configuration before opening the transaction.
  validateRuleConfiguration({
    name: trimmedName,
    triggerType: input.triggerType,
    conditions: input.conditions,
    actions: input.actions,
  });

  const membership = await getCurrentMembership();

  // Verify references before opening the transaction.
  await validateRuleReferences(input.actions, membership.workspaceId);

  const result = await executeWithRetry(() =>
    prisma.$transaction(
      async (tx) => {
        // Race-safe limit check under SERIALIZABLE isolation.
        const count = await tx.automationRule.count({
          where: { workspaceId: membership.workspaceId },
        });
        if (count >= MAX_RULES_PER_WORKSPACE) {
          throw new RuleLimitReachedError();
        }

        // Race-safe priority allocation: compute next priority inside the tx.
        const maxRow = await tx.automationRule.aggregate({
          _max: { priority: true },
          where: { workspaceId: membership.workspaceId },
        });
        const nextPriority = input.priority ?? ((maxRow._max.priority ?? -1) + 1);

        try {
          const rule = await tx.automationRule.create({
            data: {
              workspaceId: membership.workspaceId,
              name: trimmedName,
              description: input.description?.trim() || null,
              enabled: input.enabled ?? true,
              priority: nextPriority,
              triggerType: input.triggerType,
              conditions: (input.conditions ?? []) as unknown as Prisma.InputJsonValue,
              actions: (input.actions ?? []) as unknown as Prisma.InputJsonValue,
              createdById: membership.userId,
            },
          });
          return rule;
        } catch (error) {
          if (isUniqueConstraintError(error)) {
            throw new RuleNameConflictError();
          }
          throw error;
        }
      },
      { isolationLevel: 'Serializable' },
    ),
  );

  return toRuleResponse(result);
}

/**
 * Partially updates an automation rule.
 *
 * Owner-only. Re-validates config/references when relevant fields change.
 * Uses SERIALIZABLE transaction when name or priority change to stay race-safe.
 *
 * Throws:
 *   - ForbiddenError when caller is not owner
 *   - RuleNotFoundError when rule not in workspace
 *   - RuleValidationError when config is invalid
 *   - RuleReferencedResourceError when references cross-workspace resources
 *   - RuleNameConflictError when new name collides
 */
export async function updateRule(id: string, input: UpdateRuleInput): Promise<RuleResponse> {
  await assertWorkspaceOwner();

  const membership = await getCurrentMembership();

  const existing = await prisma.automationRule.findFirst({
    where: { id, workspaceId: membership.workspaceId },
    select: { id: true, workspaceId: true, priority: true },
  });

  if (!existing) {
    throw new RuleNotFoundError();
  }

  // Validate configuration if any config field is being updated.
  if (
    input.name !== undefined ||
    input.triggerType !== undefined ||
    input.conditions !== undefined ||
    input.actions !== undefined
  ) {
    validateRuleConfiguration({
      name: input.name,
      triggerType: input.triggerType,
      conditions: input.conditions,
      actions: input.actions,
    });
  }

  // Validate references if actions change.
  if (input.actions !== undefined) {
    await validateRuleReferences(input.actions, membership.workspaceId);
  }

  const isNameChange = input.name !== undefined && input.name.trim() !== existing.id;
  const isPriorityChange = input.priority !== undefined && input.priority !== existing.priority;

  // For simple enabled/description updates, no serializable tx needed.
  if (!isNameChange && !isPriorityChange) {
    try {
      const rule = await prisma.automationRule.update({
        where: { id },
        data: {
          ...(input.name !== undefined ? { name: input.name.trim() } : {}),
          ...(input.description !== undefined ? { description: input.description.trim() || null } : {}),
          ...(input.enabled !== undefined ? { enabled: input.enabled } : {}),
          ...(input.triggerType !== undefined ? { triggerType: input.triggerType } : {}),
          ...(input.conditions !== undefined
            ? { conditions: input.conditions as unknown as Prisma.InputJsonValue }
            : {}),
          ...(input.actions !== undefined ? { actions: input.actions as unknown as Prisma.InputJsonValue } : {}),
        },
      });
      return toRuleResponse(rule);
    } catch (error) {
      if (isUniqueConstraintError(error)) {
        throw new RuleNameConflictError();
      }
      throw error;
    }
  }

  // Name or priority change — run in SERIALIZABLE with P2034 retry.
  const rule = await executeWithRetry(() =>
    prisma.$transaction(
      async (tx) => {
        try {
          const updated = await tx.automationRule.update({
            where: { id },
            data: {
              ...(input.name !== undefined ? { name: input.name.trim() } : {}),
              ...(input.description !== undefined ? { description: input.description.trim() || null } : {}),
              ...(input.enabled !== undefined ? { enabled: input.enabled } : {}),
              ...(input.triggerType !== undefined ? { triggerType: input.triggerType } : {}),
              ...(input.priority !== undefined ? { priority: input.priority } : {}),
              ...(input.conditions !== undefined
                ? { conditions: input.conditions as unknown as Prisma.InputJsonValue }
                : {}),
              ...(input.actions !== undefined ? { actions: input.actions as unknown as Prisma.InputJsonValue } : {}),
            },
          });
          return updated;
        } catch (error) {
          if (isUniqueConstraintError(error)) {
            throw new RuleNameConflictError();
          }
          throw error;
        }
      },
      { isolationLevel: 'Serializable' },
    ),
  );

  return toRuleResponse(rule);
}

/**
 * Deletes an automation rule.
 *
 * Owner-only. This is a HARD DELETE of the rule row, but because
 * AutomationExecution.ruleId is now nullable with onDelete: SetNull,
 * execution history is preserved (with ruleNameSnapshot retaining the
 * human-readable rule name for audit views).
 *
 * Throws:
 *   - ForbiddenError when caller is not owner
 *   - RuleNotFoundError when rule not in workspace
 */
export async function deleteRule(id: string): Promise<{ ok: true }> {
  await assertWorkspaceOwner();

  const membership = await getCurrentMembership();

  const existing = await prisma.automationRule.findFirst({
    where: { id, workspaceId: membership.workspaceId },
    select: { id: true },
  });

  if (!existing) {
    throw new RuleNotFoundError();
  }

  await prisma.automationRule.delete({
    where: { id },
  });

  return { ok: true };
}

/**
 * Toggles the enabled state of a rule.
 *
 * Owner-only.
 *
 * Throws:
 *   - ForbiddenError when caller is not owner
 *   - RuleNotFoundError when rule not in workspace
 */
export async function setRuleEnabled(id: string, enabled: boolean): Promise<RuleResponse> {
  await assertWorkspaceOwner();

  const membership = await getCurrentMembership();

  const existing = await prisma.automationRule.findFirst({
    where: { id, workspaceId: membership.workspaceId },
    select: { id: true },
  });

  if (!existing) {
    throw new RuleNotFoundError();
  }

  const rule = await prisma.automationRule.update({
    where: { id },
    data: { enabled },
  });

  return toRuleResponse(rule);
}
