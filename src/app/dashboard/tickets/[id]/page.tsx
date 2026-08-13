import { notFound } from 'next/navigation';
import { getTicketById, TicketNotFoundError } from '@/lib/tickets/server';
import { getMessages } from '@/lib/messages/server';
import type { MessageWithCreator } from '@/lib/messages/server';
import { TicketNotFoundError as MessagesTicketNotFoundError } from '@/lib/messages/server';
import { getWorkspaceMembers } from '@/lib/workspace/server';
import { getTicketActivities } from '@/lib/tickets/activity';
import AssignTicketForm from '@/components/tickets/assign-ticket-form';
import CreateMessageForm from '@/components/tickets/create-message-form';
import TicketTransitionForm from '@/components/tickets/ticket-transition-form';
import ActivityTimeline from '@/components/tickets/activity-timeline';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { EmptyState } from '@/components/ui/empty-state';
import { getResponseSlaStatus, getResolutionSlaStatus } from '@/lib/tickets/sla';

type TicketDetailPageProps = {
  params: Promise<{ id: string }>;
};

const statusTone: Record<string, 'neutral' | 'blue' | 'amber' | 'emerald' | 'red'> = {
  open: 'blue',
  in_progress: 'amber',
  waiting_customer: 'amber',
  resolved: 'emerald',
  closed: 'neutral',
};

const statusLabel: Record<string, string> = {
  open: 'Open',
  in_progress: 'In Progress',
  waiting_customer: 'Waiting Customer',
  resolved: 'Resolved',
  closed: 'Closed',
};

const slaStatusLabel: Record<string, string> = {
  pending: 'Pending',
  completed: 'Completed',
  overdue: 'Overdue',
};

const slaStatusTone: Record<string, 'neutral' | 'blue' | 'amber' | 'emerald' | 'red'> = {
  pending: 'blue',
  completed: 'emerald',
  overdue: 'red',
};

function formatDeadline(deadline: Date | null) {
  if (!deadline) {
    return 'Not set';
  }

  return new Date(deadline).toLocaleString('id-ID');
}

function MessageItem({ message }: { message: MessageWithCreator }) {
  const author = message.createdBy?.name ?? 'Unknown';
  const createdAt = new Date(message.createdAt).toLocaleString('id-ID');

  return (
    <div className="rounded-md border border-neutral-200 bg-white p-4 dark:border-neutral-800 dark:bg-neutral-900">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-sm font-medium text-neutral-900 dark:text-neutral-50">{author}</p>
        <p className="text-xs text-neutral-500 dark:text-neutral-400">{createdAt}</p>
      </div>
      <p className="mt-2 whitespace-pre-wrap text-sm text-neutral-900 dark:text-neutral-50">{message.body}</p>
    </div>
  );
}

export async function generateMetadata({ params }: TicketDetailPageProps) {
  const resolved = await params;
  return {
    title: `Ticket ${resolved.id}`,
  };
}

