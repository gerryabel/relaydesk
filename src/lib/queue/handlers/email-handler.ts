import { prisma } from '@/lib/db/prisma';
import { parseEmailProviderConfig, sendEmail } from '@/lib/email';
import { validateEmailMessage } from '@/lib/email/message';
import { classifyProviderError } from '@/lib/email/errors';
import { RetryableError, PermanentError, classifyDeliveryResult } from '@/lib/queue/errors';
import type { OutboxEventRecord } from '@/lib/outbox/types';
import type { OutboxHandlerResult } from '@/lib/queue/handlers/types';

export async function getSentEmail(outboxEventId: string) {
  // @ts-expect-error Prisma client is stale until prisma generate after migration
  return prisma.sentEmail.findUnique({
    where: { outboxEventId },
    select: { outboxEventId: true, recipient: true, sentAt: true },
  });
}

export async function markEmailSent(outboxEventId: string, recipient: string) {
  // @ts-expect-error Prisma client is stale until prisma generate after migration
  await prisma.sentEmail.create({
    data: { outboxEventId, recipient },
  });
}

export async function sendEmailForOutboxEvent(event: OutboxEventRecord): Promise<OutboxHandlerResult> {
  if (event.eventType !== 'TICKET_ASSIGNED' || event.aggregateType !== 'Ticket' || event.aggregateId !== event.payload?.ticketId) {
    return {
      status: 'failure',
      error: {
        message: `Unsupported email event: ${event.eventType}`,
        retryable: false,
      },
    };
  }

  const ticketId = event.payload.ticketId as string | undefined;
  const assigneeId = event.payload.assigneeId as string | undefined;
  const workspaceId = event.payload.workspaceId as string | undefined;

  if (!ticketId || !assigneeId || !workspaceId) {
    return {
      status: 'failure',
      error: {
        message: 'Missing ticket, assignee, or workspace id in outbox payload',
        retryable: false,
      },
    };
  }

  const [ticket, assignee] = await Promise.all([
    prisma.ticket.findFirst({
      where: { id: ticketId, workspaceId },
      select: { id: true, title: true },
    }),
    prisma.user.findFirst({
      where: { id: assigneeId },
      select: { id: true, email: true, name: true },
    }),
  ]);

  if (!ticket) {
    return {
      status: 'failure',
      error: {
        message: `Ticket ${ticketId} not found in workspace ${workspaceId}`,
        retryable: false,
      },
    };
  }

  if (!assignee?.email) {
    return {
      status: 'failure',
      error: {
        message: `Assignee ${assigneeId} does not have an email`,
        retryable: false,
      },
    };
  }

  const existingDelivery = await getSentEmail(event.id);
  if (existingDelivery) {
    return { status: 'success' };
  }

  const message = validateEmailMessage({
    to: assignee.email,
    subject: `Ticket assigned: ${ticket.title}`,
    text: `You have been assigned to ticket #${ticket.id}: ${ticket.title}.`,
    html: `<p>You have been assigned to ticket #${ticket.id}: <strong>${ticket.title}</strong>.</p>`,
  });

  const config = parseEmailProviderConfig({
    provider: process.env.EMAIL_PROVIDER ?? 'console',
    from: process.env.EMAIL_FROM ?? 'RelayDesk <no-reply@example.com>',
    resendApiKey: process.env.RESEND_API_KEY,
  });

  const result = await sendEmail(config, message);
  if (result.status === 'success') {
    await markEmailSent(event.id, message.to);
    return { status: 'success' };
  }

  const providerError = result.error
    ? classifyProviderError(new Error(result.error.message))
    : classifyProviderError(new Error('Email provider failed'));

  if (!providerError.retryable) {
    return {
      status: 'failure',
      error: {
        message: providerError.message,
        retryable: false,
      },
    };
  }

  throw classifyDeliveryResult(result);
}

export function wrapHandlerResult(result: unknown): OutboxHandlerResult | never {
  if (typeof result !== 'object' || result === null || !('status' in result)) {
    throw new PermanentError('Handler returned an unsupported result');
  }

  const typed = result as { status: string; error?: { message?: string; retryable?: boolean } };

  if (typed.status === 'success') {
    return { status: 'success' };
  }

  if (typed.status !== 'failure' || !typed.error) {
    throw new PermanentError('Handler returned an unsupported failure result');
  }

  if (typed.error.retryable) {
    throw new RetryableError(typed.error.message ?? 'Retryable handler failure');
  }

  throw new PermanentError(typed.error.message ?? 'Permanent handler failure');
}

export const handleEmailOutboxEvent = sendEmailForOutboxEvent;
