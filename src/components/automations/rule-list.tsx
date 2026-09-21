'use client';

import { useState } from 'react';
import type { RuleResponse } from '@/lib/automation/rules';

export interface RuleListProps {
  rules: RuleResponse[];
  isOwner: boolean;
  onToggle: (id: string, enabled: boolean) => Promise<void>;
  onEdit: (rule: RuleResponse) => void;
  onDelete: (rule: RuleResponse) => void;
}

export function RuleList({ rules, isOwner, onToggle, onEdit, onDelete }: RuleListProps) {
  const [pendingId, setPendingId] = useState<string | null>(null);

  const handleToggle = async (rule: RuleResponse) => {
    if (!isOwner || pendingId) return;
    setPendingId(rule.id);
    try {
      await onToggle(rule.id, !rule.enabled);
    } finally {
      setPendingId(null);
    }
  };

  if (rules.length === 0) {
    return (
      <p className="text-sm text-neutral-500 dark:text-neutral-400">
        No automation rules yet. Create your first rule to get started.
      </p>
    );
  }

  return (
    <ul className="flex flex-col gap-3" role="list" aria-label="Automation rules">
      {rules.map((rule) => (
        <li
          key={rule.id}
          className="rounded-lg border border-neutral-200 bg-white p-4 dark:border-neutral-800 dark:bg-neutral-900"
        >
          <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
            <div className="flex-1">
              <div className="flex items-center gap-2">
                <h3 className="text-sm font-medium text-neutral-900 dark:text-neutral-50">{rule.name}</h3>
                {!rule.enabled ? (
                  <span className="rounded-full bg-neutral-100 px-2 py-0.5 text-xs text-neutral-600 dark:bg-neutral-800 dark:text-neutral-300">
                    Disabled
                  </span>
                ) : null}
              </div>
              {rule.description ? (
                <p className="mt-1 text-sm text-neutral-600 dark:text-neutral-300">{rule.description}</p>
              ) : null}
              <p className="mt-1 text-xs text-neutral-500 dark:text-neutral-400">
                Trigger: <code className="rounded bg-neutral-100 px-1 dark:bg-neutral-800">{rule.triggerType}</code>
                {' · '}Priority: {rule.priority}
              </p>
            </div>
            {isOwner ? (
              <div className="flex flex-wrap items-center gap-2">
                <button
                  type="button"
                  onClick={() => handleToggle(rule)}
                  disabled={pendingId === rule.id}
                  aria-pressed={rule.enabled}
                  aria-label={`${rule.enabled ? 'Disable' : 'Enable'} rule ${rule.name}`}
                  className={`relative inline-flex h-6 w-11 shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors duration-200 ease-in-out focus:outline-none focus:ring-2 focus:ring-neutral-500 focus:ring-offset-2 disabled:opacity-50 ${
                    rule.enabled ? 'bg-neutral-900 dark:bg-neutral-100' : 'bg-neutral-200 dark:bg-neutral-700'
                  }`}
                >
                  <span
                    aria-hidden="true"
                    className={`pointer-events-none inline-block h-5 w-5 transform rounded-full bg-white shadow ring-0 transition duration-200 ease-in-out dark:bg-neutral-900 ${
                      rule.enabled ? 'translate-x-5' : 'translate-x-0'
                    }`}
                  />
                </button>
                <button
                  type="button"
                  onClick={() => onEdit(rule)}
                  className="inline-flex items-center justify-center rounded-md border border-neutral-300 px-3 py-1.5 text-sm hover:border-neutral-900 dark:border-neutral-700 dark:hover:border-neutral-100"
                >
                  Edit
                </button>
                <button
                  type="button"
                  onClick={() => onDelete(rule)}
                  className="inline-flex items-center justify-center rounded-md border border-red-200 px-3 py-1.5 text-sm font-medium text-red-700 transition hover:border-red-400 hover:text-red-800 dark:border-red-900/40 dark:text-red-300 dark:hover:border-red-700"
                >
                  Delete
                </button>
              </div>
            ) : null}
          </div>
        </li>
      ))}
    </ul>
  );
}
