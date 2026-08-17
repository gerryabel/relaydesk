import Link from 'next/link';
import { type TicketWithCreator } from '@/lib/tickets/server';
import { Badge } from '@/components/ui/badge';
import { Card } from '@/components/ui/card';
import { getResponseSlaMonitoringStatus, getResolutionSlaMonitoringStatus } from '@/lib/tickets/sla';

type TicketCardProps = {
  ticket: TicketWithCreator;
  selected?: boolean;
  selectionName?: string;
  onSelectionChange?: (ticketId: string, selected: boolean) => void;
};

const priorityTone: Record<TicketWithCreator['priority'], 'neutral' | 'blue' | 'amber' | 'emerald' | 'red'> = {
  low: 'neutral',
  medium: 'blue',
  high: 'amber',
  urgent: 'red',
};

const statusTone: Record<TicketWithCreator['status'], 'neutral' | 'blue' | 'amber' | 'emerald' | 'red'> = {
  open: 'blue',
  in_progress: 'amber',
  waiting_customer: 'amber',
  resolved: 'emerald',
  closed: 'neutral',
};

const statusLabel: Record<TicketWithCreator['status'], string> = {
  open: 'Open',
  in_progress: 'In Progress',
  waiting_customer: 'Waiting Customer',
  resolved: 'Resolved',
  closed: 'Closed',
};

const slaStatusLabel: Record<string, string> = {
  on_track: 'On Track',
  at_risk: 'At Risk',
  breached: 'Breached',
  completed: 'Completed',
  not_applicable: 'Not Applicable',
};

const slaStatusTone: Record<string, 'neutral' | 'blue' | 'amber' | 'emerald' | 'red'> = {
  on_track: 'emerald',
  at_risk: 'amber',
  breached: 'red',
  completed: 'emerald',
  not_applicable: 'neutral',
};

export default function TicketCard({ ticket, selected, selectionName, onSelectionChange }: TicketCardProps) {
  const creator = ticket.createdBy?.name ?? 'Unknown';
  const createdDate = new Date(ticket.createdAt).toLocaleDateString('id-ID');
  const now = new Date();
  const responseStatus = getResponseSlaMonitoringStatus(ticket.responseSlaDeadline, ticket.firstResponseAt, ticket.createdAt, now);
  const resolutionStatus = getResolutionSlaMonitoringStatus(ticket.resolutionSlaDeadline, ticket.resolvedAt, ticket.createdAt, now);
  const name = selectionName ?? `Pilih ${ticket.title}`;

  const card = (
    <Card className="transition hover:border-neutral-300 dark:hover:border-neutral-700">
      <div className="flex flex-col gap-3 p-5">
        <div className="flex flex-wrap items-start justify-between gap-2">
          <div className="min-w-0">
            <h3 className="truncate text-sm font-medium text-neutral-900 dark:text-neutral-50">
              {ticket.title}
            </h3>
            <p className="mt-1 text-xs text-neutral-600 dark:text-neutral-300">
              {creator} • {createdDate}
            </p>
          </div>
          <div className="flex flex-wrap gap-2">
            <Badge tone={statusTone[ticket.status]}>{statusLabel[ticket.status]}</Badge>
            <Badge tone={priorityTone[ticket.priority]}>{ticket.priority}</Badge>
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-2 text-xs text-neutral-600 dark:text-neutral-300">
          <span>
            Response SLA: <Badge tone={slaStatusTone[responseStatus]}>{slaStatusLabel[responseStatus]}</Badge>
          </span>
          <span aria-hidden="true">•</span>
          <span>
            Resolution SLA: <Badge tone={slaStatusTone[resolutionStatus]}>{slaStatusLabel[resolutionStatus]}</Badge>
          </span>
        </div>
      </div>
    </Card>
  );

  if (!onSelectionChange || !selectionName) {
    return <div className="block">{card}</div>;
  }

  return (
    <label className="block">
      <span className="sr-only">{name}</span>
      <input
        type="checkbox"
        className="sr-only"
        checked={selected ?? false}
        onChange={(event) => onSelectionChange(ticket.id, event.target.checked)}
      />
      <span
        aria-hidden="true"
        className={`pointer-events-none block rounded-md border-2 ${
          selected ? 'border-neutral-900 dark:border-neutral-100' : 'border-transparent'
        }`}
      >
        {card}
      </span>
    </label>
  );
}
