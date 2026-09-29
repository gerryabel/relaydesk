import Link from 'next/link';
import { Badge } from '@/components/ui/badge';
import {
  customerPriorityLabel,
  customerStatusLabel,
  customerStatusTone,
  formatCustomerDateOnly,
} from '@/lib/customer-portal/presentation';
import type { CustomerTicketSummary } from '@/lib/customer-portal/dto';

/**
 * Customer ticket list rows (Phase 9 Task 2).
 *
 * Every field here comes from `CustomerTicketSummary`, which is an explicit
 * allowlist. There is no internal assignee, priority-escalation control,
 * tag list or activity indicator, and no internal link out to the workspace.
 */
export function CustomerTicketList({
  tickets,
  workspaceSlug,
}: {
  tickets: CustomerTicketSummary[];
  workspaceSlug: string;
}) {
  return (
    <ul className="flex flex-col gap-3">
      {tickets.map((ticket) => (
        <li key={ticket.id}>
          <Link
            href={`/portal/${workspaceSlug}/tickets/${ticket.id}`}
            className="block rounded-lg border border-neutral-200 bg-white p-4 transition hover:border-neutral-900 dark:border-neutral-800 dark:bg-neutral-900 dark:hover:border-neutral-100"
          >
            <div className="flex flex-col gap-2">
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

              <p className="text-sm font-medium text-neutral-900 dark:text-neutral-50">
                {ticket.title}
              </p>

              <dl className="flex flex-wrap gap-x-6 gap-y-1 text-xs text-neutral-600 dark:text-neutral-300">
                <div className="flex gap-1">
                  <dt>Opened</dt>
                  <dd>{formatCustomerDateOnly(ticket.createdAt)}</dd>
                </div>
                <div className="flex gap-1">
                  <dt>Last update</dt>
                  <dd>{formatCustomerDateOnly(ticket.lastActivityAt)}</dd>
                </div>
              </dl>
            </div>
          </Link>
        </li>
      ))}
    </ul>
  );
}
