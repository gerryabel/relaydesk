import { prisma } from '@/lib/db/prisma';
import { env } from '@/lib/env';
import { parseEmailProviderConfig, sendEmail } from '@/lib/email';
import { classifyProviderError } from '@/lib/email/errors';
import { classifyDeliveryResult, RetryableError, PermanentError } from '@/lib/queue/errors';
import { info, warn } from '@/lib/queue/logger';
import type { OutboxEventRecord } from '@/lib/outbox/types';
import type { OutboxHandlerResult } from '@/lib/queue/handlers/types';
import type { EmailMessage } from '@/lib/email/types';
import {
  claimEmailSend,
  getSentEmail,
  markEmailSent,
  releaseEmailClaim,
} from './email-handler';
import {
  customerReplyEmailPayloadSchema,
  customerStatusChangedEmailPayloadSchema,
  type CustomerEmailEventType,
} from '@/lib/customer-notifications/events';
import {
  buildCustomerReplyEmailMessage,
  buildCustomerStatusChangedEmailMessage,
} from '@/lib/customer-notifications/email-content';

/**
 * Customer email worker handler (Phase 9 Task 3).
 *
 * Handles `TICKET_REPLIED` and `TICKET_STATUS_CHANGED`. Both follow the same
 * shape as `handleCustomerMagicLinkEvent`: validate the payload, check
 * `SentEmail` for idempotency, re-read the state the email describes, claim,
 * send, mark.
 *
 * The re-read is a security control, not a convenience. Between the moment a
 * transaction queued the event and the moment the worker runs, the ticket may
 * have been unlinked, relinked to a different customer, or the customer
 * record may have been deleted. The payload's `customerId` is a *claim* about
 * who the email was meant for; it is only honoured while the database still
 * agrees. On any disagreement the handler completes without sending, which
 * marks the outbox event done without mailing the wrong person.
 */

type SkipReason =
  | 'unsupported_event'
  | 'invalid_payload'
  | 'missing_ticket'
  | 'unlinked_customer'
  | 'missing_recipient'
  | 'stale_message';

function skipped(event: OutboxEventRecord, reason: SkipReason, detail?: Record<string, unknown>) {
  info('Customer email skipped', {
    outboxEventId: event.id,
    eventType: event.eventType,
    reason,
    ...detail,
  });
  return { status: 'success' } as const;
}

/** Shared send path: provider config, claim, deliver, mark or release. */
async function deliverCustomerEmail(event: OutboxEventRecord, message: EmailMessage): Promise<OutboxHandlerResult> {
  const claim = await claimEmailSend(event.id, message.to);
  if (!claim.claimed) {
    return { status: 'success' };
  }

  const config = parseEmailProviderConfig({
    provider: process.env.EMAIL_PROVIDER ?? 'console',
    from: process.env.EMAIL_FROM ?? 'RelayDesk <no-reply@example.com>',
    resendApiKey: process.env.RESEND_API_KEY ?? '',
  });

  try {
    const providerResult = await sendEmail(config, message);

    if (providerResult.status === 'success') {
      await markEmailSent(event.id);
      return { status: 'success' };
    }

    await releaseEmailClaim(event.id);

    if (providerResult.status === 'retryable_failure') {
      throw classifyDeliveryResult(providerResult);
    }

    return {
      status: 'failure',
      error: {
        message: providerResult.error?.message ?? 'Email provider permanently rejected the customer email',
        retryable: false,
      },
    };
  } catch (error) {
    if (error instanceof RetryableError || error instanceof PermanentError) {
      throw error;
    }

    const classification = classifyProviderError(error);
    await releaseEmailClaim(event.id);

    if (!classification.retryable) {
      return {
        status: 'failure',
        error: { message: classification.message, retryable: false },
      };
    }

    throw new RetryableError(classification.message);
  }
}

