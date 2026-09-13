import { notFound } from 'next/navigation';
import { getTicketById, TicketNotFoundError } from '@/lib/tickets/server';
import { getMessages } from '@/lib/messages/server';
import type { MessageWithCreator } from '@/lib/messages/server';
import { TicketNotFoundError as MessagesTicketNotFoundError } from '@/lib/messages/server';
import { getWorkspaceMembers } from '@/lib/workspace/server';
import { getTicketActivities } from '@/lib/tickets/activity';
import { getInternalNotes } from '@/lib/internal-notes/server';
import AssignTicketForm from '@/components/tickets/assign-ticket-form';
import CreateMessageForm from '@/components/tickets/create-message-form';
import CreateInternalNoteForm from '@/components/tickets/create-internal-note-form';
import TicketTransitionForm from '@/components/tickets/ticket-transition-form';
import ActivityTimeline from '@/components/tickets/activity-timeline';
import { getTicketTags, getTags } from '@/lib/tags/server';
import TicketTagsManager from '@/components/tickets/ticket-tags-manager';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { EmptyState } from '@/components/ui/empty-state';
import { getResponseSlaMonitoringStatus, getResolutionSlaMonitoringStatus } from '@/lib/tickets/sla';

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
  on_track: 'On Track',
  at_risk: 'At Risk',
  breached: 'Breached',
  not_applicable: 'Not Applicable',
};

const slaStatusTone: Record<string, 'neutral' | 'blue' | 'amber' | 'emerald' | 'red'> = {
  pending: 'blue',
  completed: 'emerald',
  overdue: 'red',
  on_track: 'emerald',
  at_risk: 'amber',
  breached: 'red',
  not_applicable: 'neutral',
};

function formatSlaRemaining(deadline: Date | null, now: Date) {
  if (!deadline) {
    return null;
  }

  const remainingMs = deadline.getTime() - now.getTime();

  if (remainingMs > 0) {
    const hours = Math.floor(remainingMs / (1000 * 60 * 60));
    const minutes = Math.floor((remainingMs % (1000 * 60 * 60)) / (1000 * 60));

    if (hours > 0) {
      return `${hours}h ${minutes}m remaining`;
    }

    return `${minutes}m remaining`;
  }

  if (remainingMs === 0) {
    return 'At deadline';
  }

  const overdueMinutes = Math.ceil(Math.abs(remainingMs) / (1000 * 60));
  const overdueHours = Math.floor(overdueMinutes / 60);
  const overdueMins = overdueMinutes % 60;

  if (overdueHours > 0) {
    return `Overdue by ${overdueHours}h ${overdueMins}m`;
  }

  return `Overdue by ${overdueMins}m`;
}

