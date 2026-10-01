import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  CUSTOMER_EMAIL_EVENT_TYPES,
  customerReplyEmailPayloadSchema,
  customerStatusChangedEmailPayloadSchema,
  queueCustomerReplyEmail,
  queueCustomerStatusChangedEmail,
} from '@/lib/customer-notifications/events';
import { createOutboxEvent } from '@/lib/outbox/outbox';

/**
 * Customer email event emission (Phase 9 Task 3).
 *
 * The payload is the contract between a write transaction and a worker that
 * runs later, so it is worth pinning three things: it carries identifiers and
 * nothing a human reads, it is validated before it is queued rather than
 * trusted, and the two conditions under which it must *not* queue at all.
 *
 * "Identifiers only" is the security-relevant one. A payload carrying an email
 * address or a rendered subject would let an event queued before a customer was
 * unlinked mail the wrong person; the worker can only re-check what it can
 * re-read.
 */

vi.mock('@/lib/outbox/outbox', () => ({ createOutboxEvent: vi.fn() }));

const mockedCreateOutboxEvent = vi.mocked(createOutboxEvent);

const tx = {} as never;

describe('customer email payload schemas', () => {
  it('accepts a complete reply payload', () => {
    expect(
      customerReplyEmailPayloadSchema.parse({
        workspaceId: 'workspace-1',
        ticketId: 'ticket-1',
        customerId: 'customer-1',
        messageId: 'message-1',
      }),
    ).toMatchObject({ ticketId: 'ticket-1' });
  });

  it('rejects a reply payload with no message id', () => {
    expect(
      customerReplyEmailPayloadSchema.safeParse({
        workspaceId: 'workspace-1',
        ticketId: 'ticket-1',
        customerId: 'customer-1',
      }).success,
    ).toBe(false);
  });

  it('rejects a reply payload with an empty customer id', () => {
    expect(
      customerReplyEmailPayloadSchema.safeParse({
        workspaceId: 'workspace-1',
        ticketId: 'ticket-1',
        customerId: '',
        messageId: 'message-1',
      }).success,
    ).toBe(false);
  });

  it('rejects extra keys, so a payload cannot smuggle content past the worker', () => {
    expect(
      customerReplyEmailPayloadSchema.safeParse({
        workspaceId: 'workspace-1',
        ticketId: 'ticket-1',
        customerId: 'customer-1',
        messageId: 'message-1',
        to: 'attacker@evil.test',
        subject: 'anything',
      }).success,
    ).toBe(false);
  });

  it('accepts a status payload with both statuses', () => {
    expect(
      customerStatusChangedEmailPayloadSchema.safeParse({
        workspaceId: 'workspace-1',
        ticketId: 'ticket-1',
        customerId: 'customer-1',
        fromStatus: 'open',
        toStatus: 'closed',
      }).success,
    ).toBe(true);
  });

  it('rejects a status payload with a status outside the ticket status set', () => {
    expect(
      customerStatusChangedEmailPayloadSchema.safeParse({
        workspaceId: 'workspace-1',
        ticketId: 'ticket-1',
        customerId: 'customer-1',
        fromStatus: 'open',
        toStatus: 'deleted',
      }).success,
    ).toBe(false);
  });
});

describe('CUSTOMER_EMAIL_EVENT_TYPES', () => {
  it('names exactly the two events the worker handles', () => {
    expect(CUSTOMER_EMAIL_EVENT_TYPES).toEqual(['TICKET_REPLIED', 'TICKET_STATUS_CHANGED']);
  });
});

