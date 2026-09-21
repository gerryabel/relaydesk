'use client';

import { useState, useTransition } from 'react';
import { updateWorkspaceSlaPoliciesAction } from '@/lib/workspace/actions';
import type { WorkspaceSlaPolicyRow } from '@/lib/workspace/sla-policy';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Card, CardHeader, CardTitle, CardDescription, CardContent } from '@/components/ui/card';

type SlaPolicyFormProps = {
  policies: WorkspaceSlaPolicyRow[];
  canEdit: boolean;
};

type FormState = {
  status: 'idle' | 'success' | 'error';
  message: string | null;
};

type Draft = Record<WorkspaceSlaPolicyRow['priority'], { response: string; resolution: string }>;

const PRIORITY_LABELS: Record<WorkspaceSlaPolicyRow['priority'], string> = {
  low: 'Low',
  medium: 'Medium',
  high: 'High',
  urgent: 'Urgent',
};

const PRIORITY_ORDER: WorkspaceSlaPolicyRow['priority'][] = ['low', 'medium', 'high', 'urgent'];

function buildDraft(policies: WorkspaceSlaPolicyRow[]): Draft {
  return policies.reduce<Draft>((acc, policy) => {
    acc[policy.priority] = {
      response: String(policy.responseMinutes),
      resolution: String(policy.resolutionMinutes),
    };
    return acc;
  }, {} as Draft);
}

function interpretMinutes(minutes: number): string {
  if (minutes % (24 * 60) === 0) {
    const days = minutes / (24 * 60);
    return `${days} ${days === 1 ? 'day' : 'days'}`;
  }
  if (minutes % 60 === 0) {
    const hours = minutes / 60;
    return `${hours} ${hours === 1 ? 'hour' : 'hours'}`;
  }
  return `${minutes} minutes`;
}

export default function SlaPolicyForm({ policies, canEdit }: SlaPolicyFormProps) {
  const [draft, setDraft] = useState<Draft>(() => buildDraft(policies));
  const [fieldErrors, setFieldErrors] = useState<Record<string, string | null>>({});
  const [formState, setFormState] = useState<FormState>({
    status: 'idle',
    message: null,
  });
  const [isPending, startTransition] = useTransition();

  function updateField(
    priority: WorkspaceSlaPolicyRow['priority'],
    field: 'response' | 'resolution',
    value: string,
  ) {
    setDraft((prev) => ({
      ...prev,
      [priority]: {
        ...prev[priority],
        [field]: value,
      },
    }));
    setFieldErrors((prev) => ({
      ...prev,
      [`${priority}-${field}`]: null,
    }));
  }

  function validate(): boolean {
    const errors: Record<string, string | null> = {};
    for (const priority of PRIORITY_ORDER) {
      const response = draft[priority].response.trim();
      const resolution = draft[priority].resolution.trim();
      if (response === '' || !Number.isInteger(Number(response)) || Number(response) < 1) {
        errors[`${priority}-response`] = 'Must be a positive integer';
      }
      if (resolution === '' || !Number.isInteger(Number(resolution)) || Number(resolution) < 1) {
        errors[`${priority}-resolution`] = 'Must be a positive integer';
      }
    }
    setFieldErrors(errors);
    return Object.values(errors).every((value) => value === null);
  }

  function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setFormState({ status: 'idle', message: null });

    if (!validate()) {
      return;
    }

    const payload = PRIORITY_ORDER.map((priority) => ({
      priority,
      responseMinutes: Number(draft[priority].response),
      resolutionMinutes: Number(draft[priority].resolution),
    }));

    startTransition(async () => {
      const result = await updateWorkspaceSlaPoliciesAction(payload);
      if (result.error) {
        setFormState({ status: 'error', message: result.error });
      } else {
        setFormState({ status: 'success', message: 'SLA policies updated.' });
      }
    });
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>SLA Policies</CardTitle>
        <CardDescription>
          Service-level agreement targets for each priority. Durations are wall-clock minutes.
        </CardDescription>
      </CardHeader>
      <CardContent>
        <form onSubmit={handleSubmit} className="flex flex-col gap-5" noValidate>
          <div className="flex flex-col gap-4">
            {PRIORITY_ORDER.map((priority) => {
              const responseError = fieldErrors[`${priority}-response`] ?? null;
              const resolutionError = fieldErrors[`${priority}-resolution`] ?? null;
              return (
                <fieldset
                  key={priority}
                  className="grid grid-cols-1 gap-3 rounded-md border border-neutral-200 p-4 dark:border-neutral-800 sm:grid-cols-2"
                  disabled={!canEdit || isPending}
                >
                  <legend className="px-1 text-sm font-semibold">{PRIORITY_LABELS[priority]}</legend>
                  <div className="flex flex-col gap-2">
                    <Label htmlFor={`${priority}-response`}>Response (minutes)</Label>
                    <Input
                      id={`${priority}-response`}
                      name={`${priority}-response`}
                      type="number"
                      min={1}
                      step={1}
                      value={draft[priority].response}
                      onChange={(event) => updateField(priority, 'response', event.target.value)}
                      disabled={!canEdit || isPending}
                      aria-invalid={responseError ? true : undefined}
                      aria-describedby={
                        responseError ? `${priority}-response-error` : undefined
                      }
                    />
                    {canEdit && !responseError ? (
                      <p className="text-xs text-neutral-500 dark:text-neutral-400">
                        ≈ {interpretMinutes(Number(draft[priority].response) || 0)}
                      </p>
                    ) : null}
                    {responseError ? (
                      <p
                        id={`${priority}-response-error`}
                        role="alert"
                        className="text-xs text-red-600 dark:text-red-400"
                      >
                        {responseError}
                      </p>
                    ) : null}
                  </div>
                  <div className="flex flex-col gap-2">
                    <Label htmlFor={`${priority}-resolution`}>Resolution (minutes)</Label>
                    <Input
                      id={`${priority}-resolution`}
                      name={`${priority}-resolution`}
                      type="number"
                      min={1}
                      step={1}
                      value={draft[priority].resolution}
                      onChange={(event) => updateField(priority, 'resolution', event.target.value)}
                      disabled={!canEdit || isPending}
                      aria-invalid={resolutionError ? true : undefined}
                      aria-describedby={
                        resolutionError ? `${priority}-resolution-error` : undefined
                      }
                    />
                    {canEdit && !resolutionError ? (
                      <p className="text-xs text-neutral-500 dark:text-neutral-400">
                        ≈ {interpretMinutes(Number(draft[priority].resolution) || 0)}
                      </p>
                    ) : null}
                    {resolutionError ? (
                      <p
                        id={`${priority}-resolution-error`}
                        role="alert"
                        className="text-xs text-red-600 dark:text-red-400"
                      >
                        {resolutionError}
                      </p>
                    ) : null}
                  </div>
                </fieldset>
              );
            })}
          </div>

          {canEdit ? (
            <div className="flex flex-wrap items-center gap-3">
              <Button type="submit" disabled={isPending}>
                {isPending ? 'Saving…' : 'Save SLA policies'}
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
      </CardContent>
    </Card>
  );
}
