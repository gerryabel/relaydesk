'use client';

import { useState, useTransition } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Card } from '@/components/ui/card';
import {
  MAX_SAVED_VIEW_NAME_LENGTH,
  type SavedViewType,
  sanitizeFilterState,
  sanitizeSortState,
  sanitizeViewState,
} from '@/lib/saved-views/client';

type SavedViewEditorState = {
  name: string;
  type: SavedViewType;
  filterState: Record<string, unknown>;
  sortState: { field: string; direction: string };
  viewState: string;
};

type SavedViewEditorProps = {
  mode: 'create' | 'edit';
  initialView: {
    id?: string;
  } & SavedViewEditorState;
  onSave: (input: SavedViewEditorState) => Promise<{ error?: string } | void>;
  onDelete?: () => Promise<void>;
};

type FormState = {
  status: 'idle' | 'success' | 'error';
  message: string | null;
};

const TYPE_LABELS: Record<string, string> = {
  tickets: 'All tickets',
  my_queue: 'My Queue',
};

export default function SavedViewEditor({
  mode,
  initialView,
  onSave,
  onDelete,
}: SavedViewEditorProps) {
  const [name, setName] = useState(initialView.name);
  const [type, setType] = useState<SavedViewType>(initialView.type);
  const [filterText, setFilterText] = useState(
    () => JSON.stringify(sanitizeFilterState(initialView.filterState), null, 2),
  );
  const [sortText, setSortText] = useState(() => JSON.stringify(initialView.sortState, null, 2));
  const [viewText, setViewText] = useState(() => JSON.stringify(initialView.viewState, null, 2));
  const [fieldError, setFieldError] = useState<string | null>(null);
  const [stateError, setStateError] = useState<string | null>(null);
  const [formState, setFormState] = useState<FormState>({
    status: 'idle',
    message: null,
  });
  const [isPending, startTransition] = useTransition();
  const [confirming, setConfirming] = useState(false);

  function parseState(): { ok: true } | { ok: false; error: string } {
    try {
      JSON.parse(filterText);
      JSON.parse(sortText);
      JSON.parse(viewText);
      return { ok: true };
    } catch (error) {
      return {
        ok: false,
        error: `Invalid JSON: ${error instanceof Error ? error.message : String(error)}`,
      };
    }
  }

  function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setFieldError(null);
    setStateError(null);
    setFormState({ status: 'idle', message: null });

    const trimmed = name.trim();
    if (!trimmed) {
      setFieldError('Saved view name cannot be empty');
      return;
    }
    if (trimmed.length > MAX_SAVED_NAME_LENGTH) {
      setFieldError(
        `Saved view name cannot exceed ${MAX_SAVED_NAME_LENGTH} characters`,
      );
      return;
    }

    const parsed = parseState();
    if (!parsed.ok) {
      setStateError(parsed.error);
      return;
    }

    startTransition(async () => {
      const sortParsed = sanitizeSortState(JSON.parse(sortText));
      const viewParsed = sanitizeViewState(JSON.parse(viewText));

      const result = await onSave({
        name: trimmed,
        type,
        filterState: JSON.parse(filterText),
        sortState: sortParsed,
        viewState: viewParsed,
      });
      if (result && 'error' in result && result.error) {
        setFormState({ status: 'error', message: result.error });
      }
    });
  }

  return (
    <form onSubmit={handleSubmit} className="flex flex-col gap-6" noValidate>
      <Card className="flex flex-col gap-4 p-5">
        <div className="flex flex-col gap-2">
          <Label htmlFor="edit-saved-view-name">Name</Label>
          <Input
            id="edit-saved-view-name"
            type="text"
            value={name}
            onChange={(event) => setName(event.target.value)}
            disabled={isPending}
            maxLength={MAX_SAVED_VIEW_NAME_LENGTH}
            aria-invalid={fieldError ? true : undefined}
            aria-describedby={fieldError ? 'edit-saved-view-error' : undefined}
          />
          {fieldError ? (
            <p id="edit-saved-view-error" role="alert" className="text-xs text-red-600 dark:text-red-400">
              {fieldError}
            </p>
          ) : null}
        </div>

        {mode === 'edit' ? (
          <fieldset className="flex flex-col gap-2">
            <legend className="text-sm font-medium text-neutral-700 dark:text-neutral-200">
              View type
            </legend>
            <div className="flex flex-wrap gap-3">
              {(['tickets', 'my_queue'] as const).map((option) => (
                <label key={option} className="flex items-center gap-2 text-sm">
                  <input
                    type="radio"
                    name="view-type"
                    value={option}
                    checked={type === option}
                    onChange={() => setType(option)}
                    disabled={isPending}
                  />
                  {TYPE_LABELS[option]}
                </label>
              ))}
            </div>
          </fieldset>
        ) : null}
      </Card>

      <Card className="flex flex-col gap-4 p-5">
        <p className="text-sm text-neutral-600 dark:text-neutral-300">
          Stored filter, sort, and queue/view state. Invalid values are normalized when the view is applied.
        </p>

        <div className="flex flex-col gap-2">
          <Label htmlFor="edit-filter-state">Filter state (JSON)</Label>
          <Textarea
            id="edit-filter-state"
            value={filterText}
            onChange={(event) => setFilterText(event.target.value)}
            disabled={isPending}
            rows={6}
            spellCheck={false}
            className="font-mono"
          />
        </div>

        <div className="flex flex-col gap-2">
          <Label htmlFor="edit-sort-state">Sort state (JSON)</Label>
          <Textarea
            id="edit-sort-state"
            value={sortText}
            onChange={(event) => setSortText(event.target.value)}
            disabled={isPending}
            rows={4}
            spellCheck={false}
            className="font-mono"
          />
        </div>

        <div className="flex flex-col gap-2">
          <Label htmlFor="edit-view-state">Queue/view state (JSON)</Label>
          <Textarea
            id="edit-view-state"
            value={viewText}
            onChange={(event) => setViewText(event.target.value)}
            disabled={isPending}
            rows={3}
            spellCheck={false}
            className="font-mono"
          />
        </div>

        {stateError ? (
          <p role="alert" className="text-xs text-red-600 dark:text-red-400">
            {stateError}
          </p>
        ) : null}
      </Card>

      <div className="flex flex-wrap items-center gap-3">
        <Button type="submit" disabled={isPending}>
          {isPending ? 'Saving…' : mode === 'edit' ? 'Save changes' : 'Create saved view'}
        </Button>
        {mode === 'edit' && onDelete ? (
          confirming ? (
            <span className="flex items-center gap-2">
              <Button type="button" variant="danger" onClick={onDelete} disabled={isPending}>
                {isPending ? 'Deleting…' : 'Confirm delete'}
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
          )
        ) : null}
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

const MAX_SAVED_NAME_LENGTH = MAX_SAVED_VIEW_NAME_LENGTH;
