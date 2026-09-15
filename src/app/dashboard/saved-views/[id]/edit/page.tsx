import Link from 'next/link';
import { notFound, redirect } from 'next/navigation';
import {
  getSavedViewAction,
  updateSavedViewAction,
  deleteSavedViewAction,
} from '@/lib/saved-views/actions';
import SavedViewEditor from '@/components/saved-views/saved-view-editor';

type EditSavedViewPageProps = {
  params: Promise<{ id: string }>;
};

export default async function EditSavedViewPage({ params }: EditSavedViewPageProps) {
  const resolved = await params;
  const result = await getSavedViewAction(resolved.id);

  if (!result.data) {
    if (result.error === 'Forbidden') {
      redirect('/dashboard/saved-views');
    }
    notFound();
  }

  const view = result.data;

  async function handleUpdate(input: {
    name: string;
    type: 'tickets' | 'my_queue';
    filterState: Record<string, unknown>;
    sortState: { field: string; direction: string };
    viewState: string;
  }) {
    'use server';
    const updateResult = await updateSavedViewAction(resolved.id, {
      name: input.name,
      type: input.type,
      filterState: input.filterState,
      sortState: input.sortState as { field: 'createdAt' | 'updatedAt' | 'title' | 'priority' | 'status'; direction: 'asc' | 'desc' },
      viewState: input.viewState as 'my-open' | 'waiting' | 'high-priority' | 'sla-risk',
    });
    if (updateResult.data) {
      redirect('/dashboard/saved-views');
    }
    return updateResult;
  }

  async function handleDelete() {
    'use server';
    await deleteSavedViewAction(resolved.id);
    redirect('/dashboard/saved-views');
  }

  return (
    <div className="mx-auto max-w-5xl px-4 py-10">
      <div className="flex flex-col gap-6">
        <header className="flex flex-col gap-1">
          <h1 className="text-2xl font-semibold">Edit saved view</h1>
          <p className="text-sm text-neutral-600 dark:text-neutral-300">
            Update the name, type, or stored state of this saved view.
          </p>
        </header>

        <SavedViewEditor
          mode="edit"
          initialView={{
            id: view.id,
            name: view.name,
            type: view.type,
            filterState: view.filterState,
            sortState: view.sortState,
            viewState: view.viewState,
          }}
          onSave={handleUpdate}
          onDelete={handleDelete}
        />

        <Link
          href="/dashboard/saved-views"
          className="text-sm text-neutral-500 hover:text-neutral-900 dark:hover:text-neutral-100"
        >
          ← Back to saved views
        </Link>
      </div>
    </div>
  );
}
