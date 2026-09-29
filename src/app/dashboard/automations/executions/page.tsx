import Link from 'next/link';
import { prisma } from '@/lib/db/prisma';
import { getCurrentMembership } from '@/lib/workspace/server';
import { listAutomationExecutions } from '@/lib/automation/executions';
import {
  AUTOMATION_EXECUTION_STATUSES,
  parseExecutionHistorySearchParams,
  toUtcDateTimeLocalValue,
} from '@/lib/automation/executions-schema';
import { ExecutionList } from '@/components/automations/execution-list';
import { EmptyState } from '@/components/automations/empty-state';

function buildPaginationQuery(resolved: Record<string, string | string[] | undefined>, page: number) {
  const entries = Object.entries(resolved)
    .filter(([, value]) => value !== '' && value !== undefined)
    .map(([key, value]) => [key, Array.isArray(value) ? value[0] : value] as const);
  return new URLSearchParams({ ...Object.fromEntries(entries), page: String(page) }).toString();
}

type ExecutionsPageProps = {
  searchParams?: Promise<{ [key: string]: string | string[] | undefined }>;
};

/**
 * Workspace-scoped automation execution history.
 *
 * All filtering and pagination happens server-side in
 * `listAutomationExecutions`; the page never filters a full dataset on the
 * client. Invalid query values fall back to defaults (the API layer is the
 * strict surface and answers 400 instead).
 */
