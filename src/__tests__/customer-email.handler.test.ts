import { describe, it, expect, vi, beforeEach } from 'vitest';
import { handleCustomerEmailEvent } from '@/lib/queue/handlers/customer-email';
import { prisma } from '@/lib/db/prisma';
import { sendEmail } from '@/lib/email';
import type { OutboxEventRecord } from '@/lib/outbox/types';

/**
 * Customer email worker handler (Phase 9 Task 3).
 *
 * The handler's job is *when not to send*. Every event it processes describes
 * a recipient at the moment a transaction committed, and by the time the worker
 * runs the ticket may have been unlinked, relinked, or its customer deleted.
 * Sending on a stale claim is the one failure mode that mails a stranger, so
 * these tests are mostly about refusals; the happy path exists to show the
 * refusals are not simply "always skip".
 *
 * `SentEmail` idempotency is owned by `claimEmailSend` / `markEmailSent`, which
 * are covered in `email-handler.test.ts`. What is asserted here is that the
 * claim is attempted at all, and only after the recipient has been re-verified.
 */

vi.mock('@/lib/db/prisma', () => ({
  prisma: {
    message: { findFirst: vi.fn() },
    ticket: { findFirst: vi.fn() },
    sentEmail: {
      findFirst: vi.fn(),
      deleteMany: vi.fn().mockResolvedValue({ count: 0 }),
      create: vi.fn(),
      updateMany: vi.fn().mockResolvedValue({ count: 1 }),
    },
  },
}));

vi.mock('@/lib/email', () => ({
  sendEmail: vi.fn(),
  parseEmailProviderConfig: vi.fn().mockReturnValue({ provider: 'console', from: 'no-reply@example.com' }),
}));

const mockedPrisma = prisma as unknown as {
  message: { findFirst: ReturnType<typeof vi.fn> };
  ticket: { findFirst: ReturnType<typeof vi.fn> };
  sentEmail: {
    findFirst: ReturnType<typeof vi.fn>;
    deleteMany: ReturnType<typeof vi.fn>;
    create: ReturnType<typeof vi.fn>;
    updateMany: ReturnType<typeof vi.fn>;
  };
};
const mockedSendEmail = vi.mocked(sendEmail);

const WORKSPACE_ID = 'workspace-1';
const TICKET_ID = 'ticket-1';
const CUSTOMER_ID = 'customer-1';
const EVENT_ID = 'outbox-customer-email-1';

function replyEvent(overrides: Partial<OutboxEventRecord> = {}): OutboxEventRecord {
  return {
    id: EVENT_ID,
    eventType: 'TICKET_REPLIED',
    aggregateType: 'Ticket',
    aggregateId: TICKET_ID,
    payload: {
      workspaceId: WORKSPACE_ID,
      ticketId: TICKET_ID,
      messageId: 'message-1',
      customerId: CUSTOMER_ID,
    },
    createdAt: new Date('2026-09-24T00:00:00Z'),
    processedAt: null,
    attempts: 1,
    lastError: null,
    ...overrides,
  } as OutboxEventRecord;
}

function statusEvent(overrides: Partial<OutboxEventRecord> = {}): OutboxEventRecord {
  return {
    id: 'outbox-customer-email-2',
    eventType: 'TICKET_STATUS_CHANGED',
    aggregateType: 'Ticket',
    aggregateId: TICKET_ID,
    payload: {
      workspaceId: WORKSPACE_ID,
      ticketId: TICKET_ID,
      customerId: CUSTOMER_ID,
      fromStatus: 'open',
      toStatus: 'in_progress',
    },
    createdAt: new Date('2026-09-24T00:00:00Z'),
    processedAt: null,
    attempts: 1,
    lastError: null,
    ...overrides,
  } as OutboxEventRecord;
}

