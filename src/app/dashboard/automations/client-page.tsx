'use client';

import { useState, useTransition } from 'react';
import { EmptyState } from '@/components/automations/empty-state';
import { RuleList } from '@/components/automations/rule-list';
import { RuleBuilder } from '@/components/automations/rule-builder';
import {
  listRulesAction,
  createRuleAction,
  updateRuleAction,
  deleteRuleAction,
  setRuleEnabledAction,
} from '@/lib/automation/rule-actions';
import type { RuleResponse } from '@/lib/automation/rules';

export interface AutomationsPageProps {
  isOwner: boolean;
  initialRules: RuleResponse[];
  members: Array<{ id: string; name: string }>;
  tags: Array<{ id: string; name: string }>;
}

type EditingState =
  | { mode: 'list' }
  | { mode: 'create' }
  | { mode: 'edit'; rule: RuleResponse }
  | { mode: 'confirm-delete'; rule: RuleResponse };

export default function AutomationsPage({ isOwner, initialRules, members, tags }: AutomationsPageProps) {
  const [rules, setRules] = useState(initialRules);
  const [state, setState] = useState<EditingState>({ mode: 'list' });
  const [error, setError] = useState<string | null>(null);
  const [, startTransition] = useTransition();

  const refreshRules = () => {
    startTransition(async () => {
      const result = await listRulesAction();
      if (result.success) {
        setRules(result.data as RuleResponse[]);
      }
    });
  };

  const handleToggle = async (id: string, enabled: boolean) => {
    const result = await setRuleEnabledAction(id, enabled);
    if (result.success) {
      refreshRules();
    }
  };

  const handleDeleteConfirm = async (rule: RuleResponse) => {
    setError(null);
    const result = await deleteRuleAction(rule.id);
    if (result.success) {
      setState({ mode: 'list' });
      refreshRules();
    } else {
      setError(result.error);
    }
  };

  const handleSave = async (input: {
    name: string;
    description?: string;
    triggerType: string;
    conditions: unknown;
    actions: Array<{ actionType: string; actionConfig: Record<string, unknown> }>;
  }) => {
    setError(null);
    if (state.mode === 'edit') {
      const result = await updateRuleAction(state.rule.id, input);
      if (result.success) {
        setState({ mode: 'list' });
        refreshRules();
      } else {
        throw new Error(result.error);
      }
    } else {
      const result = await createRuleAction(input);
      if (result.success) {
        setState({ mode: 'list' });
        refreshRules();
      } else {
        throw new Error(result.error);
      }
    }
  };

  if (state.mode === 'confirm-delete') {
    return (
      <div className="mx-auto max-w-3xl px-4 py-10">
        <div className="rounded-lg border border-red-200 bg-red-50 p-6 dark:border-red-900/40 dark:bg-red-950/30">
          <h2 className="text-base font-medium text-red-900 dark:text-red-100">Delete rule?</h2>
          <p className="mt-2 text-sm text-red-800 dark:text-red-200">
            Are you sure you want to delete <strong>{state.rule.name}</strong>? This action cannot be undone.
            Execution history will be preserved.
          </p>
          {error ? (
            <p className="mt-2 text-sm text-red-600 dark:text-red-400" role="alert">
              {error}
            </p>
          ) : null}
          <div className="mt-4 flex items-center gap-3">
            <button
              type="button"
              onClick={() => handleDeleteConfirm(state.rule)}
              className="inline-flex items-center justify-center rounded-md bg-red-700 px-4 py-2 text-sm font-medium text-white transition hover:bg-red-800"
            >
              Delete
            </button>
            <button
              type="button"
              onClick={() => setState({ mode: 'list' })}
              className="inline-flex items-center justify-center rounded-md border border-neutral-300 px-4 py-2 text-sm hover:border-neutral-900 dark:border-neutral-700 dark:hover:border-neutral-100"
            >
              Cancel
            </button>
          </div>
        </div>
      </div>
    );
  }

  if (state.mode === 'create' || state.mode === 'edit') {
    return (
      <div className="mx-auto max-w-3xl px-4 py-10">
        <header className="mb-6">
          <button
            type="button"
            onClick={() => setState({ mode: 'list' })}
            className="mb-3 text-sm text-neutral-600 hover:text-neutral-900 dark:text-neutral-400 dark:hover:text-neutral-100"
          >
            ← Back to rules
          </button>
          <h1 className="text-2xl font-semibold">
            {state.mode === 'edit' ? 'Edit rule' : 'Create automation rule'}
          </h1>
          <p className="mt-2 text-sm text-neutral-600 dark:text-neutral-300">
            Define a trigger, conditions, and actions. All conditions must match for the actions to run.
          </p>
        </header>
        <RuleBuilder
          initialRule={state.mode === 'edit' ? state.rule : undefined}
          members={members}
          tags={tags}
          onSave={handleSave}
          onCancel={() => setState({ mode: 'list' })}
        />
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-5xl px-4 py-10">
      <div className="flex flex-col gap-6">
        <header className="flex flex-col gap-1 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <h1 className="text-2xl font-semibold">Automations</h1>
            <p className="mt-2 text-sm text-neutral-600 dark:text-neutral-300">
              Create rules that automatically execute actions when triggers fire. Rules run in priority order.
            </p>
          </div>
          {isOwner ? (
            <button
              type="button"
              onClick={() => setState({ mode: 'create' })}
              className="inline-flex items-center justify-center rounded-md bg-neutral-900 px-3 py-2 text-sm font-medium text-white transition hover:bg-neutral-800 dark:bg-neutral-100 dark:text-neutral-900 dark:hover:bg-neutral-200"
            >
              Create rule
            </button>
          ) : null}
        </header>

        {isOwner && rules.length >= 45 ? (
          <p className="text-xs text-neutral-500 dark:text-neutral-400" role="status">
            {rules.length}/50 rules used. Workspace limit: 50 rules.
          </p>
        ) : null}

        {rules.length === 0 ? (
          <EmptyState
            title="No automation rules"
            description="Create your first rule to automate ticket handling. Rules fire when their trigger event occurs and all conditions match."
            action={
              isOwner ? (
                <button
                  type="button"
                  onClick={() => setState({ mode: 'create' })}
                  className="inline-flex items-center justify-center rounded-md bg-neutral-900 px-3 py-2 text-sm text-white hover:bg-neutral-800 dark:bg-neutral-100 dark:text-neutral-900 dark:hover:bg-neutral-200"
                >
                  Create rule
                </button>
              ) : undefined
            }
          />
        ) : (
          <RuleList
            rules={rules}
            isOwner={isOwner}
            onToggle={handleToggle}
            onEdit={(rule) => setState({ mode: 'edit', rule })}
            onDelete={(rule) => setState({ mode: 'confirm-delete', rule })}
          />
        )}
      </div>
    </div>
  );
}