describe('queueCustomerReplyEmail', () => {
  beforeEach(() => {
    mockedCreateOutboxEvent.mockReset();
    mockedCreateOutboxEvent.mockResolvedValue(undefined as never);
  });

  it('queues an identifier-only payload on the caller transaction', async () => {
    await queueCustomerReplyEmail(tx, {
      workspaceId: 'workspace-1',
      ticketId: 'ticket-1',
      customerId: 'customer-1',
      messageId: 'message-1',
    });

    expect(mockedCreateOutboxEvent).toHaveBeenCalledTimes(1);
    const [input, passedTx] = mockedCreateOutboxEvent.mock.calls[0] as unknown as [
      { eventType: string; aggregateType: string; aggregateId: string; payload: Record<string, unknown> },
      unknown,
    ];

    expect(input.eventType).toBe('TICKET_REPLIED');
    expect(input.aggregateType).toBe('Ticket');
    expect(input.aggregateId).toBe('ticket-1');
    expect(input.payload).toEqual({
      workspaceId: 'workspace-1',
      ticketId: 'ticket-1',
      customerId: 'customer-1',
      messageId: 'message-1',
    });
    expect(passedTx).toBe(tx);
  });

  it('queues nothing for an internal ticket', async () => {
    await queueCustomerReplyEmail(tx, {
      workspaceId: 'workspace-1',
      ticketId: 'ticket-1',
      customerId: null,
      messageId: 'message-1',
    });

    expect(mockedCreateOutboxEvent).not.toHaveBeenCalled();
  });

  it('refuses to queue a payload missing an id', async () => {
    await expect(
      queueCustomerReplyEmail(tx, {
        workspaceId: 'workspace-1',
        ticketId: 'ticket-1',
        customerId: 'customer-1',
        messageId: '',
      }),
    ).rejects.toThrow();

    expect(mockedCreateOutboxEvent).not.toHaveBeenCalled();
  });
});

describe('queueCustomerStatusChangedEmail', () => {
  beforeEach(() => {
    mockedCreateOutboxEvent.mockReset();
    mockedCreateOutboxEvent.mockResolvedValue(undefined as never);
  });

  it('queues the transition on the caller transaction', async () => {
    await queueCustomerStatusChangedEmail(tx, {
      workspaceId: 'workspace-1',
      ticketId: 'ticket-1',
      customerId: 'customer-1',
      fromStatus: 'open',
      toStatus: 'in_progress',
    });

    const [input] = mockedCreateOutboxEvent.mock.calls[0] as unknown as [
      { eventType: string; aggregateId: string; payload: Record<string, unknown> },
    ];

    expect(input.eventType).toBe('TICKET_STATUS_CHANGED');
    expect(input.aggregateId).toBe('ticket-1');
    expect(input.payload).toEqual({
      workspaceId: 'workspace-1',
      ticketId: 'ticket-1',
      customerId: 'customer-1',
      fromStatus: 'open',
      toStatus: 'in_progress',
    });
  });

  it('queues nothing for an unlinked ticket', async () => {
    await queueCustomerStatusChangedEmail(tx, {
      workspaceId: 'workspace-1',
      ticketId: 'ticket-1',
      customerId: null,
      fromStatus: 'open',
      toStatus: 'closed',
    });

    expect(mockedCreateOutboxEvent).not.toHaveBeenCalled();
  });

  it('queues nothing when the status did not change', async () => {
    // A caller that reports a no-op transition would email a customer about
    // something that did not happen.
    await queueCustomerStatusChangedEmail(tx, {
      workspaceId: 'workspace-1',
      ticketId: 'ticket-1',
      customerId: 'customer-1',
      fromStatus: 'open',
      toStatus: 'open',
    });

    expect(mockedCreateOutboxEvent).not.toHaveBeenCalled();
  });

  it('refuses to queue a transition to a status the ticket model does not have', async () => {
    await expect(
      queueCustomerStatusChangedEmail(tx, {
        workspaceId: 'workspace-1',
        ticketId: 'ticket-1',
        customerId: 'customer-1',
        fromStatus: 'open',
        toStatus: 'deleted' as never,
      }),
    ).rejects.toThrow();

    expect(mockedCreateOutboxEvent).not.toHaveBeenCalled();
  });
});
