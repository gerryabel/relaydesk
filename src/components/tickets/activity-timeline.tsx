'use client';

import type { TicketActivityWithActor } from '@/lib/tickets/activity';

const STATUS_LABEL: Record<string, string> = {
  open: 'Open',
  in_progress: 'In Progress',
  waiting_customer: 'Waiting Customer',
  resolved: 'Resolved',
  closed: 'Closed',
};

const PRIORITY_LABEL: Record<string, string> = {
  low: 'Low',
  medium: 'Medium',
  high: 'High',
  urgent: 'Urgent',
};

function humanizeActivity(activity: TicketActivityWithActor): string {
  const actor = activity.actor?.name ?? 'Unknown';
  const metadata = activity.metadata as Record<string, unknown> | null;

  switch (activity.type) {
    case 'TICKET_CREATED':
      return `${actor} created this ticket`;
    case 'TICKET_ASSIGNED': {
      const from = metadata?.from;
      const to = metadata?.to;

      if (from == null && typeof to === 'string') {
        const assignee = activity.actor?.name ?? 'Unknown';
        return `${actor} assigned the ticket to ${assignee}`;
      }

      if (typeof from === 'string' && typeof to === 'string') {
        const assignee = activity.actor?.name ?? 'Unknown';
        return `${actor} changed assignee to ${assignee}`;
      }

      return `${actor} updated the assignee`;
    }
    case 'TICKET_UNASSIGNED':
      return `${actor} unassigned the ticket`;
    case 'STATUS_CHANGED': {
      const fromLabel = typeof metadata?.from === 'string' ? STATUS_LABEL[metadata.from] ?? metadata.from : null;
      const toLabel = typeof metadata?.to === 'string' ? STATUS_LABEL[metadata.to] ?? metadata.to : null;

      if (fromLabel && toLabel) {
        return `${actor} changed status from ${fromLabel} to ${toLabel}`;
      }

      return `${actor} changed status`;
    }
    case 'PRIORITY_CHANGED': {
      const fromLabel = typeof metadata?.from === 'string' ? PRIORITY_LABEL[metadata.from] ?? metadata.from : null;
      const toLabel = typeof metadata?.to === 'string' ? PRIORITY_LABEL[metadata.to] ?? metadata.to : null;

      if (fromLabel && toLabel) {
        return `${actor} changed priority from ${fromLabel} to ${toLabel}`;
      }

      return `${actor} changed priority`;
    }
    case 'INTERNAL_NOTE_CREATED':
      return `${actor} added an internal note`;
    default:
      return `${actor} updated the ticket`;
  }
}

function formatCreatedAt(createdAt: Date): string {
  return new Date(createdAt).toLocaleString('id-ID');
}

type ActivityTimelineProps = {
  activities: TicketActivityWithActor[];
};

export default function ActivityTimeline({ activities }: ActivityTimelineProps) {
  if (activities.length === 0) {
    return (
      <p className="text-sm text-neutral-500 dark:text-neutral-400">No activity yet.</p>
    );
  }

  return (
    <ol className="flex flex-col gap-3" aria-label="Activity timeline">
      {activities.map((activity) => (
        <li
          key={activity.id}
          className="rounded-md border border-neutral-200 bg-white p-4 dark:border-neutral-800 dark:bg-neutral-900"
        >
          <div className="flex flex-wrap items-center justify-between gap-2">
            <p className="text-sm font-medium text-neutral-900 dark:text-neutral-50">
              {humanizeActivity(activity)}
            </p>
            <p className="text-xs text-neutral-500 dark:text-neutral-400">{formatCreatedAt(activity.createdAt)}</p>
          </div>
        </li>
      ))}
    </ol>
  );
}
