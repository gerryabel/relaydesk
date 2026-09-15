'use server';

import { revalidatePath } from 'next/cache';
import { ForbiddenError, UnauthorizedError } from '@/lib/workspace/server';
import { redirect } from 'next/navigation';
import {
  listSavedViews,
  getSavedView,
  createSavedView,
  updateSavedView,
  deleteSavedView,
  SavedViewNotFoundError,
  SavedViewForbiddenError,
  DuplicateSavedViewNameError,
} from './server';
import {
  applySavedViewSchema,
  buildSearchParamsFromView,
  type CreateSavedViewInput,
  type UpdateSavedViewInput,
} from './schema';

export async function listSavedViewsAction() {
  try {
    const views = await listSavedViews();
    return { data: views };
  } catch (error) {
    if (error instanceof ForbiddenError || error instanceof UnauthorizedError) {
      return { error: 'Unauthorized' as const };
    }
    return { error: 'Failed to load saved views' as const };
  }
}

export async function getSavedViewAction(id: string) {
  try {
    const view = await getSavedView(id);
    return { data: view };
  } catch (error) {
    if (error instanceof SavedViewNotFoundError) {
      return { error: 'Saved view not found' as const };
    }
    if (error instanceof SavedViewForbiddenError) {
      return { error: 'Forbidden' as const };
    }
    if (error instanceof ForbiddenError || error instanceof UnauthorizedError) {
      return { error: 'Unauthorized' as const };
    }
    return { error: 'Failed to load saved view' as const };
  }
}

export async function createSavedViewAction(input: CreateSavedViewInput) {
  try {
    const view = await createSavedView(input);
    revalidatePath('/dashboard/saved-views');
    return { data: view };
  } catch (error) {
    if (error instanceof DuplicateSavedViewNameError) {
      return { error: error.message };
    }
    if (error instanceof ForbiddenError || error instanceof UnauthorizedError) {
      return { error: 'Unauthorized' as const };
    }
    if (error instanceof Error) {
      return { error: error.message };
    }
    return { error: 'Failed to create saved view' as const };
  }
}

export async function updateSavedViewAction(id: string, input: UpdateSavedViewInput) {
  try {
    const view = await updateSavedView(id, input);
    revalidatePath('/dashboard/saved-views');
    return { data: view };
  } catch (error) {
    if (error instanceof SavedViewNotFoundError) {
      return { error: 'Saved view not found' as const };
    }
    if (error instanceof SavedViewForbiddenError) {
      return { error: 'Forbidden' as const };
    }
    if (error instanceof DuplicateSavedViewNameError) {
      return { error: error.message };
    }
    if (error instanceof ForbiddenError || error instanceof UnauthorizedError) {
      return { error: 'Unauthorized' as const };
    }
    if (error instanceof Error) {
      return { error: error.message };
    }
    return { error: 'Failed to update saved view' as const };
  }
}

export async function deleteSavedViewAction(id: string) {
  try {
    const result = await deleteSavedView(id);
    revalidatePath('/dashboard/saved-views');
    return { data: result };
  } catch (error) {
    if (error instanceof SavedViewNotFoundError) {
      return { error: 'Saved view not found' as const };
    }
    if (error instanceof SavedViewForbiddenError) {
      return { error: 'Forbidden' as const };
    }
    if (error instanceof ForbiddenError || error instanceof UnauthorizedError) {
      return { error: 'Unauthorized' as const };
    }
    return { error: 'Failed to delete saved view' as const };
  }
}

/**
 * Applies a saved view by resolving it (ownership-checked) and redirecting to
 * the existing ticket/queue interface with the saved state restored.
 */
export async function applySavedViewAction(id: string) {
  const parsed = applySavedViewSchema.safeParse({ id });
  if (!parsed.success) {
    return { error: 'Invalid saved view id' as const };
  }

  try {
    const view = await getSavedView(parsed.data.id);
    const params = buildSearchParamsFromView(view);
    const base = view.type === 'my_queue' ? '/dashboard/my-queue' : '/dashboard/tickets';
    redirect(`${base}?${params.toString()}`);
  } catch (error) {
    if (error instanceof SavedViewNotFoundError) {
      return { error: 'Saved view not found' as const };
    }
    if (error instanceof SavedViewForbiddenError) {
      return { error: 'Forbidden' as const };
    }
    if (error instanceof ForbiddenError || error instanceof UnauthorizedError) {
      return { error: 'Unauthorized' as const };
    }
    return { error: 'Failed to apply saved view' as const };
  }
}
