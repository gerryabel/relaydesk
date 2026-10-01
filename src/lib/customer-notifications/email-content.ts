import { formatTicketReference } from '@/lib/customer-portal/reference';
import { CUSTOMER_STATUS_LABELS } from '@/lib/customer-portal/presentation';
import type { CustomerTicketStatus } from '@/lib/customer-portal/dto';
import type { EmailMessage } from '@/lib/email/types';
import { validateEmailMessage } from '@/lib/email/message';

/**
 * Customer-facing email content (Phase 9 Task 3).
 *
 * Rendering lives here, in a pure module, so the worker handler is only
 * responsible for deciding *whether* to send and the tests can assert the
 * exact bytes a customer receives without a database or an email provider.
 *
 * Two rules are load-bearing:
 *
 *  - **No raw ticket id reaches a customer.** Links and subjects use the
 *    stable `formatTicketReference` code. The raw id stays an internal route
 *    key, and an email that has been forwarded, archived or scraped must not
 *    hand out a ticket identifier.
 *  - **User-supplied text is sanitized before it lands in a header.**
 *    Ticket titles and message bodies are attacker-controlled (a customer can
 *    type anything into a reply); unfiltered CRLF in a subject is header
 *    injection and a subject-long string is a delivery failure.
 */

const MAX_SUBJECT_COMPONENT_LENGTH = 80;
const MAX_BODY_EXCERPT_LENGTH = 400;

/**
 * Strips CR/LF and other control characters, collapses whitespace runs and
 * truncates, so a value is safe to interpolate into an email header.
 */
export function sanitizeSubjectComponent(value: string): string {
  const collapsed = value
    .replace(/[\u0000-\u001F\u007F]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();

  if (collapsed.length <= MAX_SUBJECT_COMPONENT_LENGTH) {
    return collapsed;
  }

  return `${collapsed.slice(0, MAX_SUBJECT_COMPONENT_LENGTH - 1).trimEnd()}…`;
}

/** Escapes the five characters that can break out of HTML text or an attribute. */
export function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

/** Truncates a message body for the email excerpt, on a word boundary. */
export function excerptBody(body: string): string {
  const collapsed = body.replace(/\r\n/g, '\n').trim();

  if (collapsed.length <= MAX_BODY_EXCERPT_LENGTH) {
    return collapsed;
  }

  const clipped = collapsed.slice(0, MAX_BODY_EXCERPT_LENGTH);
  const lastSpace = clipped.lastIndexOf(' ');

  return `${(lastSpace > MAX_BODY_EXCERPT_LENGTH * 0.6 ? clipped.slice(0, lastSpace) : clipped).trimEnd()}…`;
}

/**
 * Builds the customer's "your tickets" link.
 *
 * The workspace slug is a lookup key, not a credential, so the link is safe to
 * email; authentication still requires a customer session. The ticket id is
 * appended only as a human-readable reference in the subject and body.
 */
export function buildCustomerTicketsUrl(baseUrl: string, workspaceSlug: string): string {
  return `${baseUrl.replace(/\/+$/, '')}/portal/${encodeURIComponent(workspaceSlug)}/tickets`;
}

export interface BuildCustomerReplyEmailInput {
  to: string;
  workspaceName: string;
  workspaceSlug: string;
  baseUrl: string;
  ticketId: string;
  ticketTitle: string;
  messageBody: string;
}

export function buildCustomerReplyEmailMessage(input: BuildCustomerReplyEmailInput): EmailMessage {
  const reference = formatTicketReference(input.ticketId);
  const ticketsUrl = buildCustomerTicketsUrl(input.baseUrl, input.workspaceSlug);
  const workspace = sanitizeSubjectComponent(input.workspaceName);
  const excerpt = excerptBody(input.messageBody);

  return validateEmailMessage({
    to: input.to,
    subject: sanitizeSubjectComponent(`[${workspace}] New reply on ticket ${reference}`),
    text: [
      `Hi,`,
      '',
      `The support team replied to your ticket ${reference} — ${sanitizeSubjectComponent(input.ticketTitle)}.`,
      '',
      excerpt,
      '',
      `Read and reply: ${ticketsUrl}`,
      '',
      `You are receiving this because you asked to be notified about this ticket.`,
    ].join('\n'),
    html: [
      `<p>Hi,</p>`,
      `<p>The support team replied to your ticket <strong>${escapeHtml(reference)}</strong> — ${escapeHtml(sanitizeSubjectComponent(input.ticketTitle))}.</p>`,
      `<p>${escapeHtml(excerpt).replace(/\n/g, '<br />')}</p>`,
      `<p><a href="${escapeHtml(ticketsUrl)}">Read and reply</a></p>`,
      `<p style="color:#6b7280;font-size:12px">You are receiving this because you asked to be notified about this ticket.</p>`,
    ].join(''),
  });
}

export interface BuildCustomerStatusChangedEmailInput {
  to: string;
  workspaceName: string;
  workspaceSlug: string;
  baseUrl: string;
  ticketId: string;
  ticketTitle: string;
  fromStatus: CustomerTicketStatus;
  toStatus: CustomerTicketStatus;
}

export function buildCustomerStatusChangedEmailMessage(
  input: BuildCustomerStatusChangedEmailInput,
): EmailMessage {
  const reference = formatTicketReference(input.ticketId);
  const ticketsUrl = buildCustomerTicketsUrl(input.baseUrl, input.workspaceSlug);
  const workspace = sanitizeSubjectComponent(input.workspaceName);
  const toLabel = CUSTOMER_STATUS_LABELS[input.toStatus] ?? input.toStatus;

  return validateEmailMessage({
    to: input.to,
    subject: sanitizeSubjectComponent(`[${workspace}] Ticket ${reference} is now ${toLabel}`),
    text: [
      `Hi,`,
      '',
      `Your ticket ${reference} — ${sanitizeSubjectComponent(input.ticketTitle)} — is now ${toLabel}.`,
      '',
      `View it: ${ticketsUrl}`,
      '',
      `You are receiving this because you asked to be notified about this ticket.`,
    ].join('\n'),
    html: [
      `<p>Hi,</p>`,
      `<p>Your ticket <strong>${escapeHtml(reference)}</strong> — ${escapeHtml(sanitizeSubjectComponent(input.ticketTitle))} — is now <strong>${escapeHtml(toLabel)}</strong>.</p>`,
      `<p><a href="${escapeHtml(ticketsUrl)}">View ticket</a></p>`,
      `<p style="color:#6b7280;font-size:12px">You are receiving this because you asked to be notified about this ticket.</p>`,
    ].join(''),
  });
}
