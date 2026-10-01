import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';
import { GET, POST } from '@/app/api/tickets/[id]/messages/route';
import { getCurrentMembership } from '@/lib/workspace/server';

/**
 * Message endpoint isolation.
 *
 * The original intent is unchanged: the ticket conversation endpoint must read
 * and write `Message` rows and nothing else — in particular never
 * `InternalNote`, which is why a customer reply cannot be confused with an
 * internal note further down the stack.
 *
 * Since Task 3 the route is a thin wrapper around `createMessage`/`getMessages`
 * instead of writing rows itself, so these assertions follow the call through
 * to the transaction. That is the point of the refactor: a route that bypasses
 * the service could not have notified the customer, so the test asserts on the
 * service's behaviour instead of on ad-hoc route queries.
 */

vi.mock('@/lib/workspace/server', () => ({
  getCurrentMembership: vi.fn(),
  ForbiddenError: class extends Error {},
  UnauthorizedError: class extends Error {},
}));

const mocks = vi.hoisted(() => ({
  messageFindMany: vi.fn(),
  messageCreate: vi.fn(),
  ticketFindFirst: vi.fn(),
  internalNoteFindMany: vi.fn(),
  ticketUpdate: vi.fn(),
  outboxEventCreate: vi.fn(),
  transaction: vi.fn(),
}));

vi.mock('@/lib/db/prisma', () => {
  const tx = {
    message: { create: mocks.messageCreate },
    ticket: { update: mocks.ticketUpdate },
    outboxEvent: { create: mocks.outboxEventCreate },
  };

  const prisma = {
    ticket: { findFirst: mocks.ticketFindFirst },
    message: { findMany: mocks.messageFindMany, create: mocks.messageCreate },
    internalNote: { findMany: mocks.internalNoteFindMany },
    $transaction: mocks.transaction,
  };

  // A pass-through transaction so the service's writes are observable on the
  // same mocks the assertions read.
  mocks.transaction.mockImplementation((work: (client: unknown) => Promise<unknown>) => work(tx));

  return { prisma };
});

const mockedGetCurrentMembership = vi.mocked(getCurrentMembership);

function createRequest(init?: RequestInit) {
  return new NextRequest('http://localhost/api/tickets/ticket-1', {
    ...init,
    signal: undefined,
  });
}

afterEach(() => {
  mockedGetCurrentMembership.mockReset();
  mocks.ticketFindFirst.mockReset();
  mocks.messageFindMany.mockReset();
  mocks.messageCreate.mockReset();
  mocks.internalNoteFindMany.mockReset();
  mocks.ticketUpdate.mockReset();
  mocks.outboxEventCreate.mockReset();
  vi.restoreAllMocks();
});