export default async function TicketDetailPage({ params }: TicketDetailPageProps) {
  const resolved = await params;
  let ticket;
  let messages: MessageWithCreator[] = [];
  let activities: Awaited<ReturnType<typeof getTicketActivities>> = [];

  try {
    ticket = await getTicketById(resolved.id);
  } catch (error) {
    if (error instanceof TicketNotFoundError) {
      throw notFound();
    }
    throw error;
  }

  try {
    messages = await getMessages(resolved.id);
  } catch (error) {
    if (error instanceof MessagesTicketNotFoundError) {
      throw notFound();
    }
    throw error;
  }

  try {
    activities = await getTicketActivities(resolved.id);
  } catch (error) {
    if (error instanceof TicketNotFoundError) {
      throw notFound();
    }
    console.error('Failed to load ticket activities', error);
  }

  const creator = ticket.createdBy?.name ?? 'Unknown';
  const createdAt = new Date(ticket.createdAt).toLocaleString('id-ID');
  const updatedAt = new Date(ticket.updatedAt).toLocaleString('id-ID');
  const now = new Date();
  const responseStatus = getResponseSlaStatus(ticket.responseSlaDeadline, ticket.firstResponseAt, now);
  const resolutionStatus = getResolutionSlaStatus(ticket.resolutionSlaDeadline, ticket.resolvedAt, now);

  let members: Array<{ id: string; name: string; email: string }> = [];
  try {
    members = await getWorkspaceMembers();
  } catch (error) {
    console.error('Failed to load workspace members', error);
  }

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

        <section className="rounded-lg border border-neutral-200 bg-white p-5 dark:border-neutral-800 dark:bg-neutral-900">
          <h2 className="text-sm font-medium text-neutral-700 dark:text-neutral-200">SLA</h2>
          <div className="mt-3 grid grid-cols-1 gap-4 sm:grid-cols-2">
            <div>
              <p className="text-xs text-neutral-500 dark:text-neutral-400">Response SLA</p>
              <div className="mt-1 flex flex-col gap-1">
                <div>
                  <Badge tone={slaStatusTone[responseStatus]}>{slaStatusLabel[responseStatus]}</Badge>
                </div>
                <p className="text-xs text-neutral-600 dark:text-neutral-300">
                  Deadline: {formatDeadline(ticket.responseSlaDeadline)}
                </p>
                <p className="text-xs text-neutral-600 dark:text-neutral-300">
                  First response: {ticket.firstResponseAt ? new Date(ticket.firstResponseAt).toLocaleString('id-ID') : 'Not yet'}
                </p>
              </div>
            </div>
            <div>
              <p className="text-xs text-neutral-500 dark:text-neutral-400">Resolution SLA</p>
              <div className="mt-1 flex flex-col gap-1">
                <div>
                  <Badge tone={slaStatusTone[resolutionStatus]}>{slaStatusLabel[resolutionStatus]}</Badge>
                </div>
                <p className="text-xs text-neutral-600 dark:text-neutral-300">
                  Deadline: {formatDeadline(ticket.resolutionSlaDeadline)}
                </p>
                <p className="text-xs text-neutral-600 dark:text-neutral-300">
                  Resolved at: {ticket.resolvedAt ? new Date(ticket.resolvedAt).toLocaleString('id-ID') : 'Not yet'}
                </p>
              </div>
            </div>
          </div>
        </section>

        <section className="rounded-lg border border-neutral-200 bg-white p-5 dark:border-neutral-800 dark:bg-neutral-900">
          <h2 className="text-sm font-medium text-neutral-700 dark:text-neutral-200">Customer</h2>
          {ticket.customer ? (
            <div className="mt-3 flex flex-col gap-1">
              <p className="text-sm font-medium text-neutral-900 dark:text-neutral-50">{ticket.customer.name}</p>
              {ticket.customer.email ? (
                <p className="text-xs text-neutral-600 dark:text-neutral-300">{ticket.customer.email}</p>
              ) : null}
              {ticket.customer.phone ? (
                <p className="text-xs text-neutral-600 dark:text-neutral-300">{ticket.customer.phone}</p>
              ) : null}
            </div>
          ) : (
            <p className="mt-3 text-sm text-neutral-500 dark:text-neutral-400">No customer linked to this ticket.</p>
          )}
        </section>

        <section className="flex flex-col gap-3">
          <header className="flex flex-col gap-1">
            <h2 className="text-xl font-semibold">Assignment</h2>
            <p className="text-sm text-neutral-600 dark:text-neutral-300">
              Assign tiket ini kepada member workspace.
            </p>
          </header>
          <AssignTicketForm ticket={ticket} members={members} />
        </section>

        <section className="flex flex-col gap-3">
          <header className="flex flex-col gap-1">
            <h2 className="text-xl font-semibold">Workflow</h2>
            <p className="text-sm text-neutral-600 dark:text-neutral-300">
              Update ticket status using allowed transitions.
            </p>
          </header>
          <TicketTransitionForm ticket={ticket} />
        </section>

        <section className="flex flex-col gap-4">
          <header className="flex flex-col gap-1">
            <h2 className="text-xl font-semibold">Messages</h2>
            <p className="text-sm text-neutral-600 dark:text-neutral-300">
              Diskusi terkait tiket ini.
            </p>
          </header>

          {messages.length === 0 ? (
            <EmptyState
              title="Belum ada pesan"
              description="Jadikan yang pertama membalas pada tiket ini."
              action={<Button href="#message-form">Add message</Button>}
            />
          ) : (
            <div className="flex flex-col gap-3">
              {messages.map((message) => (
                <MessageItem key={message.id} message={message} />
              ))}
            </div>
          )}

          <div id="message-form" className="rounded-lg border border-neutral-200 bg-white p-5 dark:border-neutral-800 dark:bg-neutral-900">
            <CreateMessageForm ticketId={ticket.id} />
          </div>
        </section>

        <section className="flex flex-col gap-4">
          <header className="flex flex-col gap-1">
            <h2 className="text-xl font-semibold">Activity Timeline</h2>
            <p className="text-sm text-neutral-600 dark:text-neutral-300">
              Riwayat perubahan penting pada tiket ini.
            </p>
          </header>
          <ActivityTimeline activities={activities} />
        </section>
      </div>
    </div>
  );
}