function AttachmentChip({ attachment }: { attachment: { id: string; originalFilename: string; sizeBytes: number } }) {
  const sizeLabel = attachment.sizeBytes < 1024
    ? `${attachment.sizeBytes}B`
    : attachment.sizeBytes < 1024 * 1024
      ? `${Math.round(attachment.sizeBytes / 1024)}KB`
      : `${(attachment.sizeBytes / (1024 * 1024)).toFixed(1)}MB`;

  return (
    <a
      href={`/api/attachments/${attachment.id}`}
      className="inline-flex items-center gap-1 rounded-md border border-neutral-200 bg-neutral-50 px-2 py-1 text-xs text-neutral-700 hover:bg-neutral-100 dark:border-neutral-700 dark:bg-neutral-800 dark:text-neutral-300 dark:hover:bg-neutral-700"
      download
    >
      <svg className="h-3 w-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" aria-hidden="true">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15.172 7l-6.586 6.586a2 2 0 102.828 2.828l6.414-6.586a4 4 0 00-5.656-5.656l-6.415 6.585a6 6 0 108.486 8.486L20.5 13" />
      </svg>
      <span className="max-w-[120px] truncate">{attachment.originalFilename}</span>
      <span className="text-neutral-500 dark:text-neutral-400">{sizeLabel}</span>
    </a>
  );
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
      {message.attachments && message.attachments.length > 0 ? (
        <div className="mt-3 flex flex-wrap gap-2">
          {message.attachments.map((attachment) => (
            <AttachmentChip key={attachment.id} attachment={attachment} />
          ))}
        </div>
      ) : null}
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
  let internalNotes: Awaited<ReturnType<typeof getInternalNotes>> = [];

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

  try {
    internalNotes = await getInternalNotes(resolved.id);
  } catch (error) {
    console.error('Failed to load internal notes', error);
  }

  const creator = ticket.createdBy?.name ?? 'Unknown';
  const createdAt = new Date(ticket.createdAt).toLocaleString('id-ID');
  const updatedAt = new Date(ticket.updatedAt).toLocaleString('id-ID');
  const now = new Date();
  const responseStatus = getResponseSlaMonitoringStatus(ticket.responseSlaDeadline, ticket.firstResponseAt, ticket.createdAt, now);
  const resolutionStatus = getResolutionSlaMonitoringStatus(ticket.resolutionSlaDeadline, ticket.resolvedAt, ticket.createdAt, now);
  const responseRemaining = formatSlaRemaining(ticket.responseSlaDeadline, now);
  const resolutionRemaining = formatSlaRemaining(ticket.resolutionSlaDeadline, now);

  const responseSlaDescription = (() => {
    if (responseStatus === 'completed') return 'Responded within SLA';
    if (responseStatus === 'breached') return responseRemaining ?? 'Breached';
    if (responseStatus === 'at_risk') return responseRemaining ?? 'At Risk';
    if (responseStatus === 'on_track') return responseRemaining ?? 'On Track';
    return 'No deadline set';
  })();

  const resolutionSlaDescription = (() => {
    if (resolutionStatus === 'completed') return 'Resolved within SLA';
    if (resolutionStatus === 'breached') return resolutionRemaining ?? 'Breached';
    if (resolutionStatus === 'at_risk') return resolutionRemaining ?? 'At Risk';
    if (resolutionStatus === 'on_track') return resolutionRemaining ?? 'On Track';
    return 'No deadline set';
  })();

  let members: Array<{ id: string; name: string; email: string }> = [];
  let ticketTags: Array<{ id: string; name: string }> = [];
  let availableTags: Array<{ id: string; name: string }> = [];
  try {
    const [workspaceMembers, tags] = await Promise.all([getWorkspaceMembers(), getTags()]);
    members = workspaceMembers.map(({ id, name, email }) => ({ id, name, email }));
    ticketTags = await getTicketTags(resolved.id);
    availableTags = tags;
  } catch (error) {
    console.error('Failed to load tag context', error);
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
            <div className="rounded-md border border-neutral-200 bg-white p-4 dark:border-neutral-800 dark:bg-neutral-900">
              <p className="text-xs text-neutral-500 dark:text-neutral-400">Response SLA</p>
              <div className="mt-1 flex flex-col gap-1">
                <div>
                  <Badge tone={slaStatusTone[responseStatus]}>{slaStatusLabel[responseStatus]}</Badge>
                </div>
                <p className="text-xs text-neutral-600 dark:text-neutral-300">{responseSlaDescription}</p>
              </div>
            </div>
            <div className="rounded-md border border-neutral-200 bg-white p-4 dark:border-neutral-800 dark:bg-neutral-900">
              <p className="text-xs text-neutral-500 dark:text-neutral-400">Resolution SLA</p>
              <div className="mt-1 flex flex-col gap-1">
                <div>
                  <Badge tone={slaStatusTone[resolutionStatus]}>{slaStatusLabel[resolutionStatus]}</Badge>
                </div>
                <p className="text-xs text-neutral-600 dark:text-neutral-300">{resolutionSlaDescription}</p>
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
            <h2 className="text-xl font-semibold">Tags</h2>
            <p className="text-sm text-neutral-600 dark:text-neutral-300">
              Kelola tag yang terpasang pada tiket ini.
            </p>
          </header>
          <TicketTagsManager ticketId={ticket.id} initialTags={ticketTags} availableTags={availableTags} />
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
            <h2 className="text-xl font-semibold">Internal Notes</h2>
            <p className="text-sm text-neutral-600 dark:text-neutral-300">
              Catatan internal hanya untuk tim. Tidak terlihat oleh pelanggan.
            </p>
          </header>

          {internalNotes.length === 0 ? (
            <EmptyState
              title="Belum ada catatan internal"
              description="Tambahkan catatan internal untuk kolaborasi tim."
              action={<Button href="#internal-note-form">Add internal note</Button>}
            />
          ) : (
            <div className="flex flex-col gap-3">
              {internalNotes.map((note) => (
                <div
                  key={note.id}
                  className="rounded-md border border-neutral-200 bg-white p-4 dark:border-neutral-800 dark:bg-neutral-900"
                >
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <div className="flex flex-col gap-1">
                      <p className="text-sm font-medium text-neutral-900 dark:text-neutral-50">
                        {note.author?.name ?? 'Unknown'}
                      </p>
                      <p className="text-xs text-neutral-500 dark:text-neutral-400">
                        Internal only — not visible to customer
                      </p>
                    </div>
                    <p className="text-xs text-neutral-500 dark:text-neutral-400">
                      {new Date(note.createdAt).toLocaleString('id-ID')}
                    </p>
                  </div>
                  <p className="mt-2 whitespace-pre-wrap text-sm text-neutral-900 dark:text-neutral-50">
                    {note.body}
                  </p>
                </div>
              ))}
            </div>
          )}

          <div id="internal-note-form" className="rounded-lg border border-neutral-200 bg-white p-5 dark:border-neutral-800 dark:bg-neutral-900">
            <CreateInternalNoteForm ticketId={ticket.id} />
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
