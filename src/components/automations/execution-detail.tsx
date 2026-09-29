import Link from 'next/link';
import type { AutomationExecutionDetailResult } from '@/lib/automation/executions';
import {
  ActionStatusBadge,
  ExecutionStatusBadge,
  formatDateTime,
  formatDuration,
} from './execution-status';
import { JsonBlock } from './json-block';
import { RetryActionButton } from './retry-action-button';

export interface ExecutionDetailProps {
  detail: AutomationExecutionDetailResult;
}

function DetailRow({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex flex-col gap-0.5 border-b border-neutral-100 py-2 last:border-b-0 sm:flex-row sm:items-start sm:gap-4 dark:border-neutral-800">
      <dt className="w-full shrink-0 text-xs font-medium text-neutral-500 sm:w-44 dark:text-neutral-400">
        {label}
      </dt>
      <dd className="min-w-0 flex-1 break-words text-sm text-neutral-900 dark:text-neutral-100">
        {children}
      </dd>
    </div>
  );
}

function MonospaceId({ value }: { value: string | null }) {
  if (!value) return <span className="text-neutral-500 dark:text-neutral-400">—</span>;
  return <code className="break-all text-xs">{value}</code>;
}

/**
 * Execution detail / debugging view.
 *
 * Everything rendered here comes from the historical execution record:
 * `ruleNameSnapshot`, the source outbox event, and each action's stored
 * `actionConfig`. The current automation rule is shown only as supplementary
 * context and may legitimately be absent after a rule deletion.
 */