/** An agent message on a ticket that is still linked to the claimed customer. */
function agentMessage(overrides: Record<string, unknown> = {}) {
  return {
    id: 'message-1',
    body: 'We are looking into it.',
    authorType: 'agent',
    createdById: 'user-1',
    ticket: {
      id: TICKET_ID,
      title: 'Cannot log in',
      customerId: CUSTOMER_ID,
      customer: { id: CUSTOMER_ID, email: 'buyer@example.com' },
      workspace: { id: WORKSPACE_ID, slug: 'acme-support', name: 'Acme Support' },
    },
    ...overrides,
  };
}

function linkedTicket(overrides: Record<string, unknown> = {}) {
  return {
    id: TICKET_ID,
    title: 'Cannot log in',
    customerId: CUSTOMER_ID,
    customer: { id: CUSTOMER_ID, email: 'buyer@example.com' },
    workspace: { id: WORKSPACE_ID, slug: 'acme-support', name: 'Acme Support' },
    ...overrides,
  };
}

describe('customer email handler', () => {
  beforeEach(() => {
    vi.resetModules();
    mockedPrisma.message.findFirst.mockReset();
    mockedPrisma.ticket.findFirst.mockReset();
    mockedPrisma.sentEmail.findFirst.mockReset();
    mockedPrisma.sentEmail.deleteMany.mockReset();
    mockedPrisma.sentEmail.create.mockReset();
    mockedPrisma.sentEmail.updateMany.mockReset();
    mockedSendEmail.mockReset();
    mockedSendEmail.mockResolvedValue({ status: 'success' });
    mockedPrisma.sentEmail.findFirst.mockResolvedValue(null);
    mockedPrisma.sentEmail.create.mockResolvedValue({});
  });

  describe('reply notifications', () => {
    it('emails the linked customer and records the send', async () => {
      mockedPrisma.message.findFirst.mockResolvedValueOnce(agentMessage() as never);

      const result = await handleCustomerEmailEvent(replyEvent());

      expect(result.status).toBe('success');
      expect(mockedSendEmail).toHaveBeenCalledTimes(1);

      const [, message] = mockedSendEmail.mock.calls[0] as unknown as [unknown, { subject: string; text: string; to: string }];
      expect(message.to).toBe('buyer@example.com');
      expect(message.subject).toContain('New reply');
      expect(message.text).toContain('We are looking into it.');
      expect(message.text).not.toContain(TICKET_ID);

      expect(mockedPrisma.sentEmail.create).toHaveBeenCalledWith(
        expect.objectContaining({ data: expect.objectContaining({ outboxEventId: EVENT_ID, recipient: 'buyer@example.com' }) }),
      );
      expect(mockedPrisma.sentEmail.updateMany).toHaveBeenCalledWith(
        expect.objectContaining({ data: expect.objectContaining({ status: 'SENT' }) }),
      );
    });

    it('does not resend when the event was already sent', async () => {
      mockedPrisma.sentEmail.findFirst.mockResolvedValueOnce({
        outboxEventId: EVENT_ID,
        recipient: 'buyer@example.com',
        sentAt: new Date(),
      } as never);

      const result = await handleCustomerEmailEvent(replyEvent());

      expect(result.status).toBe('success');
      expect(mockedSendEmail).not.toHaveBeenCalled();
      expect(mockedPrisma.message.findFirst).not.toHaveBeenCalled();
    });

    it('sends nothing once the ticket has been unlinked', async () => {
      // The payload's customerId is the claim; the row is the truth.
      mockedPrisma.message.findFirst.mockResolvedValueOnce(
        agentMessage({ ticket: linkedTicket({ customerId: null, customer: null }) }) as never,
      );

      const result = await handleCustomerEmailEvent(replyEvent());

      expect(result.status).toBe('success');
      expect(mockedSendEmail).not.toHaveBeenCalled();
      expect(mockedPrisma.sentEmail.create).not.toHaveBeenCalled();
    });

    it('sends nothing when the ticket has been relinked to another customer', async () => {
      mockedPrisma.message.findFirst.mockResolvedValueOnce(
        agentMessage({
          ticket: linkedTicket({ customerId: 'customer-2', customer: { id: 'customer-2', email: 'other@example.com' } }),
        }) as never,
      );

      await handleCustomerEmailEvent(replyEvent());

      expect(mockedSendEmail).not.toHaveBeenCalled();
    });

    it('sends nothing when the customer row is gone', async () => {
      mockedPrisma.message.findFirst.mockResolvedValueOnce(
        agentMessage({ ticket: linkedTicket({ customer: null }) }) as never,
      );

      await handleCustomerEmailEvent(replyEvent());

      expect(mockedSendEmail).not.toHaveBeenCalled();
    });

    it('sends nothing when the customer has no email address', async () => {
      mockedPrisma.message.findFirst.mockResolvedValueOnce(
        agentMessage({ ticket: linkedTicket({ customer: { id: CUSTOMER_ID, email: null } }) }) as never,
      );

      const result = await handleCustomerEmailEvent(replyEvent());

      expect(result.status).toBe('success');
      expect(mockedSendEmail).not.toHaveBeenCalled();
    });

    it('never echoes a customer-authored message back to the customer', async () => {
      mockedPrisma.message.findFirst.mockResolvedValueOnce(
        agentMessage({ authorType: 'customer', createdById: null }) as never,
      );

      await handleCustomerEmailEvent(replyEvent());

      expect(mockedSendEmail).not.toHaveBeenCalled();
    });

    it('never emails a system message', async () => {
      mockedPrisma.message.findFirst.mockResolvedValueOnce(agentMessage({ authorType: 'system', createdById: null }) as never);

      await handleCustomerEmailEvent(replyEvent());

      expect(mockedSendEmail).not.toHaveBeenCalled();
    });

    it('sends nothing when the message has been deleted', async () => {
      mockedPrisma.message.findFirst.mockResolvedValueOnce(null);

      const result = await handleCustomerEmailEvent(replyEvent());

      expect(result.status).toBe('success');
      expect(mockedSendEmail).not.toHaveBeenCalled();
    });

    it('refuses a message that belongs to another workspace', async () => {
      // The message id matched, but the ticket it resolved to is elsewhere.
      mockedPrisma.message.findFirst.mockResolvedValueOnce(
        agentMessage({ ticket: linkedTicket({ workspace: { id: 'workspace-2', slug: 'other', name: 'Other' } }) }) as never,
      );

      await handleCustomerEmailEvent(replyEvent());

      expect(mockedSendEmail).not.toHaveBeenCalled();
    });

    it('skips a malformed payload instead of guessing', async () => {
      const result = await handleCustomerEmailEvent(
        replyEvent({ payload: { workspaceId: WORKSPACE_ID, ticketId: TICKET_ID } as never }),
      );

      expect(result.status).toBe('success');
      expect(mockedPrisma.message.findFirst).not.toHaveBeenCalled();
      expect(mockedSendEmail).not.toHaveBeenCalled();
    });
  });

  describe('status change notifications', () => {
    it('emails the linked customer about the new status', async () => {
      mockedPrisma.ticket.findFirst.mockResolvedValueOnce(linkedTicket() as never);

      const result = await handleCustomerEmailEvent(statusEvent());

      expect(result.status).toBe('success');
      const [, message] = mockedSendEmail.mock.calls[0] as unknown as [unknown, { subject: string; text: string }];
      expect(message.subject).toContain('In progress');
      expect(message.text).toContain('Cannot log in');
      expect(message.text).not.toContain(TICKET_ID);
    });

    it('sends nothing when the ticket was unlinked after the change', async () => {
      mockedPrisma.ticket.findFirst.mockResolvedValueOnce(linkedTicket({ customerId: null, customer: null }) as never);

      await handleCustomerEmailEvent(statusEvent());

      expect(mockedSendEmail).not.toHaveBeenCalled();
    });

    it('sends nothing when the ticket was relinked after the change', async () => {
      mockedPrisma.ticket.findFirst.mockResolvedValueOnce(
        linkedTicket({ customerId: 'customer-2', customer: { id: 'customer-2', email: 'other@example.com' } }) as never,
      );

      await handleCustomerEmailEvent(statusEvent());

      expect(mockedSendEmail).not.toHaveBeenCalled();
    });

    it('sends nothing when the ticket is gone', async () => {
      mockedPrisma.ticket.findFirst.mockResolvedValueOnce(null);

      await handleCustomerEmailEvent(statusEvent());

      expect(mockedSendEmail).not.toHaveBeenCalled();
    });

    it('sends nothing when the customer has no email address', async () => {
      mockedPrisma.ticket.findFirst.mockResolvedValueOnce(
        linkedTicket({ customer: { id: CUSTOMER_ID, email: null } }) as never,
      );

      await handleCustomerEmailEvent(statusEvent());

      expect(mockedSendEmail).not.toHaveBeenCalled();
    });

    it('looks the ticket up by id and workspace together', async () => {
      mockedPrisma.ticket.findFirst.mockResolvedValueOnce(null);

      await handleCustomerEmailEvent(statusEvent());

      expect(mockedPrisma.ticket.findFirst).toHaveBeenCalledWith(
        expect.objectContaining({ where: { id: TICKET_ID, workspaceId: WORKSPACE_ID } }),
      );
    });
  });

  describe('delivery failures', () => {
    it('releases the claim and reports a permanent rejection as non-retryable', async () => {
      mockedPrisma.message.findFirst.mockResolvedValueOnce(agentMessage() as never);
      mockedSendEmail.mockResolvedValueOnce({
        status: 'permanent_failure',
        error: { code: 'hard_bounce', message: 'hard bounced', retryable: false },
      });

      const result = await handleCustomerEmailEvent(replyEvent());

      expect(result).toMatchObject({ status: 'failure', error: { retryable: false } });
      expect(mockedPrisma.sentEmail.deleteMany).toHaveBeenCalledWith(
        expect.objectContaining({ where: expect.objectContaining({ status: 'SENDING' }) }),
      );
      expect(mockedPrisma.sentEmail.updateMany).not.toHaveBeenCalled();
    });

    it('releases the claim and rethrows a retryable provider failure', async () => {
      mockedPrisma.message.findFirst.mockResolvedValueOnce(agentMessage() as never);
      mockedSendEmail.mockResolvedValueOnce({
        status: 'retryable_failure',
        error: { code: 'rate_limited', message: 'provider down', retryable: true },
      });

      await expect(handleCustomerEmailEvent(replyEvent())).rejects.toThrow(/provider down/);
      expect(mockedPrisma.sentEmail.deleteMany).toHaveBeenCalledWith(
        expect.objectContaining({ where: expect.objectContaining({ status: 'SENDING' }) }),
      );
    });

    it('does not send at all when another worker holds the claim', async () => {
      mockedPrisma.message.findFirst.mockResolvedValueOnce(agentMessage() as never);
      mockedPrisma.sentEmail.create.mockRejectedValueOnce(
        Object.assign(new Error('Unique constraint failed'), { code: 'P2002' }),
      );

      const result = await handleCustomerEmailEvent(replyEvent());

      expect(result.status).toBe('success');
      expect(mockedSendEmail).not.toHaveBeenCalled();
    });
  });

  describe('unsupported events', () => {
    it('ignores an event that is not about a ticket', async () => {
      const result = await handleCustomerEmailEvent(replyEvent({ aggregateType: 'Workspace' as never }));

      expect(result.status).toBe('success');
      expect(mockedSendEmail).not.toHaveBeenCalled();
      expect(mockedPrisma.message.findFirst).not.toHaveBeenCalled();
    });

    it('ignores an event whose aggregate does not match the payload ticket', async () => {
      const result = await handleCustomerEmailEvent(replyEvent({ aggregateId: 'ticket-999' }));

      expect(result.status).toBe('success');
      expect(mockedPrisma.message.findFirst).not.toHaveBeenCalled();
    });

    it('ignores an unrelated event type', async () => {
      const result = await handleCustomerEmailEvent(replyEvent({ eventType: 'TICKET_PRIORITY_CHANGED' as never }));

      expect(result.status).toBe('success');
      expect(mockedSendEmail).not.toHaveBeenCalled();
    });
  });
});
