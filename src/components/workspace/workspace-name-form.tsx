'use client';

import { useState, useTransition } from 'react';
import { updateWorkspaceNameAction } from '@/lib/workspace/actions';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';

const MAX_WORKSPACE_NAME_LENGTH = 100;

type WorkspaceNameFormProps = {
  initialName: string;
  canEdit: boolean;
};

type FormState = {
  status: 'idle' | 'success' | 'error';
  message: string | null;
};

export default function WorkspaceNameForm({
  initialName,
  canEdit,
}: WorkspaceNameFormProps) {
  const [name, setName] = useState(initialName);
  const [fieldError, setFieldError] = useState<string | null>(null);
  const [formState, setFormState] = useState<FormState>({
    status: 'idle',
    message: null,
  });
  const [isPending, startTransition] = useTransition();

  const isDirty = name !== initialName;

  function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setFieldError(null);
    setFormState({ status: 'idle', message: null });

    const trimmed = name.trim();
    if (!trimmed) {
      setFieldError('Workspace name cannot be empty');
      return;
    }
    if (trimmed.length > MAX_WORKSPACE_NAME_LENGTH) {
      setFieldError(
        `Workspace name cannot exceed ${MAX_WORKSPACE_NAME_LENGTH} characters`,
      );
      return;
    }

    startTransition(async () => {
      const result = await updateWorkspaceNameAction({ name });
      if (result.error) {
        setFormState({ status: 'error', message: result.error });
      } else {
        setFormState({ status: 'success', message: 'Workspace name updated.' });
      }
    });
  }

  return (
    <form onSubmit={handleSubmit} className="flex flex-col gap-4" noValidate>
      <div className="flex flex-col gap-2">
        <Label htmlFor="workspace-name">Workspace name</Label>
        <Input
          id="workspace-name"
          name="name"
          type="text"
          value={name}
          onChange={(event) => setName(event.target.value)}
          disabled={!canEdit || isPending}
          maxLength={MAX_WORKSPACE_NAME_LENGTH}
          aria-invalid={fieldError ? true : undefined}
          aria-describedby={
            fieldError
              ? 'workspace-name-error'
              : canEdit
                ? 'workspace-name-hint'
                : undefined
          }
        />
        {canEdit ? (
          <p id="workspace-name-hint" className="text-xs text-neutral-500 dark:text-neutral-400">
            Up to {MAX_WORKSPACE_NAME_LENGTH} characters. Only the workspace owner can
            change this.
          </p>
        ) : null}
        {fieldError ? (
          <p id="workspace-name-error" role="alert" className="text-xs text-red-600 dark:text-red-400">
            {fieldError}
          </p>
        ) : null}
      </div>

      {canEdit ? (
        <div className="flex flex-wrap items-center gap-3">
          <Button type="submit" disabled={isPending || !isDirty}>
            {isPending ? 'Saving…' : 'Save changes'}
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
      ) : null}
    </form>
  );
}
