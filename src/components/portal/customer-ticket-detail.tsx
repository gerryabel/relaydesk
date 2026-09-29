import { Badge } from '@/components/ui/badge';
import {
  customerPriorityLabel,
  customerStatusLabel,
  customerStatusTone,
  formatCustomerDate,
} from '@/lib/customer-portal/presentation';
import type { CustomerTicketDetail } from '@/lib/customer-portal/dto';

/**
 * Customer ticket detail (Phase 9 Task 2).
 *
 * Renders exactly what `CustomerTicketDetail` carries: identity, status,
 * priority, the customer's own description, and the customer-visible
 * conversation. There is no internal-notes section, no activity timeline, no
 * SLA panel, no assignment control and no reply form — Task 3 adds replies
 * and drives the form from `availableActions`, which is empty here.
 */
export function CustomerTicketDetailView({
  ticket,
}: {
  ticket: CustomerTicketDetail;
}) {
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
            No replies yet. Our support team will respond here and you will be notified by email.
          </p>
        ) : (
          <ol className="mt-3 flex flex-col gap-4">
            {ticket.conversation.map((message) => (
              <li key={message.reference} className="flex flex-col gap-1 border-l-2 border-neutral-200 pl-3 dark:border-neutral-700">
                <div className="flex flex-wrap items-center gap-2 text-xs text-neutral-600 dark:text-neutral-300">
                  <span className="font-medium text-neutral-900 dark:text-neutral-50">
                    {message.authorLabel}
                  </span>
                  <time dateTime={message.createdAt}>{formatCustomerDate(message.createdAt)}</time>
                </div>
                <p className="whitespace-pre-wrap text-sm text-neutral-800 dark:text-neutral-100">
                  {message.body}
                </p>
              </li>
            ))}
          </ol>
        )}
      </section>
    </article>
  );
}
