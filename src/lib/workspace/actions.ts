'use server';

import { revalidatePath } from 'next/cache';
import { ForbiddenError, UnauthorizedError } from '@/lib/workspace/server';
import {
  getWorkspaceSettings,
  updateWorkspaceName,
  type WorkspaceNameInput,
} from './settings';
import {
  getWorkspaceSlaPolicies,
  updateWorkspaceSlaPolicies,
  type SlaPolicyInput,
} from './sla-policy';

export async function getWorkspaceSettingsAction() {
  try {
    const settings = await getWorkspaceSettings();
    return { data: settings };
  } catch (error) {
    if (error instanceof UnauthorizedError) {
      return { error: 'Unauthorized' as const };
    }
    if (error instanceof ForbiddenError) {
      return { error: 'Forbidden' as const };
    }
    return { error: 'Failed to load workspace settings' as const };
  }
}

export async function updateWorkspaceNameAction(input: WorkspaceNameInput) {
  try {
    const settings = await updateWorkspaceName(input);
    revalidatePath('/dashboard/settings');
    return { data: settings };
  } catch (error) {
    if (error instanceof ForbiddenError) {
      return { error: 'Forbidden' as const };
    }
    if (error instanceof UnauthorizedError) {
      return { error: 'Unauthorized' as const };
    }
    if (error instanceof Error) {
      return { error: error.message };
    }
    return { error: 'Failed to update workspace name' as const };
  }
}

export async function getWorkspaceSlaPoliciesAction() {
  try {
    const policies = await getWorkspaceSlaPolicies();
    return { data: policies };
  } catch (error) {
    if (error instanceof UnauthorizedError) {
      return { error: 'Unauthorized' as const };
    }
    if (error instanceof ForbiddenError) {
      return { error: 'Forbidden' as const };
    }
    return { error: 'Failed to load SLA policies' as const };
  }
}

export async function updateWorkspaceSlaPoliciesAction(input: SlaPolicyInput) {
  try {
    const policies = await updateWorkspaceSlaPolicies(input);
    revalidatePath('/dashboard/settings');
    return { data: policies };
  } catch (error) {
    if (error instanceof ForbiddenError) {
      return { error: 'Forbidden' as const };
    }
    if (error instanceof UnauthorizedError) {
      return { error: 'Unauthorized' as const };
    }
    return { error: 'Failed to update SLA policies' as const };
  }
}
