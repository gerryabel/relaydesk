'use server';

import { revalidatePath } from 'next/cache';
import { getCurrentMembership, assertWorkspaceOwner } from '@/lib/workspace/server';
import {
  listRules,
  getRuleById,
  createRule,
  updateRule,
  deleteRule,
  setRuleEnabled,
  RuleNotFoundError,
  RuleLimitReachedError,
  RuleNameConflictError,
  RuleValidationError,
  RuleReferencedResourceError,
  type CreateRuleInput,
  type UpdateRuleInput,
} from './rules';

/**
 * Result type returned by all rule server actions.
 * Callers (client components) check `success` to branch.
 */
export type RuleActionResult<T = unknown> =
  | { success: true; data: T }
  | { success: false; error: string; code?: string };

function handleError(error: unknown): RuleActionResult {
  if (
    error instanceof RuleNotFoundError ||
    error instanceof RuleLimitReachedError ||
    error instanceof RuleNameConflictError ||
    error instanceof RuleValidationError ||
    error instanceof RuleReferencedResourceError
  ) {
    return { success: false, error: error.message, code: error.name };
  }
  return { success: false, error: 'An unexpected error occurred' };
}

export async function listRulesAction(): Promise<RuleActionResult> {
  try {
    await getCurrentMembership();
    const rules = await listRules();
    return { success: true, data: rules };
  } catch (error) {
    return handleError(error);
  }
}

export async function getRuleByIdAction(id: string): Promise<RuleActionResult> {
  try {
    await getCurrentMembership();
    const rule = await getRuleById(id);
    return { success: true, data: rule };
  } catch (error) {
    return handleError(error);
  }
}

export async function createRuleAction(input: CreateRuleInput): Promise<RuleActionResult> {
  try {
    await assertWorkspaceOwner();
    const rule = await createRule(input);
    revalidatePath('/dashboard/automations');
    return { success: true, data: rule };
  } catch (error) {
    return handleError(error);
  }
}

export async function updateRuleAction(id: string, input: UpdateRuleInput): Promise<RuleActionResult> {
  try {
    await assertWorkspaceOwner();
    const rule = await updateRule(id, input);
    revalidatePath('/dashboard/automations');
    return { success: true, data: rule };
  } catch (error) {
    return handleError(error);
  }
}

export async function deleteRuleAction(id: string): Promise<RuleActionResult> {
  try {
    await assertWorkspaceOwner();
    await deleteRule(id);
    revalidatePath('/dashboard/automations');
    return { success: true, data: null };
  } catch (error) {
    return handleError(error);
  }
}

export async function setRuleEnabledAction(id: string, enabled: boolean): Promise<RuleActionResult> {
  try {
    await assertWorkspaceOwner();
    const rule = await setRuleEnabled(id, enabled);
    revalidatePath('/dashboard/automations');
    return { success: true, data: rule };
  } catch (error) {
    return handleError(error);
  }
}
