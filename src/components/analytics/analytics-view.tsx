'use client';

import { useState, useTransition } from 'react';
import type { AnalyticsResult } from '@/lib/analytics/types';
import { EmptyState } from '@/components/ui/empty-state';
import { Card, CardHeader, CardTitle, CardDescription, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Button } from '@/components/ui/button';

type AnalyticsViewProps = {
  data: AnalyticsResult;
  basePath?: string;
};

type FormState = {
  status: 'idle' | 'success' | 'error';
  message: string | null;
};

const STATUS_LABELS: Record<string, string> = {
  open: 'Open',
  in_progress: 'In progress',
  waiting_customer: 'Waiting on customer',
  resolved: 'Resolved',
  closed: 'Closed',
};

const PRIORITY_LABELS: Record<string, string> = {
  low: 'Low',
  medium: 'Medium',
  high: 'High',
  urgent: 'Urgent',
};

const STATUS_ORDER = ['open', 'in_progress', 'waiting_customer', 'resolved', 'closed'];
const PRIORITY_ORDER = ['low', 'medium', 'high', 'urgent'];

function formatDate(iso: string): string {
  const date = new Date(`${iso}T00:00:00Z`);
  if (Number.isNaN(date.getTime())) return iso;
  return date.toLocaleDateString(undefined, {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
    timeZone: 'UTC',
  });
}

function StatTile({ label, value, hint }: { label: string; value: string; hint?: string }) {
  return (
    <Card className="p-4">
      <p className="text-xs font-medium uppercase tracking-wide text-neutral-500 dark:text-neutral-400">
        {label}
      </p>
      <p className="mt-1 text-2xl font-semibold tabular-nums text-neutral-900 dark:text-neutral-50">
        {value}
      </p>
      {hint ? (
        <p className="mt-1 text-xs text-neutral-500 dark:text-neutral-400">{hint}</p>
      ) : null}
    </Card>
  );
}

function DistributionCard({
  title,
  description,
  entries,
}: {
  title: string;
  description: string;
  entries: { key: string; label: string; count: number }[];
}) {
  const total = entries.reduce((sum, e) => sum + e.count, 0);
  return (
    <Card>
      <CardHeader>
        <CardTitle>{title}</CardTitle>
        <CardDescription>{description}</CardDescription>
      </CardHeader>
      <CardContent>
        {total === 0 ? (
          <EmptyState
            title="No data"
            description="There are no tickets to categorize in this workspace."
          />
        ) : (
          <ul className="flex flex-col gap-2" aria-label={title}>
            {entries.map((entry) => {
              const pct = total > 0 ? Math.round((entry.count / total) * 100) : 0;
              return (
                <li key={entry.key} className="flex items-center gap-3">
                  <span className="w-36 shrink-0 text-sm text-neutral-700 dark:text-neutral-200">
                    {entry.label}
                  </span>
                  <div
                    className="h-2 rounded-full bg-blue-500/70 dark:bg-blue-400/70"
                    style={{ width: `${Math.max(pct, entry.count > 0 ? 4 : 0)}%` }}
                    role="img"
                    aria-label={`${entry.label}: ${entry.count}`}
                  />
                  <span className="text-sm font-medium tabular-nums text-neutral-900 dark:text-neutral-50">
                    {entry.count}
                  </span>
                </li>
              );
            })}
          </ul>
        )}
      </CardContent>
    </Card>
  );
}