async function handleReplyEvent(event: OutboxEventRecord): Promise<OutboxHandlerResult> {
  const parsed = customerReplyEmailPayloadSchema.safeParse(event.payload);
  if (!parsed.success) {
    return skipped(event, 'invalid_payload');
  }
  const payload = parsed.data;

  if (await getSentEmail(event.id)) {
    return { status: 'success' };
  }

  const message = await prisma.message.findFirst({
    where: { id: payload.messageId, ticketId: payload.ticketId },
    select: {
      id: true,
      body: true,
      authorType: true,
      createdById: true,
      ticket: {
        select: {
          id: true,
          title: true,
          customerId: true,
          customer: { select: { id: true, email: true } },
          workspace: { select: { id: true, slug: true, name: true } },
        },
      },
    },
  });

  if (!message || message.ticket.workspace.id !== payload.workspaceId) {
    return skipped(event, 'missing_ticket');
  }

  // Only an agent-authored message may notify a customer. A customer reply
  // (or a system row) reaching this handler means the event was produced for
  // the wrong reason, and echoing a customer's own words back to them would
  // be both useless and confusing.
  if (message.authorType !== 'agent' || message.createdById === null) {
    return skipped(event, 'stale_message', { authorType: message.authorType });
  }

  const { ticket } = message;

  // The ticket's customer must still be the one the event was queued for.
  if (ticket.customerId !== payload.customerId) {
    return skipped(event, 'unlinked_customer');
  }

  if (!ticket.customer?.email) {
    return skipped(event, 'missing_recipient');
  }

  info('Customer reply email sending', {
    outboxEventId: event.id,
    eventType: event.eventType,
    ticketId: ticket.id,
  });

  return deliverCustomerEmail(
    event,
    buildCustomerReplyEmailMessage({
      to: ticket.customer.email,
      workspaceName: ticket.workspace.name,
      workspaceSlug: ticket.workspace.slug,
      baseUrl: env.BETTER_AUTH_URL,
      ticketId: ticket.id,
      ticketTitle: ticket.title,
      messageBody: message.body,
    }),
  );
}

async function handleStatusChangedEvent(event: OutboxEventRecord): Promise<OutboxHandlerResult> {
  const parsed = customerStatusChangedEmailPayloadSchema.safeParse(event.payload);
  if (!parsed.success) {
    return skipped(event, 'invalid_payload');
  }
  const payload = parsed.data;

  if (await getSentEmail(event.id)) {
    return { status: 'success' };
  }

  const ticket = await prisma.ticket.findFirst({
    where: { id: payload.ticketId, workspaceId: payload.workspaceId },
    select: {
      id: true,
      title: true,
      customerId: true,
      customer: { select: { id: true, email: true } },
      workspace: { select: { id: true, slug: true, name: true } },
    },
  });

  if (!ticket) {
    return skipped(event, 'missing_ticket');
  }

  // Unlinked or relinked since the event was queued: the old recipient may no
  // longer own this ticket, and the new one never asked about the old state.
  if (ticket.customerId !== payload.customerId) {
    return skipped(event, 'unlinked_customer');
  }

  if (!ticket.customer?.email) {
    return skipped(event, 'missing_recipient');
  }

  info('Customer status email sending', {
    outboxEventId: event.id,
    eventType: event.eventType,
    ticketId: ticket.id,
    toStatus: payload.toStatus,
  });

  return deliverCustomerEmail(
    event,
    buildCustomerStatusChangedEmailMessage({
      to: ticket.customer.email,
      workspaceName: ticket.workspace.name,
      workspaceSlug: ticket.workspace.slug,
      baseUrl: env.BETTER_AUTH_URL,
      ticketId: ticket.id,
      ticketTitle: ticket.title,
      fromStatus: payload.fromStatus,
      toStatus: payload.toStatus,
    }),
  );
}

/**
 * Entry point registered in the handler registry for both customer email
 * event types.
 */
export async function handleCustomerEmailEvent(event: OutboxEventRecord): Promise<OutboxHandlerResult> {
  if (event.aggregateType !== 'Ticket') {
    return skipped(event, 'unsupported_event', { aggregateType: event.aggregateType });
  }

  if (event.aggregateId !== (event.payload as { ticketId?: string } | null)?.ticketId) {
    return skipped(event, 'unsupported_event', { aggregateId: event.aggregateId });
  }

  switch (event.eventType as CustomerEmailEventType) {
    case 'TICKET_REPLIED':
      return handleReplyEvent(event);
    case 'TICKET_STATUS_CHANGED':
      return handleStatusChangedEvent(event);
    default:
      warn('No customer email handler for event type', {
        outboxEventId: event.id,
        eventType: event.eventType,
      });
      return skipped(event, 'unsupported_event');
  }
}
