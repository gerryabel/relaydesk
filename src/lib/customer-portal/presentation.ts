import type { CustomerTicketPriority, CustomerTicketStatus } from '@/lib/customer-portal/dto';

/**
 * Customer-facing presentation vocabulary (Phase 9 Task 2).
 *
 * The internal dashboard shows raw enum values (`in_progress`,
 * `waiting_customer`). Those are workspace jargon, and spec §13 requires the
 * portal to speak the customer's language — no automation, lease, outbox or
 * role terminology. The internal values never leave the service layer; only
 * these labels reach the browser.
 */

export const CUSTOMER_STATUS_LABELS: Record<CustomerTicketStatus, string> = {
  open: 'Open',
  in_progress: 'In progress',
  waiting_customer: 'Waiting for you',
  resolved: 'Resolved',
  closed: 'Closed',
};

export const CUSTOMER_PRIORITY_LABELS: Record<CustomerTicketPriority, string> = {
  low: 'Low',
  medium: 'Normal',
  high: 'High',
  urgent: 'Urgent',
};

/** Badge tones from the shared UI primitive's vocabulary. */
const STATUS_TONES: Record<CustomerTicketStatus, 'neutral' | 'blue' | 'amber' | 'emerald' | 'red'> = {
  open: 'blue',
  in_progress: 'amber',
  waiting_customer: 'amber',
  resolved: 'emerald',
  closed: 'neutral',
};

export function customerStatusLabel(status: CustomerTicketStatus): string {
  return CUSTOMER_STATUS_LABELS[status] ?? status;
}

export function customerStatusTone(
  status: CustomerTicketStatus,
): 'neutral' | 'blue' | 'amber' | 'emerald' | 'red' {
  return STATUS_TONES[status] ?? 'neutral';
}

export function customerPriorityLabel(priority: CustomerTicketPriority): string {
  return CUSTOMER_PRIORITY_LABELS[priority] ?? priority;
}

/**
 * Formats an ISO timestamp for display.
 *
 * Fixed `en-US` + UTC so a customer sees the same string regardless of their
 * own locale, and support can quote it unambiguously over email. An
 * unparseable value degrades to the raw string rather than "Invalid Date".
 */
export function formatCustomerDate(isoDate: string): string {
  const parsed = new Date(isoDate);

  if (Number.isNaN(parsed.getTime())) {
    return isoDate;
  }

  return new Intl.DateTimeFormat('en-US', {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
    timeZone: 'UTC',
  }).format(parsed);
}

/** Date only, for list rows. */
export function formatCustomerDateOnly(isoDate: string): string {
  const parsed = new Date(isoDate);

  if (Number.isNaN(parsed.getTime())) {
    return isoDate;
  }

  return new Intl.DateTimeFormat('en-US', {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
    timeZone: 'UTC',
  }).format(parsed);
}