export default async function AutomationExecutionsPage({ searchParams }: ExecutionsPageProps) {
  const resolved = searchParams ? await searchParams : {};
  const filters = parseExecutionHistorySearchParams(resolved);

  const membership = await getCurrentMembership();
  const [result, rules] = await Promise.all([
    listAutomationExecutions(filters),
    prisma.automationRule.findMany({
      where: { workspaceId: membership.workspaceId },
      select: { id: true, name: true },
      orderBy: [{ priority: 'asc' }, { name: 'asc' }],
    }),
  ]);

  const hasActiveFilters = Boolean(
    filters.status ||
      filters.ruleId ||
      filters.sourceEventType ||
      filters.ticketId ||
      filters.from ||
      filters.to,
  );

  return (
    <div className="mx-auto max-w-5xl px-4 py-10">
      <div className="flex flex-col gap-6">
        <header className="flex flex-col gap-1 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <Link
              href="/dashboard/automations"
              className="text-sm text-neutral-600 hover:text-neutral-900 dark:text-neutral-400 dark:hover:text-neutral-100"
            >
              ← Back to automations
            </Link>
            <h1 className="mt-2 text-2xl font-semibold">Execution history</h1>
            <p className="mt-2 text-sm text-neutral-600 dark:text-neutral-300">
              Every automation run in this workspace, including runs whose rule has since been
              deleted.
            </p>
          </div>
        </header>

        <form
          method="get"
          className="grid grid-cols-1 gap-3 rounded-lg border border-neutral-200 bg-white p-4 sm:grid-cols-2 lg:grid-cols-3 dark:border-neutral-800 dark:bg-neutral-900"
          aria-label="Filter execution history"
        >
          <label className="flex flex-col gap-1 text-xs font-medium text-neutral-600 dark:text-neutral-300">
            Status
            <select
              name="status"
              defaultValue={filters.status ?? ''}
              className="rounded-md border border-neutral-300 bg-white px-2 py-1.5 text-sm dark:border-neutral-700 dark:bg-neutral-900"
            >
              <option value="">All statuses</option>
              {AUTOMATION_EXECUTION_STATUSES.map((status) => (
                <option key={status} value={status}>
                  {status}
                </option>
              ))}
            </select>
          </label>

          <label className="flex flex-col gap-1 text-xs font-medium text-neutral-600 dark:text-neutral-300">
            Rule
            <select
              name="ruleId"
              defaultValue={filters.ruleId ?? ''}
              className="rounded-md border border-neutral-300 bg-white px-2 py-1.5 text-sm dark:border-neutral-700 dark:bg-neutral-900"
            >
              <option value="">All rules</option>
              {rules.map((rule) => (
                <option key={rule.id} value={rule.id}>
                  {rule.name}
                </option>
              ))}
            </select>
          </label>

          <label className="flex flex-col gap-1 text-xs font-medium text-neutral-600 dark:text-neutral-300">
            Trigger / event type
            <input
              type="text"
              name="triggerType"
              defaultValue={filters.sourceEventType ?? ''}
              placeholder="e.g. TICKET_CREATED"
              className="rounded-md border border-neutral-300 bg-white px-2 py-1.5 text-sm dark:border-neutral-700 dark:bg-neutral-900"
            />
          </label>

          <label className="flex flex-col gap-1 text-xs font-medium text-neutral-600 dark:text-neutral-300">
            Ticket ID
            <input
              type="text"
              name="ticketId"
              defaultValue={filters.ticketId ?? ''}
              className="rounded-md border border-neutral-300 bg-white px-2 py-1.5 text-sm dark:border-neutral-700 dark:bg-neutral-900"
            />
          </label>

          <label className="flex flex-col gap-1 text-xs font-medium text-neutral-600 dark:text-neutral-300">
            From (UTC, inclusive)
            <input
              type="datetime-local"
              name="from"
              defaultValue={toUtcDateTimeLocalValue(filters.from)}
              className="rounded-md border border-neutral-300 bg-white px-2 py-1.5 text-sm dark:border-neutral-700 dark:bg-neutral-900"
            />
          </label>

          <label className="flex flex-col gap-1 text-xs font-medium text-neutral-600 dark:text-neutral-300">
            To (UTC, exclusive)
            <input
              type="datetime-local"
              name="to"
              defaultValue={toUtcDateTimeLocalValue(filters.to)}
              className="rounded-md border border-neutral-300 bg-white px-2 py-1.5 text-sm dark:border-neutral-700 dark:bg-neutral-900"
            />
          </label>

          <div className="flex items-end gap-2 sm:col-span-2 lg:col-span-3">
            <button
              type="submit"
              className="inline-flex items-center justify-center rounded-md bg-neutral-900 px-3 py-2 text-sm font-medium text-white hover:bg-neutral-800 dark:bg-neutral-100 dark:text-neutral-900 dark:hover:bg-neutral-200"
            >
              Apply filters
            </button>
            <Link
              href="/dashboard/automations/executions"
              className="inline-flex items-center justify-center rounded-md border border-neutral-300 px-3 py-2 text-sm hover:border-neutral-900 dark:border-neutral-700 dark:hover:border-neutral-100"
            >
              Reset
            </Link>
          </div>
        </form>

        {result.data.length === 0 ? (
          <EmptyState
            title={hasActiveFilters ? 'No executions match these filters' : 'No automation executions yet'}
            description={
              hasActiveFilters
                ? 'Adjust or reset the filters to see more execution history.'
                : 'Execution history appears here once an automation rule runs.'
            }
          />
        ) : (
          <ExecutionList executions={result.data} />
        )}

        <nav
          className="flex flex-wrap items-center justify-between gap-3 text-sm"
          aria-label="Execution history pagination"
        >
          <span className="min-w-0 text-neutral-600 dark:text-neutral-300">
            Page {result.page} of {result.totalPages} • {result.total} execution
            {result.total === 1 ? '' : 's'}
          </span>
          <div className="flex flex-wrap items-center gap-2">
            {result.hasPreviousPage ? (
              <Link
                href={`?${buildPaginationQuery(resolved, result.page - 1)}`}
                className="inline-flex items-center justify-center rounded-md border border-neutral-300 px-3 py-2 hover:border-neutral-900 dark:border-neutral-700 dark:hover:border-neutral-100"
              >
                Previous
              </Link>
            ) : (
              <span
                aria-disabled="true"
                className="inline-flex items-center justify-center rounded-md border border-neutral-300 px-3 py-2 opacity-60 dark:border-neutral-700"
              >
                Previous
              </span>
            )}
            {result.hasNextPage ? (
              <Link
                href={`?${buildPaginationQuery(resolved, result.page + 1)}`}
                className="inline-flex items-center justify-center rounded-md border border-neutral-300 px-3 py-2 hover:border-neutral-900 dark:border-neutral-700 dark:hover:border-neutral-100"
              >
                Next
              </Link>
            ) : (
              <span
                aria-disabled="true"
                className="inline-flex items-center justify-center rounded-md border border-neutral-300 px-3 py-2 opacity-60 dark:border-neutral-700"
              >
                Next
              </span>
            )}
          </div>
        </nav>
      </div>
    </div>
  );
}