function DailyActivity({ daily }: { daily: AnalyticsResult['daily'] }) {
  const maxCreated = Math.max(1, ...daily.map((d) => d.ticketVolume));
  const maxResolved = Math.max(1, ...daily.map((d) => d.resolutionCount));
  return (
    <Card>
      <CardHeader>
        <CardTitle>Daily activity</CardTitle>
        <CardDescription>
          Tickets created and resolved per UTC calendar day within the selected range.
        </CardDescription>
      </CardHeader>
      <CardContent>
        {daily.length === 0 ? (
          <EmptyState title="No days" description="The selected range is empty." />
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm" aria-label="Daily ticket activity">
              <thead>
                <tr className="text-left text-xs uppercase tracking-wide text-neutral-500 dark:text-neutral-400">
                  <th scope="col" className="pb-2 pr-4 font-medium">Date (UTC)</th>
                  <th scope="col" className="pb-2 pr-4 font-medium">Created</th>
                  <th scope="col" className="pb-2 font-medium">Resolved</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-neutral-100 dark:divide-neutral-800">
                {daily.map((point) => (
                  <tr key={point.date}>
                    <td className="py-1.5 pr-4 text-neutral-700 dark:text-neutral-200">
                      {formatDate(point.date)}
                    </td>
                    <td className="py-1.5 pr-4">
                      <span className="tabular-nums font-medium text-neutral-900 dark:text-neutral-50">
                        {point.ticketVolume}
                      </span>
                      <span
                        aria-hidden="true"
                        className="ml-2 text-xs text-blue-600 dark:text-blue-400"
                      >
                        {'█'.repeat(Math.ceil((point.ticketVolume / maxCreated) * 10))}
                      </span>
                    </td>
                    <td className="py-1.5">
                      <span className="tabular-nums font-medium text-neutral-900 dark:text-neutral-50">
                        {point.resolutionCount}
                      </span>
                      <span
                        aria-hidden="true"
                        className="ml-2 text-xs text-emerald-600 dark:text-emerald-400"
                      >
                        {'█'.repeat(Math.ceil((point.resolutionCount / maxResolved) * 10))}
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

function AssignmentDistribution({
  assignments,
}: {
  assignments: NonNullable<AnalyticsResult['owner']>['assignmentDistribution'];
}) {
  return (
    <Card>
      <CardHeader>
        <CardTitle>Assignment distribution</CardTitle>
        <CardDescription>
          Currently assigned tickets per workspace member. Owner-only view — reflects current state, not the selected period.
        </CardDescription>
      </CardHeader>
      <CardContent>
        {assignments.length === 0 ? (
          <EmptyState title="No members" description="This workspace has no members yet." />
        ) : (
          <ul className="flex flex-col gap-2" aria-label="Assignment distribution">
            {assignments.map((agent) => (
              <li
                key={agent.userId}
                className="flex items-center justify-between gap-3"
              >
                <div className="min-w-0">
                  <p className="truncate text-sm font-medium text-neutral-900 dark:text-neutral-50">
                    {agent.name}
                  </p>
                  <p className="truncate text-xs text-neutral-500 dark:text-neutral-400">
                    {agent.email}
                  </p>
                </div>
                <Badge tone={agent.assignedCount > 0 ? 'blue' : 'neutral'}>
                  {agent.assignedCount} assigned
                </Badge>
              </li>
            ))}
          </ul>
        )}
      </CardContent>
    </Card>
  );
}

export default function AnalyticsView({ data, basePath = '/dashboard/analytics' }: AnalyticsViewProps) {
  const [from, setFrom] = useState(data.range.from);
  const [to, setTo] = useState(data.range.to);
  const [formState, setFormState] = useState<FormState>({ status: 'idle', message: null });
  const [isPending, startTransition] = useTransition();

  function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setFormState({ status: 'idle', message: null });

    const trimmedFrom = from.trim();
    const trimmedTo = to.trim();

    if (!/^\d{4}-\d{2}-\d{2}$/.test(trimmedFrom) || !/^\d{4}-\d{2}-\d{2}$/.test(trimmedTo)) {
      setFormState({ status: 'error', message: 'Dates must be in YYYY-MM-DD format.' });
      return;
    }

    startTransition(() => {
      window.location.href = `${basePath}?from=${encodeURIComponent(trimmedFrom)}&to=${encodeURIComponent(trimmedTo)}`;
    });
  }

  const statusEntries = STATUS_ORDER.map((key) => ({
    key,
    label: STATUS_LABELS[key] ?? key,
    count: (data.statusDistribution as Record<string, number>)[key] ?? 0,
  }));

  const priorityEntries = PRIORITY_ORDER.map((key) => ({
    key,
    label: PRIORITY_LABELS[key] ?? key,
    count: (data.priorityDistribution as Record<string, number>)[key] ?? 0,
  }));

  return (
    <div className="flex flex-col gap-6">
      <Card>
        <CardHeader>
          <CardTitle>Date range</CardTitle>
          <CardDescription>
            Select a UTC calendar-day range. Both dates are inclusive; queries use [start, end) with end = the day after `to` at 00:00:00 UTC.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <form onSubmit={handleSubmit} className="flex flex-col gap-3" noValidate>
            <div className="flex flex-col gap-3 sm:flex-row sm:items-end">
              <div className="flex flex-col gap-1">
                <Label htmlFor="analytics-from">From (inclusive)</Label>
                <Input
                  id="analytics-from"
                  type="date"
                  value={from}
                  onChange={(event) => setFrom(event.target.value)}
                  disabled={isPending}
                  aria-invalid={formState.status === 'error' ? true : undefined}
                  aria-describedby={formState.message ? 'analytics-range-error' : undefined}
                />
              </div>
              <div className="flex flex-col gap-1">
                <Label htmlFor="analytics-to">To (inclusive)</Label>
                <Input
                  id="analytics-to"
                  type="date"
                  value={to}
                  onChange={(event) => setTo(event.target.value)}
                  disabled={isPending}
                  aria-invalid={formState.status === 'error' ? true : undefined}
                  aria-describedby={formState.message ? 'analytics-range-error' : undefined}
                />
              </div>
              <div className="flex flex-col gap-1">
                <span className="text-xs text-transparent">Apply</span>
                <Button type="submit" disabled={isPending}>
                  {isPending ? 'Loading…' : 'Apply range'}
                </Button>
              </div>
            </div>
            {formState.message ? (
              <p id="analytics-range-error" role="alert" className="text-xs text-red-600 dark:text-red-400">
                {formState.message}
              </p>
            ) : null}
          </form>
          <p className="mt-3 text-xs text-neutral-500 dark:text-neutral-400">
            Selected: {formatDate(data.range.from)} – {formatDate(data.range.to)} ({data.range.totalDays} days).
          </p>
        </CardContent>
      </Card>

      <section aria-label="Period metrics" className="flex flex-col gap-1">
        <h2 className="text-lg font-semibold text-neutral-900 dark:text-neutral-50">Period metrics</h2>
        <p className="text-sm text-neutral-600 dark:text-neutral-300">
          These metrics are bound to the selected date range above.
        </p>
      </section>

      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
        <StatTile label="Ticket volume" value={String(data.ticketVolume)} hint="created in range" />
        <StatTile label="Resolution count" value={String(data.resolutionCount)} hint="resolved in range" />
        <StatTile
          label="Average resolution time"
          value={data.averageResolutionTime.human ?? '—'}
          hint={
            data.averageResolutionTime.count > 0
              ? `${data.averageResolutionTime.count} resolved ticket${data.averageResolutionTime.count === 1 ? '' : 's'}`
              : 'no resolved tickets in this period'
          }
        />
      </div>

      <DailyActivity daily={data.daily} />

      <section aria-label="Current snapshot metrics" className="flex flex-col gap-1">
        <h2 className="text-lg font-semibold text-neutral-900 dark:text-neutral-50">Current snapshot</h2>
        <p className="text-sm text-neutral-600 dark:text-neutral-300">
          These metrics reflect current persisted state at query time, independent of the selected period.
        </p>
      </section>

      <div className="grid grid-cols-1 gap-3 lg:grid-cols-2">
        <DistributionCard
          title="Status distribution"
          description="Count of tickets grouped by their current status."
          entries={statusEntries}
        />
        <DistributionCard
          title="Priority distribution"
          description="Count of tickets grouped by their current priority."
          entries={priorityEntries}
        />
      </div>

      <div className="grid grid-cols-2 gap-3 sm:grid-cols-2">
        <StatTile label="SLA at risk" value={String(data.slaRiskCount)} hint="currently open, response or resolution SLA at risk" />
        <StatTile label="SLA breached" value={String(data.slaBreachCount)} hint="response or resolution SLA breached" />
      </div>

      {data.owner?.assignmentDistribution ? (
        <>
          <section aria-label="Assignment distribution" className="flex flex-col gap-1">
            <h2 className="text-lg font-semibold text-neutral-900 dark:text-neutral-50">Assignment distribution</h2>
            <p className="text-sm text-neutral-600 dark:text-neutral-300">
              Owner-only · currently assigned tickets per member.
            </p>
          </section>
          <AssignmentDistribution assignments={data.owner.assignmentDistribution} />
        </>
      ) : null}
    </div>
  );
}