describe('message endpoint isolation', () => {
  const fakeMembership = {
    userId: 'user-123',
    workspaceId: 'workspace-123',
    workspace: {
      id: 'workspace-123',
      name: 'Workspace 123',
      createdAt: new Date('2025-01-01T00:00:00Z'),
      updatedAt: new Date('2025-01-01T00:00:00Z'),
    },
  };

  it('GET only queries messages and never queries internal notes', async () => {
    mockedGetCurrentMembership.mockResolvedValue(fakeMembership as never);
    mocks.ticketFindFirst.mockResolvedValue({ id: 'ticket-1' } as never);
    mocks.messageFindMany.mockResolvedValue([] as never);

    await GET(createRequest(), { params: Promise.resolve({ id: 'ticket-1' }) });

    expect(mocks.messageFindMany).toHaveBeenCalledTimes(1);
    expect(mocks.internalNoteFindMany).not.toHaveBeenCalled();
  });

  it('POST creates one agent-authored message and never queries internal notes', async () => {
    mockedGetCurrentMembership.mockResolvedValue(fakeMembership as never);
    mocks.ticketFindFirst.mockResolvedValue({
      id: 'ticket-1',
      createdById: 'someone-else',
      firstResponseAt: null,
      customerId: null,
    } as never);
    mocks.messageCreate.mockResolvedValue({
      id: 'message-1',
      ticketId: 'ticket-1',
      createdById: 'user-123',
      customerId: null,
      authorType: 'agent',
      body: 'Balasan pelanggan.',
      createdAt: new Date('2025-01-01T00:00:00Z'),
      updatedAt: new Date('2025-01-01T00:00:00Z'),
      customer: null,
      createdBy: {
        id: 'user-123',
        email: 'user@example.com',
        emailVerified: true,
        name: 'User 123',
        image: null,
        createdAt: new Date('2025-01-01T00:00:00Z'),
        updatedAt: new Date('2025-01-01T00:00:00Z'),
      },
      attachments: [],
    } as never);

    await POST(
      createRequest({ method: 'POST', body: JSON.stringify({ body: 'Balasan pelanggan.' }) }),
      { params: Promise.resolve({ id: 'ticket-1' }) },
    );

    expect(mocks.messageCreate).toHaveBeenCalledTimes(1);
    expect(mocks.internalNoteFindMany).not.toHaveBeenCalled();

    // Authorship is written explicitly rather than inferred from a null
    // foreign key: agent means createdById present, customerId explicitly null.
    expect(mocks.messageCreate.mock.calls[0]?.[0]?.data).toMatchObject({
      ticketId: 'ticket-1',
      createdById: 'user-123',
      customerId: null,
      authorType: 'agent',
    });
  });

  describe('agent reply notification', () => {
    const agentReply = (body: string) =>
      POST(createRequest({ method: 'POST', body: JSON.stringify({ body }) }), {
        params: Promise.resolve({ id: 'ticket-1' }),
      });

    const ticketWithCustomer = {
      id: 'ticket-1',
      workspaceId: 'workspace-123',
      createdById: 'someone-else',
      firstResponseAt: null,
      customerId: 'customer-1',
    };

    const createdMessage = {
      id: 'message-1',
      ticketId: 'ticket-1',
      createdById: 'user-123',
      customerId: null,
      authorType: 'agent',
      body: 'Balasan pelanggan.',
      createdAt: new Date('2025-01-01T00:00:00Z'),
      updatedAt: new Date('2025-01-01T00:00:00Z'),
      customer: null,
      createdBy: {
        id: 'user-123',
        email: 'user@example.com',
        emailVerified: true,
        name: 'User 123',
        image: null,
        createdAt: new Date('2025-01-01T00:00:00Z'),
        updatedAt: new Date('2025-01-01T00:00:00Z'),
      },
      attachments: [],
    };

    beforeEach(() => {
      mockedGetCurrentMembership.mockResolvedValue(fakeMembership as never);
      // The pass-through transaction accumulates calls across the whole file.
      mocks.transaction.mockClear();
      mocks.messageCreate.mockResolvedValue(createdMessage as never);
      mocks.ticketUpdate.mockResolvedValue({ id: 'ticket-1' } as never);
      mocks.outboxEventCreate.mockResolvedValue({ id: 'outbox-1' } as never);
    });

    it('queues a customer reply event for a ticket that has a customer', async () => {
      mocks.ticketFindFirst.mockResolvedValue(ticketWithCustomer as never);

      await agentReply('Balasan pelanggan.');

      expect(mocks.outboxEventCreate).toHaveBeenCalledTimes(1);
      expect(mocks.outboxEventCreate.mock.calls[0]?.[0]?.data).toMatchObject({
        eventType: 'TICKET_REPLIED',
        aggregateType: 'Ticket',
        aggregateId: 'ticket-1',
        payload: {
          workspaceId: 'workspace-123',
          ticketId: 'ticket-1',
          customerId: 'customer-1',
          messageId: 'message-1',
        },
      });
    });

    it('queues nothing for an internal ticket', async () => {
      mocks.ticketFindFirst.mockResolvedValue({ ...ticketWithCustomer, customerId: null } as never);

      await agentReply('Balasan pelanggan.');

      expect(mocks.messageCreate).toHaveBeenCalledTimes(1);
      expect(mocks.outboxEventCreate).not.toHaveBeenCalled();
    });

    it('writes the message, the first response and the event in one transaction', async () => {
      mocks.ticketFindFirst.mockResolvedValue(ticketWithCustomer as never);

      await agentReply('Balasan pelanggan.');

      expect(mocks.transaction).toHaveBeenCalledTimes(1);
      expect(mocks.ticketUpdate).toHaveBeenCalledWith(
        expect.objectContaining({ where: { id: 'ticket-1' }, data: { firstResponseAt: expect.any(Date) } }),
      );
      // Order matters only in that the message must exist before the event that
      // references it; both must be inside the same transaction.
      const order = mocks.transaction.mock.invocationCallOrder[0];
      expect(mocks.messageCreate.mock.invocationCallOrder[0]).toBeGreaterThanOrEqual(order);
      expect(mocks.outboxEventCreate.mock.invocationCallOrder[0]).toBeGreaterThan(order);
    });

    it('does not move firstResponseAt on a ticket that already has one', async () => {
      mocks.ticketFindFirst.mockResolvedValue({
        ...ticketWithCustomer,
        firstResponseAt: new Date('2025-01-01T00:00:00Z'),
      } as never);

      await agentReply('Balasan pelanggan.');

      expect(mocks.ticketUpdate).not.toHaveBeenCalled();
      // The event is still queued: this is a new reply on an already-answered
      // ticket, not a first response.
      expect(mocks.outboxEventCreate).toHaveBeenCalledTimes(1);
    });
  });
});
