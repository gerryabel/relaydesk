'use client';

import { type AgentWorkload, type WorkloadSummary } from '@/lib/workload/server';
import { Badge } from '@/components/ui/badge';
import { Card, CardHeader, CardTitle, CardDescription, CardContent } from '@/components/ui/card';
import { EmptyState } from '@/components/ui/empty-state';

type AgentWorkloadProps = {
  members: AgentWorkload[];
  summary: WorkloadSummary;
};

function getInitials(name: string): string {
  const trimmed = name.trim();
  if (!trimmed) return '?';
  const parts = trimmed.split(/\s+/);
  if (parts.length === 1) return parts[0]!.charAt(0).toUpperCase();
  return (parts[0]!.charAt(0) + parts[parts.length - 1]!.charAt(0)).toUpperCase();
}

function formatJoinedDate(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return iso;
  return date.toLocaleDateString(undefined, {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
  });
}

function SummaryCard({
  label,
  value,
  tone = 'neutral',
}: {
  label: string;
  value: number;
  tone?: 'neutral' | 'blue' | 'amber' | 'emerald' | 'red';
}) {
  return (
    <Card className="p-4">
      <p className="text-xs font-medium uppercase tracking-wide text-neutral-500 dark:text-neutral-400">
        {label}
      </p>
      <p className="mt-1 text-2xl font-semibold tabular-nums text-neutral-900 dark:text-neutral-50">
        {value}
      </p>
      <div className="mt-2">
        <Badge tone={tone}>{label}</Badge>
      </div>
    </Card>
  );
}

function AgentCard({ member }: { member: AgentWorkload }) {
  const isOwner = member.role === 'owner';

  return (
    <Card className="p-4">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
        <div className="flex min-w-0 items-center gap-3">
          <div
            aria-hidden="true"
            className="flex h-10 w-10 flex-none items-center justify-center rounded-full bg-neutral-200 text-sm font-medium text-neutral-700 dark:bg-neutral-700 dark:text-neutral-200"
          >
            {getInitials(member.name)}
          </div>
          <div className="min-w-0">
            <p className="truncate text-sm font-medium text-neutral-900 dark:text-neutral-50">
              {member.name}
            </p>
            <p className="truncate text-xs text-neutral-500 dark:text-neutral-400">
              {member.email}
            </p>
            <p className="mt-1 text-xs text-neutral-400 dark:text-neutral-500">
              Joined {formatJoinedDate(member.joinedAt)}
            </p>
            <div className="mt-2">
              <Badge tone={isOwner ? 'blue' : 'neutral'}>{member.role}</Badge>
            </div>
          </div>
        </div>

        <dl
          className="grid grid-cols-2 gap-x-6 gap-y-2 text-sm sm:grid-cols-3"
          aria-label={`Workload for ${member.name}`}
        >
          <div>
            <dt className="text-xs text-neutral-500 dark:text-neutral-400">Total</dt>
            <dd className="tabular-nums font-medium text-neutral-900 dark:text-neutral-50">
              {member.totalAssigned}
            </dd>
          </div>
          <div>
            <dt className="text-xs text-neutral-500 dark:text-neutral-400">Active</dt>
            <dd className="tabular-nums font-medium text-neutral-900 dark:text-neutral-50">
              {member.active}
            </dd>
          </div>
          <div>
            <dt className="text-xs text-neutral-500 dark:text-neutral-400">Open</dt>
            <dd className="tabular-nums text-neutral-700 dark:text-neutral-200">
              {member.open}
            </dd>
          </div>
          <div>
            <dt className="text-xs text-neutral-500 dark:text-neutral-400">In progress</dt>
            <dd className="tabular-nums text-neutral-700 dark:text-neutral-200">
              {member.inProgress}
            </dd>
          </div>
          <div>
            <dt className="text-xs text-neutral-500 dark:text-neutral-400">Waiting</dt>
            <dd className="tabular-nums text-neutral-700 dark:text-neutral-200">
              {member.waitingCustomer}
            </dd>
          </div>
          <div>
            <dt className="text-xs text-neutral-500 dark:text-neutral-400">High priority</dt>
            <dd className="tabular-nums text-neutral-700 dark:text-neutral-200">
              {member.highPriority}
            </dd>
          </div>
          <div>
            <dt className="text-xs text-neutral-500 dark:text-neutral-400">Urgent</dt>
            <dd className="tabular-nums text-neutral-700 dark:text-neutral-200">
              {member.urgent}
            </dd>
          </div>
          <div>
            <dt className="text-xs text-neutral-500 dark:text-neutral-400">SLA at risk</dt>
            <dd className="tabular-nums text-neutral-700 dark:text-neutral-200">
              {member.slaAtRisk}
            </dd>
          </div>
          <div>
            <dt className="text-xs text-neutral-500 dark:text-neutral-400">Resolved</dt>
            <dd className="tabular-nums text-neutral-700 dark:text-neutral-200">
              {member.resolved}
            </dd>
          </div>
          <div>
            <dt className="text-xs text-neutral-500 dark:text-neutral-400">Closed</dt>
            <dd className="tabular-nums text-neutral-700 dark:text-neutral-200">
              {member.closed}
            </dd>
          </div>
        </dl>
      </div>
    </Card>
  );
}

export default function AgentWorkloadView({ members, summary }: AgentWorkloadProps) {
  return (
    <div className="flex flex-col gap-6">
      <Card>
        <CardHeader>
          <CardTitle>Workspace summary</CardTitle>
          <CardDescription>
            Aggregated workload across {summary.memberCount} workspace member
            {summary.memberCount === 1 ? '' : 's'}. Based on currently assigned tickets in this workspace.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">
            <SummaryCard label="Total assigned" value={summary.totalAssigned} tone="neutral" />
            <SummaryCard label="Active" value={summary.active} tone="blue" />
            <SummaryCard label="High priority" value={summary.highPriority} tone="amber" />
            <SummaryCard label="Urgent" value={summary.urgent} tone="red" />
            <SummaryCard label="SLA at risk" value={summary.slaAtRisk} tone="red" />
          </div>
        </CardContent>
      </Card>

      <section aria-label="Agent workload by member" className="flex flex-col gap-1">
        <h2 className="text-lg font-semibold text-neutral-900 dark:text-neutral-50">
          Agent workload
        </h2>
        <p className="text-sm text-neutral-600 dark:text-neutral-300">
          One entry per workspace member. Active = open + in progress + waiting on customer.
          High priority, urgent, and SLA-at-risk counts include active tickets only.
        </p>
      </section>

      {members.length === 0 ? (
        <EmptyState
          title="No workspace members"
          description="There are no members in this workspace yet."
        />
      ) : summary.totalAssigned === 0 ? (
        <EmptyState
          title="No assigned tickets"
          description="There are currently no assigned tickets in this workspace. Work will appear here once tickets are assigned to members."
        />
      ) : null}

      <ul className="flex flex-col gap-3" aria-label="Agent workload list">
        {members.map((member) => (
          <li key={member.userId}>
            <AgentCard member={member} />
          </li>
        ))}
      </ul>
    </div>
  );
}