export function ExecutionDetail({ detail }: ExecutionDetailProps) {
  const { execution, actions, sourceEvent, canRetry } = detail;

  return (
    <div className="flex flex-col gap-6">
      <section className="rounded-lg border border-neutral-200 bg-white p-5 dark:border-neutral-800 dark:bg-neutral-900">
        <div className="mb-3 flex flex-wrap items-center gap-2">
          <ExecutionStatusBadge status={execution.status} />
          <h2 className="text-base font-semibold">{execution.ruleNameSnapshot}</h2>
        </div>

        <dl>
          <DetailRow label="Execution ID">
            <MonospaceId value={execution.id} />
          </DetailRow>
          <DetailRow label="Workspace ID">
            <MonospaceId value={execution.workspaceId} />
          </DetailRow>
          <DetailRow label="Rule">
            {execution.rule ? (
              <span className="flex flex-wrap items-center gap-2">
                <span>{execution.rule.name}</span>
                <span className="text-xs text-neutral-500 dark:text-neutral-400">
                  trigger: {execution.rule.triggerType} · {execution.rule.enabled ? 'enabled' : 'disabled'}
                </span>
              </span>
            ) : (
              <span className="text-neutral-600 dark:text-neutral-300">
                {execution.ruleNameSnapshot} — originating rule no longer exists.
              </span>
            )}
          </DetailRow>
          <DetailRow label="Rule ID">
            {execution.ruleId === null ? (
              <span className="text-neutral-500 dark:text-neutral-400">
                null (rule deleted — historical snapshot retained)
              </span>
            ) : (
              <MonospaceId value={execution.ruleId} />
            )}
          </DetailRow>
          <DetailRow label="Source event type">
            <code className="rounded bg-neutral-100 px-1 text-xs dark:bg-neutral-800">
              {execution.sourceEventType}
            </code>
          </DetailRow>
          <DetailRow label="Source event ID">
            <MonospaceId value={execution.sourceEventId} />
          </DetailRow>
          <DetailRow label="Source aggregate ID">
            <MonospaceId value={execution.sourceAggregateId} />
          </DetailRow>
          <DetailRow label="Ticket">
            {execution.ticketId ? (
              <Link
                href={`/dashboard/tickets/${execution.ticketId}`}
                className="break-all text-xs hover:underline"
              >
                {execution.ticketId}
              </Link>
            ) : (
              <span className="text-neutral-500 dark:text-neutral-400">—</span>
            )}
          </DetailRow>
          <DetailRow label="Conditions evaluated">
            {execution.evaluatedConditions ? 'Yes' : 'No'}
          </DetailRow>
          {execution.skipReason ? (
            <DetailRow label="Skip reason">{execution.skipReason}</DetailRow>
          ) : null}
          {execution.error ? (
            <DetailRow label="Execution error">
              <span className="text-red-700 dark:text-red-300">{execution.error}</span>
            </DetailRow>
          ) : null}
          <DetailRow label="Lease">
            {execution.leasedBy || execution.leasedAt
              ? `${execution.leasedBy ?? 'unknown worker'} · expires ${formatDateTime(execution.leasedAt)}`
              : 'No active lease'}
          </DetailRow>
          <DetailRow label="Created">{formatDateTime(execution.createdAt)}</DetailRow>
          <DetailRow label="Started">{formatDateTime(execution.startedAt)}</DetailRow>
          <DetailRow label="Completed">{formatDateTime(execution.completedAt)}</DetailRow>
          <DetailRow label="Duration">{formatDuration(execution.durationMs)}</DetailRow>
        </dl>
      </section>

      <section className="rounded-lg border border-neutral-200 bg-white p-5 dark:border-neutral-800 dark:bg-neutral-900">
        <h2 className="mb-3 text-base font-semibold">
          Actions ({actions.length})
        </h2>

        {actions.length === 0 ? (
          <p className="text-sm text-neutral-500 dark:text-neutral-400">
            This execution produced no action records.
          </p>
        ) : (
          <ol className="flex flex-col gap-4" aria-label="Automation action timeline">
            {actions.map((action) => (
              <li
                key={action.id}
                className="rounded-md border border-neutral-200 p-4 dark:border-neutral-800"
              >
                <div className="flex flex-wrap items-start justify-between gap-2">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="text-xs font-medium text-neutral-500 dark:text-neutral-400">
                      #{action.actionIndex}
                    </span>
                    <code className="rounded bg-neutral-100 px-1 text-xs dark:bg-neutral-800">
                      {action.actionType}
                    </code>
                    <ActionStatusBadge status={action.status} />
                    {action.isFinalAction ? (
                      <span className="rounded-full bg-neutral-100 px-2 py-0.5 text-xs text-neutral-600 dark:bg-neutral-800 dark:text-neutral-300">
                        Final action
                      </span>
                    ) : null}
                  </div>

                  {canRetry && action.isRetryable ? (
                    <RetryActionButton
                      executionId={execution.id}
                      actionIndex={action.actionIndex}
                    />
                  ) : null}
                </div>

                <p className="mt-2 text-xs text-neutral-500 dark:text-neutral-400">
                  Started {formatDateTime(action.startedAt)} · Completed{' '}
                  {formatDateTime(action.completedAt)} · Duration {formatDuration(action.durationMs)}
                </p>

                {action.error ? (
                  <p className="mt-2 break-words text-xs text-red-700 dark:text-red-300">
                    Error: {action.error}
                  </p>
                ) : null}

                <div className="mt-3">
                  <JsonBlock value={action.actionConfig} label="Action configuration (as executed)" />
                </div>
              </li>
            ))}
          </ol>
        )}

        {!canRetry && actions.some((action) => action.isFinalAction && action.status === 'failed') ? (
          <p className="mt-4 text-xs text-neutral-500 dark:text-neutral-400">
            Manual retry is restricted to workspace owners.
          </p>
        ) : null}
      </section>

      <section className="rounded-lg border border-neutral-200 bg-white p-5 dark:border-neutral-800 dark:bg-neutral-900">
        <h2 className="mb-3 text-base font-semibold">Source event</h2>

        {sourceEvent ? (
          <div className="flex flex-col gap-3">
            <dl>
              <DetailRow label="Event ID">
                <MonospaceId value={sourceEvent.id} />
              </DetailRow>
              <DetailRow label="Event type">
                <code className="rounded bg-neutral-100 px-1 text-xs dark:bg-neutral-800">
                  {sourceEvent.eventType}
                </code>
              </DetailRow>
              <DetailRow label="Aggregate">
                {sourceEvent.aggregateType}:{sourceEvent.aggregateId}
              </DetailRow>
              <DetailRow label="Created">{formatDateTime(sourceEvent.createdAt)}</DetailRow>
              <DetailRow label="Attempts">{sourceEvent.attempts}</DetailRow>
              <DetailRow label="Completed">{formatDateTime(sourceEvent.completedAt)}</DetailRow>
              {sourceEvent.lastError ? (
                <DetailRow label="Last error">
                  <span className="break-words text-red-700 dark:text-red-300">
                    {sourceEvent.lastError}
                  </span>
                </DetailRow>
              ) : null}
            </dl>
            <JsonBlock value={sourceEvent.payload} label="Event payload" />
          </div>
        ) : (
          <p className="text-sm text-neutral-500 dark:text-neutral-400">
            The originating outbox event is no longer available. Execution history above is unaffected.
          </p>
        )}
      </section>
    </div>
  );
}
