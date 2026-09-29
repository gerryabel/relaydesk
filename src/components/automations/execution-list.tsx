import Link from 'next/link';
import type { AutomationExecutionListItem } from '@/lib/automation/executions';
import {
  ExecutionStatusBadge,
  formatDateTime,
  formatDuration,
} from './execution-status';

export interface ExecutionListProps {
  executions: AutomationExecutionListItem[];
}

/**
 * Workspace execution history rows.
 *
 * Server-rendered: rows link to the execution detail view and surface the
 * failure/skip context an operator needs to triage an automation run.
 */
export function ExecutionList({ executions }: ExecutionListProps) {
  return (
    <ul className="flex flex-col gap-3" role="list" aria-label="Automation execution history">
      {executions.map((execution) => (
        <li
          key={execution.id}
          className="rounded-lg border border-neutral-200 bg-white p-4 dark:border-neutral-800 dark:bg-neutral-900"
        >
          <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
            <div className="min-w-0 flex-1">
              <div className="flex flex-wrap items-center gap-2">
                <ExecutionStatusBadge status={execution.status} />
                <Link
                  href={`/dashboard/automations/executions/${execution.id}`}
                  className="truncate text-sm font-medium text-neutral-900 hover:underline dark:text-neutral-50"
                >
                  {execution.ruleNameSnapshot}
                </Link>
                {execution.ruleId === null ? (
                  <span className="rounded-full bg-amber-50 px-2 py-0.5 text-xs text-amber-700 dark:bg-amber-950 dark:text-amber-300">
                    Rule deleted
                  </span>
                ) : null}
              </div>

              <p className="mt-1 text-xs text-neutral-500 dark:text-neutral-400">
                Trigger:{' '}
                <code className="rounded bg-neutral-100 px-1 dark:bg-neutral-800">
                  {execution.sourceEventType}
                </code>
                {execution.ticketId ? (
                  <>
                    {' · '}
                    Ticket:{' '}
                    <Link
                      href={`/dashboard/tickets/${execution.ticketId}`}
                      className="hover:underline"
                    >
                      {execution.ticketId}
                    </Link>
                  </>
                ) : null}
              </p>

              <p className="mt-1 text-xs text-neutral-500 dark:text-neutral-400">
                {formatDateTime(execution.createdAt)} · Duration {formatDuration(execution.durationMs)} ·{' '}
                {execution.actionCount} action{execution.actionCount === 1 ? '' : 's'}
                {execution.failedActionCount > 0
                  ? ` · ${execution.failedActionCount} failed`
                  : ''}
              </p>

              {execution.skipReason ? (
                <p className="mt-2 text-xs text-neutral-600 dark:text-neutral-300">
                  Skipped: {execution.skipReason}
                </p>
              ) : null}
              {execution.error ? (
                <p className="mt-2 break-words text-xs text-red-700 dark:text-red-300">
                  Error: {execution.error}
                </p>
              ) : null}
            </div>

            <div className="flex shrink-0 items-center gap-2">
              {execution.isRetryable ? (
                <span className="rounded-full bg-amber-50 px-2 py-0.5 text-xs text-amber-700 dark:bg-amber-950 dark:text-amber-300">
                  Retry available
                </span>
              ) : null}
              <Link
                href={`/dashboard/automations/executions/${execution.id}`}
                className="inline-flex items-center justify-center rounded-md border border-neutral-300 px-3 py-1.5 text-sm hover:border-neutral-900 dark:border-neutral-700 dark:hover:border-neutral-100"
              >
                Details
              </Link>
            </div>
          </div>
        </li>
      ))}
    </ul>
  );
}
