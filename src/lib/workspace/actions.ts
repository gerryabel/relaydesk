'use server';

import { revalidatePath } from 'next/cache';
import { ForbiddenError, UnauthorizedError } from '@/lib/workspace/server';
import {
  getWorkspaceSettings,
  updateWorkspaceName,
  type WorkspaceNameInput,
} from './settings';

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
