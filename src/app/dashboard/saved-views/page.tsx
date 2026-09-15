import { listSavedViews } from '@/lib/saved-views/server';
import { getCurrentMembership } from '@/lib/workspace/server';
import { ForbiddenError, UnauthorizedError } from '@/lib/workspace/server';
import SavedViewList from '@/components/saved-views/saved-view-list';
import { DashboardErrorState } from '@/components/ui/error-state';

export default async function SavedViewsPage() {
  try {
    await getCurrentMembership();
  } catch (error) {
    if (error instanceof UnauthorizedError) {
      return (
        <div className="mx-auto max-w-5xl px-4 py-10">
          <DashboardErrorState message="Please sign in to view saved views." />
        </div>
      );
    }
    if (error instanceof ForbiddenError) {
      return (
        <div className="mx-auto max-w-5xl px-4 py-10">
          <DashboardErrorState message="You need a workspace to view saved views." />
        </div>
      );
    }
    throw error;
  }

  const views = await listSavedViews();

  return (
    <div className="mx-auto max-w-5xl px-4 py-10">
      <div className="flex flex-col gap-6">
        <header className="flex flex-col gap-1">
          <h1 className="text-2xl font-semibold">Saved Views</h1>
          <p className="text-sm text-neutral-600 dark:text-neutral-300">
            Personal views that save your ticket filters and sorting. Only you can see and use your saved views.
          </p>
        </header>

        <SavedViewList initialViews={views} />
      </div>
    </div>
  );
}
