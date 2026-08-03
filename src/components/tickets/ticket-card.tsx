import Link from 'next/link';
import { type TicketWithCreator } from '@/lib/tickets/server';
import { Badge } from '@/components/ui/badge';
import { Card } from '@/components/ui/card';

type TicketCardProps = {
  ticket: TicketWithCreator;
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
  resolved: 'emerald',
  closed: 'neutral',
};

const statusLabel: Record<TicketWithCreator['status'], string> = {
  open: 'Open',
  in_progress: 'In Progress',
  resolved: 'Resolved',
  closed: 'Closed',
};

export default function TicketCard({ ticket }: TicketCardProps) {
  const creator = ticket.createdBy?.name ?? 'Unknown';
  const createdDate = new Date(ticket.createdAt).toLocaleDateString('id-ID');

  return (
    <Link href={`/dashboard/tickets/${ticket.id}`} className="block">
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
        </div>
      </Card>
    </Link>
  );
}
