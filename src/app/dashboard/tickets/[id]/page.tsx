import { notFound } from 'next/navigation';
import { getTicketById } from '@/lib/tickets/server';
import { TicketNotFoundError } from '@/lib/tickets/server';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';

type TicketDetailPageProps = {
  params: Promise<{ id: string }>;
};

const statusTone: Record<string, 'neutral' | 'blue' | 'amber' | 'emerald' | 'red'> = {
  open: 'blue',
  in_progress: 'amber',
  resolved: 'emerald',
  closed: 'neutral',
};

const statusLabel: Record<string, string> = {
  open: 'Open',
  in_progress: 'In Progress',
  resolved: 'Resolved',
  closed: 'Closed',
};

export async function generateMetadata({ params }: TicketDetailPageProps) {
  const resolved = await params;
  return {
    title: `Ticket ${resolved.id}`,
  };
}

export default async function TicketDetailPage({ params }: TicketDetailPageProps) {
  const { id } = await params;
  let ticket;

  try {
    ticket = await getTicketById(id);
  } catch (error) {
    if (error instanceof TicketNotFoundError) {
      notFound();
    }

    throw error;
  }

  const creator = ticket.createdBy?.name ?? 'Unknown';
  const createdAt = new Date(ticket.createdAt).toLocaleString('id-ID');
  const updatedAt = new Date(ticket.updatedAt).toLocaleString('id-ID');

  return (
    <div className="mx-auto max-w-5xl px-4 py-10">
      <div className="flex flex-col gap-6">
        <header className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
          <div>
            <h1 className="text-2xl font-semibold">{ticket.title}</h1>
            <p className="mt-2 text-sm text-neutral-600 dark:text-neutral-300">
              Created by {creator} on {createdAt}.
            </p>
          </div>
          <div className="flex items-center gap-2">
            <Button variant="secondary" href="/dashboard/tickets">
              Back
            </Button>
            <Button href={`/dashboard/tickets/${ticket.id}/edit`}>Edit</Button>
          </div>
        </header>

        <section className="grid grid-cols-1 gap-4 sm:grid-cols-3">
          <div className="rounded-lg border border-neutral-200 bg-white p-4 dark:border-neutral-800 dark:bg-neutral-900">
            <p className="text-xs text-neutral-500 dark:text-neutral-400">Status</p>
            <p className="mt-1">
              <Badge tone={statusTone[ticket.status]}>{statusLabel[ticket.status]}</Badge>
            </p>
          </div>
          <div className="rounded-lg border border-neutral-200 bg-white p-4 dark:border-neutral-800 dark:bg-neutral-900">
            <p className="text-xs text-neutral-500 dark:text-neutral-400">Priority</p>
            <p className="mt-1 text-sm font-medium capitalize text-neutral-900 dark:text-neutral-50">
              {ticket.priority}
            </p>
          </div>
          <div className="rounded-lg border border-neutral-200 bg-white p-4 dark:border-neutral-800 dark:bg-neutral-900">
            <p className="text-xs text-neutral-500 dark:text-neutral-400">Updated</p>
            <p className="mt-1 text-sm font-medium text-neutral-900 dark:text-neutral-50">{updatedAt}</p>
          </div>
        </section>

        <section className="rounded-lg border border-neutral-200 bg-white p-5 dark:border-neutral-800 dark:bg-neutral-900">
          <h2 className="text-sm font-medium text-neutral-700 dark:text-neutral-200">Description</h2>
          <p className="mt-2 whitespace-pre-wrap text-sm text-neutral-900 dark:text-neutral-50">
            {ticket.description ?? 'No description provided.'}
          </p>
        </section>
      </div>
    </div>
  );
}
