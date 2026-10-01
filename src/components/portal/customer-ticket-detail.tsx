import { Badge } from '@/components/ui/badge';
import { CustomerReplyForm } from '@/components/portal/customer-reply-form';
import { CustomerAttachmentList } from '@/components/portal/customer-attachment-list';
import {
  customerPriorityLabel,
  customerStatusLabel,
  customerStatusTone,
  formatCustomerDate,
} from '@/lib/customer-portal/presentation';
import type { CustomerTicketDetail } from '@/lib/customer-portal/dto';

/**
 * Customer ticket detail (Phase 9 Task 2; replies in Task 3; attachments in
 * Task 4).
 *
 * Renders exactly what `CustomerTicketDetail` carries: identity, status,
 * priority, the customer's own description, the customer-visible conversation
 * and the actions the service says are available. There is no internal-notes
 * section, no activity timeline, no SLA panel and no assignment control.
 *
 * The reply box is rendered from `availableActions.includes('reply')` rather
 * than from a status check in this file: the list comes from the same
 * `resolveCustomerTicketActions` the write path enforces, so the portal cannot
 * offer a reply that would be refused — or hide one that would be accepted.
 */
export function CustomerTicketDetailView({
  ticket,
  workspaceSlug,
}: {
  ticket: CustomerTicketDetail;
  workspaceSlug: string;
}) {
  const canReply = ticket.availableActions.includes('reply');

  return (
    <article className="flex flex-col gap-6">
      <header className="flex flex-col gap-3">
        <div className="flex flex-wrap items-center gap-2">
          <span className="font-mono text-xs text-neutral-500 dark:text-neutral-400">
            {ticket.reference}
          </span>
          <Badge tone={customerStatusTone(ticket.status)}>
            {customerStatusLabel(ticket.status)}
          </Badge>
          <span className="text-xs text-neutral-500 dark:text-neutral-400">
            {customerPriorityLabel(ticket.priority)} priority
          </span>
        </div>

        <h1 className="text-xl font-semibold text-neutral-900 dark:text-neutral-50">
          {ticket.title}
        </h1>

        <dl className="flex flex-wrap gap-x-6 gap-y-1 text-xs text-neutral-600 dark:text-neutral-300">
          <div className="flex gap-1">
            <dt>Opened</dt>
            <dd>{formatCustomerDate(ticket.createdAt)}</dd>
          </div>
          <div className="flex gap-1">
            <dt>Last update</dt>
            <dd>{formatCustomerDate(ticket.lastActivityAt)}</dd>
          </div>
          {ticket.resolvedAt ? (
            <div className="flex gap-1">
              <dt>Resolved</dt>
              <dd>{formatCustomerDate(ticket.resolvedAt)}</dd>
            </div>
          ) : null}
        </dl>
      </header>

      {ticket.description ? (
        <section
          aria-labelledby="portal-description-heading"
          className="rounded-lg border border-neutral-200 bg-white p-5 dark:border-neutral-800 dark:bg-neutral-900"
        >
          <h2
            id="portal-description-heading"
            className="text-sm font-medium text-neutral-900 dark:text-neutral-50"
          >
            Your description
          </h2>
          <p className="mt-2 whitespace-pre-wrap text-sm text-neutral-700 dark:text-neutral-200">
            {ticket.description}
          </p>
        </section>
      ) : null}

      <section
        aria-labelledby="portal-conversation-heading"
        className="rounded-lg border border-neutral-200 bg-white p-5 dark:border-neutral-800 dark:bg-neutral-900"
      >
        <h2
          id="portal-conversation-heading"
          className="text-sm font-medium text-neutral-900 dark:text-neutral-50"
        >
          Conversation
        </h2>

        {ticket.conversation.length === 0 ? (
          <p className="mt-2 text-sm text-neutral-600 dark:text-neutral-300">
            {canReply
              ? 'No replies yet. Add a message below and our support team will respond here.'
              : 'No replies on this ticket.'}
          </p>
        ) : (
          <ol className="mt-3 flex flex-col gap-4">
            {ticket.conversation.map((message) => (
              <li
                key={message.reference}
                className={[
                  'flex flex-col gap-1 border-l-2 pl-3',
                  message.author === 'customer'
                    ? 'border-neutral-900 dark:border-neutral-100'
                    : 'border-neutral-200 dark:border-neutral-700',
                ].join(' ')}
              >
                <div className="flex flex-wrap items-center gap-2 text-xs text-neutral-600 dark:text-neutral-300">
                  <span className="font-medium text-neutral-900 dark:text-neutral-50">
                    {message.authorLabel}
                  </span>
                  <time dateTime={message.createdAt}>{formatCustomerDate(message.createdAt)}</time>
                </div>
                <p className="whitespace-pre-wrap text-sm text-neutral-800 dark:text-neutral-100">
                  {message.body}
                </p>

                {/* Attachments render from the DTO the same service read for
                    the message, so the list and the download endpoint are
                    scoped by one predicate. `availableActions` gates replies,
                    not attachments: an attachment that already exists is a
                    permanent part of the record and stays readable after the
                    ticket closes. */}
                {message.attachments.length > 0 ? (
                  <CustomerAttachmentList
                    workspaceSlug={workspaceSlug}
                    attachments={message.attachments}
                  />
                ) : null}
              </li>
            ))}
          </ol>
        )}
      </section>

      {canReply ? (
        <section
          aria-labelledby="portal-reply-heading"
          className="rounded-lg border border-neutral-200 bg-white p-5 dark:border-neutral-800 dark:bg-neutral-900"
        >
          <h2
            id="portal-reply-heading"
            className="text-sm font-medium text-neutral-900 dark:text-neutral-50"
          >
            Reply
          </h2>
          <div className="mt-3">
            <CustomerReplyForm workspaceSlug={workspaceSlug} ticketId={ticket.id} />
          </div>
        </section>
      ) : (
        <p className="text-sm text-neutral-600 dark:text-neutral-300">
          This ticket is closed, so replies are no longer accepted. Start a new ticket if you
          need more help.
        </p>
      )}
    </article>
  );
}
