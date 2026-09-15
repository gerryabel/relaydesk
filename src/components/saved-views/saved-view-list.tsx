'use client';

import { useState, useTransition } from 'react';
import {
  listSavedViewsAction,
  createSavedViewAction,
  deleteSavedViewAction,
  applySavedViewAction,
} from '@/lib/saved-views/actions';
import type { SavedViewListItem } from '@/lib/saved-views/server';
import { MAX_SAVED_VIEW_NAME_LENGTH } from '@/lib/saved-views/client';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Card } from '@/components/ui/card';
import { EmptyState } from '@/components/ui/empty-state';

type SavedViewListProps = {
  initialViews: SavedViewListItem[];
};

type FormState = {
  status: 'idle' | 'success' | 'error';
  message: string | null;
};

const TYPE_LABELS: Record<string, string> = {
  tickets: 'All tickets',
  my_queue: 'My Queue',
};

function formatDate(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return iso;
  return date.toLocaleDateString(undefined, {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
  });
}

function CreateForm({ onCreated }: { onCreated: (view: SavedViewListItem) => void }) {
  const [name, setName] = useState('');
  const [type, setType] = useState<'tickets' | 'my_queue'>('tickets');
  const [fieldError, setFieldError] = useState<string | null>(null);
  const [formState, setFormState] = useState<FormState>({
    status: 'idle',
    message: null,
  });
  const [isPending, startTransition] = useTransition();

  function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setFieldError(null);
    setFormState({ status: 'idle', message: null });

    const trimmed = name.trim();
    if (!trimmed) {
      setFieldError('Saved view name cannot be empty');
      return;
    }
    if (trimmed.length > MAX_SAVED_VIEW_NAME_LENGTH) {
      setFieldError(
        `Saved view name cannot exceed ${MAX_SAVED_VIEW_NAME_LENGTH} characters`,
      );
      return;
    }

    startTransition(async () => {
      const result = await createSavedViewAction({
        name: trimmed,
        type,
        filterState: {},
        sortState: { field: 'createdAt', direction: 'desc' },
        viewState: 'my-open',
      });
      if (result.error) {
        setFormState({ status: 'error', message: result.error });
      } else if (result.data) {
        setName('');
        setType('tickets');
        setFormState({ status: 'success', message: 'Saved view created.' });
        onCreated({
          id: result.data.id,
          name: result.data.name,
          type: result.data.type,
          createdAt: result.data.createdAt,
          updatedAt: result.data.updatedAt,
        });
      }
    });
  }

  return (
    <form onSubmit={handleSubmit} className="flex flex-col gap-3" noValidate>
      <div className="flex flex-col gap-2">
        <Label htmlFor="new-saved-view-name">New saved view name</Label>
        <Input
          id="new-saved-view-name"
          type="text"
          value={name}
          onChange={(event) => setName(event.target.value)}
          disabled={isPending}
          maxLength={MAX_SAVED_VIEW_NAME_LENGTH}
          aria-invalid={fieldError ? true : undefined}
          aria-describedby={fieldError ? 'new-saved-view-error' : undefined}
        />
        {fieldError ? (
          <p id="new-saved-view-error" role="alert" className="text-xs text-red-600 dark:text-red-400">
            {fieldError}
          </p>
        ) : null}
      </div>

      <fieldset className="flex flex-col gap-2">
        <legend className="text-sm font-medium text-neutral-700 dark:text-neutral-200">
          View type
        </legend>
        <div className="flex flex-wrap gap-3">
          <label className="flex items-center gap-2 text-sm">
            <input
              type="radio"
              name="view-type"
              value="tickets"
              checked={type === 'tickets'}
              onChange={() => setType('tickets')}
              disabled={isPending}
            />
            All tickets
          </label>
          <label className="flex items-center gap-2 text-sm">
            <input
              type="radio"
              name="view-type"
              value="my_queue"
              checked={type === 'my_queue'}
              onChange={() => setType('my_queue')}
              disabled={isPending}
            />
            My Queue
          </label>
        </div>
      </fieldset>

      <div className="flex flex-wrap items-center gap-3">
        <Button type="submit" disabled={isPending}>
          {isPending ? 'Saving…' : 'Create saved view'}
        </Button>
        {formState.message ? (
          <p
            role="status"
            className={
              formState.status === 'error'
                ? 'text-xs text-red-600 dark:text-red-400'
                : 'text-xs text-emerald-600 dark:text-emerald-400'
            }
          >
            {formState.message}
          </p>
        ) : null}
      </div>
    </form>
  );
}

function SavedViewRow({
  view,
  onDeleted,
}: {
  view: SavedViewListItem;
  onDeleted: (id: string) => void;
}) {
  const [isPending, startTransition] = useTransition();
  const [confirming, setConfirming] = useState(false);

  function handleDelete() {
    startTransition(async () => {
      const result = await deleteSavedViewAction(view.id);
      if (result.error) {
        setConfirming(false);
        return;
      }
      onDeleted(view.id);
    });
  }

  function handleApply() {
    startTransition(async () => {
      await applySavedViewAction(view.id);
    });
  }

  return (
    <li>
      <Card className="flex flex-col gap-3 p-4 sm:flex-row sm:items-center sm:justify-between">
        <div className="min-w-0">
          <p className="truncate text-sm font-medium text-neutral-900 dark:text-neutral-50">
            {view.name}
          </p>
          <p className="text-xs text-neutral-500 dark:text-neutral-400">
            {TYPE_LABELS[view.type] ?? view.type} • Updated {formatDate(view.updatedAt)}
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <Button type="button" variant="secondary" onClick={handleApply} disabled={isPending}>
            Apply
          </Button>
          <Button
            type="button"
            variant="secondary"
            href={`/dashboard/saved-views/${view.id}/edit`}
            disabled={isPending}
          >
            Edit
          </Button>
          {confirming ? (
            <span className="flex items-center gap-2">
              <Button type="button" variant="danger" onClick={handleDelete} disabled={isPending}>
                {isPending ? 'Deleting…' : 'Confirm'}
              </Button>
              <Button
                type="button"
                variant="ghost"
                onClick={() => setConfirming(false)}
                disabled={isPending}
              >
                Cancel
              </Button>
            </span>
          ) : (
            <Button
              type="button"
              variant="danger"
              onClick={() => setConfirming(true)}
              disabled={isPending}
            >
              Delete
            </Button>
          )}
        </div>
      </Card>
    </li>
  );
}

export default function SavedViewList({ initialViews }: SavedViewListProps) {
  const [views, setViews] = useState(initialViews);

  function handleCreated(view: SavedViewListItem) {
    setViews((prev) => [view, ...prev]);
  }

  function handleDeleted(id: string) {
    setViews((prev) => prev.filter((view) => view.id !== id));
  }

  return (
    <div className="flex flex-col gap-6">
      <CreateForm onCreated={handleCreated} />

      {views.length === 0 ? (
        <EmptyState
          title="No saved views yet"
          description="Create a saved view to quickly apply your ticket filters and sorting."
        />
      ) : (
        <ul className="flex flex-col gap-3" aria-label="Saved views">
          {views.map((view) => (
            <SavedViewRow key={view.id} view={view} onDeleted={handleDeleted} />
          ))}
        </ul>
      )}
    </div>
  );
}

export { listSavedViewsAction };
