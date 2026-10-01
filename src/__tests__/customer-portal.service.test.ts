import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  createCustomerReply,
  createCustomerTicket,
  getCustomerTicket,
  listCustomerTickets,
} from '@/lib/customer-portal/server';
import { requireCustomerInWorkspace } from '@/lib/customer-portal/session';
import { getWorkspaceSlaPolicy } from '@/lib/workspace/sla-policy';
import { createOutboxEvent } from '@/lib/outbox/outbox';
import { queueAutomationEvaluation } from '@/lib/automation/outbox';
import { CustomerTicketNotFoundError, CustomerTicketReplyNotAllowedError } from '@/lib/customer-portal/errors';
import { CustomerUnauthenticatedError } from '@/lib/customer-access/errors';

/**
 * Customer ticket service behavior (Phase 9 Task 2; customer reply in Task 3).
 *
 * The database is mocked so the *query shape* can be asserted directly, which
 * is the property that matters and the one mocks can prove: that a ticket read
 * is scoped by `(workspaceId, customerId)` inside the `where` clause rather
 * than filtered afterwards, and that a create derives ownership from the
 * session instead of from its input.
 *
 * The real-database equivalents live in `customer-portal.integration.test.ts`.
 */

vi.mock('@/lib/customer-portal/session', () => ({
  requireCustomerInWorkspace: vi.fn(),
}));

const prismaMocks = vi.hoisted(() => ({
  ticketFindFirst: vi.fn(),
  ticketFindMany: vi.fn(),
  ticketCount: vi.fn(),
  messageFindMany: vi.fn(),
  messageCreate: vi.fn(),
  messageGroupBy: vi.fn(),
  ticketActivityGroupBy: vi.fn(),
  transaction: vi.fn(),
}));

vi.mock('@/lib/db/prisma', () => ({
  prisma: {
    ticket: {
      findFirst: prismaMocks.ticketFindFirst,
      findMany: prismaMocks.ticketFindMany,
      count: prismaMocks.ticketCount,
    },
    message: {
      findMany: prismaMocks.messageFindMany,
      create: prismaMocks.messageCreate,
      groupBy: prismaMocks.messageGroupBy,
    },
    ticketActivity: {
      groupBy: prismaMocks.ticketActivityGroupBy,
    },
    $transaction: prismaMocks.transaction,
  },
}));

vi.mock('@/lib/workspace/sla-policy', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/workspace/sla-policy')>();

  return { ...actual, getWorkspaceSlaPolicy: vi.fn() };
});

vi.mock('@/lib/outbox/outbox', () => ({ createOutboxEvent: vi.fn() }));
vi.mock('@/lib/automation/outbox', () => ({ queueAutomationEvaluation: vi.fn() }));

const mockedRequireSession = vi.mocked(requireCustomerInWorkspace);
const mockedSlaPolicy = vi.mocked(getWorkspaceSlaPolicy);
const mockedCreateOutboxEvent = vi.mocked(createOutboxEvent);
const mockedQueueAutomation = vi.mocked(queueAutomationEvaluation);

const workspace = { id: 'workspace-1', name: 'Acme Support', slug: 'acme-support' };
const customer = { id: 'customer-1', workspaceId: workspace.id, name: 'Buyer', email: 'buyer@example.com' };
const otherCustomer = { id: 'customer-2', workspaceId: workspace.id, name: 'Other', email: 'other@example.com' };

const createdAt = new Date('2026-01-01T10:00:00Z');

function sessionFor(activeCustomer = customer) {
  return {
    workspace,
    customer: {
      sessionId: 'session-1',
      customerId: activeCustomer.id,
      workspaceId: workspace.id,
      workspaceSlug: workspace.slug,
      workspaceName: workspace.name,
      email: activeCustomer.email,
      expiresAt: new Date('2099-01-01T00:00:00Z'),
    },
  };
}

function ticketRow(overrides: Record<string, unknown> = {}) {
  return {
    id: 'ticket-1',
    title: 'Printer is offline',
    description: 'It stopped this morning.',
    status: 'open',
    priority: 'medium',
    createdAt,
    resolvedAt: null,
    ...overrides,
  };
}

beforeEach(() => {
  mockedRequireSession.mockResolvedValue(sessionFor() as never);
  prismaMocks.ticketCount.mockResolvedValue(0);
  prismaMocks.ticketFindMany.mockResolvedValue([]);
  prismaMocks.ticketFindFirst.mockResolvedValue(null);
  prismaMocks.messageFindMany.mockResolvedValue([]);
  prismaMocks.messageGroupBy.mockResolvedValue([]);
  prismaMocks.ticketActivityGroupBy.mockResolvedValue([]);
});

afterEach(() => {
  vi.resetAllMocks();
});

describe('listCustomerTickets', () => {
  it('scopes the query by workspace and customer together', async () => {
    await listCustomerTickets({ workspaceSlug: workspace.slug });

    const args = prismaMocks.ticketFindMany.mock.calls[0]?.[0];

    // The whole guarantee lives in these two lines. A workspace-wide read
    // followed by a filter would be a cross-customer leak the moment the
    // filter drifted.
    expect(args?.where).toMatchObject({
      workspaceId: workspace.id,
      customerId: customer.id,
    });
  });

  it('never selects a column outside the customer allowlist', async () => {
    await listCustomerTickets({ workspaceSlug: workspace.slug });

    const args = prismaMocks.ticketFindMany.mock.calls[0]?.[0];

    expect(Object.keys(args?.select ?? {}).sort()).toEqual([
      'createdAt',
      'description',
      'id',
      'priority',
      'resolvedAt',
      'status',
      'title',
    ]);
  });

  it('searches only customer-owned text', async () => {
    await listCustomerTickets({ workspaceSlug: workspace.slug, params: { q: 'printer' } });

    const where = prismaMocks.ticketFindMany.mock.calls[0]?.[0]?.where as {
      OR: Array<Record<string, unknown>>;
    };

    expect(where.OR).toEqual([
      { title: { contains: 'printer', mode: 'insensitive' } },
      { description: { contains: 'printer', mode: 'insensitive' } },
    ]);

    // The customer must not be able to search by, or learn about, internal
    // attribution.
    expect(JSON.stringify(where.OR)).not.toContain('createdBy');
    expect(JSON.stringify(where.OR)).not.toContain('assignedTo');
  });

  it('omits the search clause for a blank term', async () => {
    await listCustomerTickets({ workspaceSlug: workspace.slug, params: { q: '   ' } });

    const where = prismaMocks.ticketFindMany.mock.calls[0]?.[0]?.where as Record<string, unknown>;

    expect(where.OR).toBeUndefined();
  });

  it('orders by most recent activity', async () => {
    await listCustomerTickets({ workspaceSlug: workspace.slug });

    expect(prismaMocks.ticketFindMany.mock.calls[0]?.[0]?.orderBy).toEqual([
      { createdAt: 'desc' },
      { id: 'desc' },
    ]);
  });

  it('issues a fixed number of queries regardless of page size', async () => {
    prismaMocks.ticketCount.mockResolvedValue(120);
    prismaMocks.ticketFindMany.mockResolvedValue(
      Array.from({ length: 20 }, (_, index) => ticketRow({ id: `ticket-${index}` })) as never,
    );

    const page = await listCustomerTickets({ workspaceSlug: workspace.slug, params: { limit: '20' } });

    // count + findMany + two grouped max(createdAt) reads (messages and
    // status changes). A per-ticket lookup would be N+1 and would leak row
    // counts by latency.
    expect(prismaMocks.ticketCount).toHaveBeenCalledTimes(1);
    expect(prismaMocks.ticketFindMany).toHaveBeenCalledTimes(1);
    expect(prismaMocks.messageGroupBy).toHaveBeenCalledTimes(1);
    expect(prismaMocks.ticketActivityGroupBy).toHaveBeenCalledTimes(1);
    expect(page.total).toBe(120);
    expect(page.totalPages).toBe(6);
  });

  it('reads the grouped message maximum only for the returned page', async () => {
    prismaMocks.ticketFindMany.mockResolvedValue([
      ticketRow({ id: 'a' }),
      ticketRow({ id: 'b' }),
    ] as never);

    await listCustomerTickets({ workspaceSlug: workspace.slug, params: { limit: '5' } });

    const args = prismaMocks.messageGroupBy.mock.calls[0]?.[0];

    // Grouped by ticket, selecting only the newest timestamp — and restricted
    // to the page that is actually being rendered.
    expect(args?.by).toEqual(['ticketId']);
    expect(args?.where).toMatchObject({ ticketId: { in: ['a', 'b'] } });
  });

  it('reads only STATUS_CHANGED activity, never the internal audit trail', async () => {
    prismaMocks.ticketFindMany.mockResolvedValue([ticketRow({ id: 'a' })] as never);

    await listCustomerTickets({ workspaceSlug: workspace.slug });

    const args = prismaMocks.ticketActivityGroupBy.mock.calls[0]?.[0];

    expect(args?.by).toEqual(['ticketId']);
    // The type filter is in the query, so an assignee id or an internal
    // before/after value is never fetched, let alone serialized.
    expect(args?.where).toMatchObject({ ticketId: { in: ['a'] }, type: 'STATUS_CHANGED' });
    expect(JSON.stringify(args)).not.toContain('actorId');
    expect(JSON.stringify(args)).not.toContain('metadata');
  });

  it('skips the grouped reads entirely when the page is empty', async () => {
    await listCustomerTickets({ workspaceSlug: workspace.slug });

    expect(prismaMocks.messageGroupBy).not.toHaveBeenCalled();
    expect(prismaMocks.ticketActivityGroupBy).not.toHaveBeenCalled();
  });

  it('derives last activity from messages, not updatedAt', async () => {
    const lastMessageAt = new Date('2026-01-05T10:00:00Z');

    prismaMocks.ticketFindMany.mockResolvedValue([ticketRow()] as never);
    prismaMocks.messageGroupBy.mockResolvedValue([
      { ticketId: 'ticket-1', _max: { createdAt: lastMessageAt } },
    ] as never);

    const page = await listCustomerTickets({ workspaceSlug: workspace.slug });

    expect(page.data[0]?.lastActivityAt).toBe(lastMessageAt.toISOString());
  });

  it('counts a status change as customer-visible activity', async () => {
    const lastStatusAt = new Date('2026-01-06T10:00:00Z');

    prismaMocks.ticketFindMany.mockResolvedValue([ticketRow()] as never);
    prismaMocks.ticketActivityGroupBy.mockResolvedValue([
      { ticketId: 'ticket-1', _max: { createdAt: lastStatusAt } },
    ] as never);

    const page = await listCustomerTickets({ workspaceSlug: workspace.slug });

    expect(page.data[0]?.lastActivityAt).toBe(lastStatusAt.toISOString());
  });

  it('does not count an internal activity row as customer-visible', async () => {
    // Only STATUS_CHANGED is grouped; the caller cannot be tricked into
    // treating an assignment or a tag change as something a customer did.
    const internalActivityAt = new Date('2026-01-07T10:00:00Z');

    prismaMocks.ticketFindMany.mockResolvedValue([ticketRow()] as never);
    prismaMocks.ticketActivityGroupBy.mockImplementation(
      (args: { where?: { type?: string } }) => {
        if (args.where?.type !== 'STATUS_CHANGED') {
          return Promise.resolve([
            { ticketId: 'ticket-1', _max: { createdAt: internalActivityAt } },
          ]);
        }

        return Promise.resolve([]);
      },
    );

    const page = await listCustomerTickets({ workspaceSlug: workspace.slug });

    expect(page.data[0]?.lastActivityAt).toBe(createdAt.toISOString());
  });

  it('falls back to creation time for a ticket with no messages', async () => {
    prismaMocks.ticketFindMany.mockResolvedValue([ticketRow()] as never);

    const page = await listCustomerTickets({ workspaceSlug: workspace.slug });

    expect(page.data[0]?.lastActivityAt).toBe(createdAt.toISOString());
  });

  it('clamps an out-of-range page onto the last page', async () => {
    prismaMocks.ticketCount.mockResolvedValue(3);

    const page = await listCustomerTickets({ workspaceSlug: workspace.slug, params: { page: '99' } });

    expect(page.page).toBe(1);
    expect(page.hasNextPage).toBe(false);
    expect(page.hasPreviousPage).toBe(false);
  });

  it('rejects a caller-supplied customerId before touching the database', async () => {
    await expect(
      listCustomerTickets({
        workspaceSlug: workspace.slug,
        params: { q: 'ok', customerId: otherCustomer.id },
      }),
    ).rejects.toThrow();

    expect(prismaMocks.ticketFindMany).not.toHaveBeenCalled();
  });

  it('rejects an invalid page', async () => {
    await expect(
      listCustomerTickets({ workspaceSlug: workspace.slug, params: { page: '0' } }),
    ).rejects.toThrow();

    expect(prismaMocks.ticketFindMany).not.toHaveBeenCalled();
  });

  it('propagates an unauthenticated session without reading any ticket', async () => {
    mockedRequireSession.mockRejectedValue(new CustomerUnauthenticatedError());

    await expect(listCustomerTickets({ workspaceSlug: workspace.slug })).rejects.toBeInstanceOf(
      CustomerUnauthenticatedError,
    );

    expect(prismaMocks.ticketFindMany).not.toHaveBeenCalled();
  });
});

describe('getCustomerTicket', () => {
  it('scopes the read by id, workspace and customer in one query', async () => {
    prismaMocks.ticketFindFirst.mockResolvedValue(ticketRow() as never);

    await getCustomerTicket({ workspaceSlug: workspace.slug, ticketId: 'ticket-1' });

    expect(prismaMocks.ticketFindFirst.mock.calls[0]?.[0]?.where).toEqual({
      id: 'ticket-1',
      workspaceId: workspace.id,
      customerId: customer.id,
    });
  });

  it('reports another customer ticket as not found', async () => {
    // `findFirst` returns null for a cross-customer id because the predicate
    // excludes it — there is no "exists but forbidden" outcome to leak.
    prismaMocks.ticketFindFirst.mockResolvedValue(null);

    await expect(
      getCustomerTicket({ workspaceSlug: workspace.slug, ticketId: 'ticket-1' }),
    ).rejects.toBeInstanceOf(CustomerTicketNotFoundError);

    expect(prismaMocks.messageFindMany).not.toHaveBeenCalled();
  });

  it('reads only customer-visible message columns, oldest first', async () => {
    prismaMocks.ticketFindFirst.mockResolvedValue(ticketRow() as never);

    await getCustomerTicket({ workspaceSlug: workspace.slug, ticketId: 'ticket-1' });

    const args = prismaMocks.messageFindMany.mock.calls[0]?.[0];

    // `authorType`, not `createdById`: a customer reply has no workspace user
    // at all, so classifying it from a null `createdById` would have labelled
    // every customer message "System".
    expect(args?.select).toEqual({
      id: true,
      authorType: true,
      body: true,
      createdAt: true,
    });
    expect(args?.orderBy).toEqual([{ createdAt: 'asc' }, { id: 'asc' }]);
  });

  it('maps a conversation without member identity', async () => {
    prismaMocks.ticketFindFirst.mockResolvedValue(ticketRow() as never);
    prismaMocks.messageFindMany.mockResolvedValue([
      { id: 'm1', authorType: 'agent', body: 'On it.', createdAt },
      { id: 'm2', authorType: 'customer', body: 'Still broken.', createdAt },
      { id: 'm3', authorType: 'system', body: 'Auto-triaged.', createdAt },
    ] as never);

    const ticket = await getCustomerTicket({ workspaceSlug: workspace.slug, ticketId: 'ticket-1' });

    expect(ticket.conversation.map((entry) => entry.authorLabel)).toEqual([
      'Support team',
      'You',
      'System',
    ]);
    expect(JSON.stringify(ticket)).not.toContain('"m1"');
    expect(JSON.stringify(ticket)).not.toContain('authorType');
  });

  it('exposes no internal state in the detail payload', async () => {
    prismaMocks.ticketFindFirst.mockResolvedValue(ticketRow() as never);

    const ticket = await getCustomerTicket({ workspaceSlug: workspace.slug, ticketId: 'ticket-1' });

    for (const forbidden of [
      'workspaceId',
      'customerId',
      'createdById',
      'assignedToId',
      'updatedAt',
      'firstResponseAt',
      'responseSlaDeadline',
      'resolutionSlaDeadline',
    ]) {
      expect(JSON.stringify(ticket)).not.toContain(forbidden);
    }
  });
});

describe('createCustomerTicket', () => {
  beforeEach(() => {
    transactionTx = {
      ticket: { create: vi.fn().mockResolvedValue(ticketRow({ id: 'ticket-new' })) },
      ticketActivity: { create: vi.fn().mockResolvedValue({ id: 'activity-1' }) },
    };

    prismaMocks.transaction.mockImplementation((work: (tx: unknown) => Promise<unknown>) =>
      work(transactionTx),
    );
    mockedSlaPolicy.mockResolvedValue({
      priority: 'medium',
      responseMinutes: 480,
      resolutionMinutes: 4320,
    } as never);
  });

  afterEach(() => {
    transactionTx = undefined;
  });

  it('derives ownership from the session, not the body', async () => {
    await createCustomerTicket({
      workspaceSlug: workspace.slug,
      rawInput: { title: 'Printer is offline' },
    });

    expect(capturedTicketCreate().data).toMatchObject({
      workspaceId: workspace.id,
      customerId: customer.id,
    });
  });

  it('rejects a body that tries to set ownership or workflow state', async () => {
    await expect(
      createCustomerTicket({
        workspaceSlug: workspace.slug,
        rawInput: { title: 'Offline', customerId: otherCustomer.id },
      }),
    ).rejects.toThrow();

    expect(prismaMocks.transaction).not.toHaveBeenCalled();
  });

  it('leaves user actors null and starts open at medium priority', async () => {
    await createCustomerTicket({
      workspaceSlug: workspace.slug,
      rawInput: { title: 'Printer is offline' },
    });

    expect(capturedTicketCreate().data).toMatchObject({
      createdById: null,
      assignedToId: null,
      status: 'open',
      priority: 'medium',
    });
  });

  it('computes SLA deadlines from the workspace policy', async () => {
    mockedSlaPolicy.mockResolvedValue({
      priority: 'medium',
      responseMinutes: 30,
      resolutionMinutes: 120,
    } as never);

    const before = Date.now();
    await createCustomerTicket({ workspaceSlug: workspace.slug, rawInput: { title: 'Offline' } });
    const after = Date.now();

    const { responseSlaDeadline, resolutionSlaDeadline } = capturedTicketCreate().data as {
      responseSlaDeadline: Date;
      resolutionSlaDeadline: Date;
    };

    expect(mockedSlaPolicy).toHaveBeenCalledWith(expect.anything(), workspace.id, 'medium');

    // Offsets are measured from one `now` captured before the transaction, so
    // assert on the delta rather than on absolute instants.
    expect(responseSlaDeadline.getTime()).toBeGreaterThanOrEqual(before + 30 * 60_000);
    expect(responseSlaDeadline.getTime()).toBeLessThanOrEqual(after + 30 * 60_000);
    expect(resolutionSlaDeadline.getTime()).toBeGreaterThanOrEqual(before + 120 * 60_000);
    expect(resolutionSlaDeadline.getTime()).toBeLessThanOrEqual(after + 120 * 60_000);
  });

  it('records the creation activity with a null actor', async () => {
    await createCustomerTicket({ workspaceSlug: workspace.slug, rawInput: { title: 'Offline' } });

    const tx = capturedTx();

    expect(tx.ticketActivity.create).toHaveBeenCalledWith({
      data: { ticketId: 'ticket-new', actorId: null, type: 'TICKET_CREATED' },
    });
  });

  it('emits a TICKET_CREATED outbox event inside the transaction', async () => {
    await createCustomerTicket({ workspaceSlug: workspace.slug, rawInput: { title: 'Offline' } });

    expect(mockedCreateOutboxEvent).toHaveBeenCalledWith(
      {
        eventType: 'TICKET_CREATED',
        aggregateType: 'Ticket',
        aggregateId: 'ticket-new',
        payload: {
          workspaceId: workspace.id,
          ticketId: 'ticket-new',
          actorId: null,
          customerId: customer.id,
        },
      },
      capturedTx(),
    );
  });

  it('evaluates ticket.created automation with a null actor context', async () => {
    await createCustomerTicket({ workspaceSlug: workspace.slug, rawInput: { title: 'Offline' } });

    const [, triggerType, event] = mockedQueueAutomation.mock.calls[0] ?? [];

    expect(triggerType).toBe('ticket.created');
    expect(event).toMatchObject({ actorId: null, workspaceId: workspace.id, ticketId: 'ticket-new' });
    expect((event as { automationContext: { actorId: string | null } }).automationContext.actorId).toBeNull();
  });

  it('rolls back when the SLA policy is missing', async () => {
    mockedSlaPolicy.mockRejectedValue(new Error('SLA policy not found'));

    await expect(
      createCustomerTicket({ workspaceSlug: workspace.slug, rawInput: { title: 'Offline' } }),
    ).rejects.toThrow('SLA policy not found');

    // The insert must not happen at all: a ticket with no deadlines is worse
    // than no ticket.
    expect(capturedTicketCreate()).toBeUndefined();
  });

  it('returns a detail whose last activity is its creation time', async () => {
    const { ticket } = await createCustomerTicket({
      workspaceSlug: workspace.slug,
      rawInput: { title: 'Offline' },
    });

    expect(ticket.lastActivityAt).toBe(createdAt.toISOString());
    expect(ticket.conversation).toEqual([]);
    expect(ticket.availableActions).toEqual(['reply']);
  });

  it('never contacts the database for an unauthenticated caller', async () => {
    mockedRequireSession.mockRejectedValue(new CustomerUnauthenticatedError());

    await expect(
      createCustomerTicket({ workspaceSlug: workspace.slug, rawInput: { title: 'Offline' } }),
    ).rejects.toBeInstanceOf(CustomerUnauthenticatedError);

    expect(prismaMocks.transaction).not.toHaveBeenCalled();
  });
});

describe('createCustomerReply', () => {
  const replyCreatedAt = new Date('2026-02-01T09:00:00Z');

  function createdReply(overrides: Record<string, unknown> = {}) {
    return {
      id: 'message-1',
      authorType: 'customer',
      body: 'Still broken.',
      createdAt: replyCreatedAt,
      ...overrides,
    };
  }

  it('scopes the ticket read by id, workspace and customer in one query', async () => {
    prismaMocks.ticketFindFirst.mockResolvedValue(ticketRow() as never);
    prismaMocks.messageCreate.mockResolvedValue(createdReply() as never);

    await createCustomerReply({
      workspaceSlug: workspace.slug,
      ticketId: 'ticket-1',
      rawInput: { body: 'Still broken.' },
    });

    expect(prismaMocks.ticketFindFirst.mock.calls[0]?.[0]?.where).toEqual({
      id: 'ticket-1',
      workspaceId: workspace.id,
      customerId: customer.id,
    });
  });

  it('attributes the reply to the session customer and to no workspace user', async () => {
    prismaMocks.ticketFindFirst.mockResolvedValue(ticketRow() as never);
    prismaMocks.messageCreate.mockResolvedValue(createdReply() as never);

    await createCustomerReply({
      workspaceSlug: workspace.slug,
      ticketId: 'ticket-1',
      rawInput: { body: 'Still broken.' },
    });

    // The whole authorship guarantee in one object: customerId from the
    // session, createdById null, authorType explicit.
    expect(prismaMocks.messageCreate.mock.calls[0]?.[0]?.data).toMatchObject({
      ticketId: 'ticket-1',
      customerId: customer.id,
      createdById: null,
      authorType: 'customer',
      body: 'Still broken.',
    });
  });

  it('rejects a body that tries to claim authorship or move the ticket', async () => {
    prismaMocks.ticketFindFirst.mockResolvedValue(ticketRow() as never);

    await expect(
      createCustomerReply({
        workspaceSlug: workspace.slug,
        ticketId: 'ticket-1',
        rawInput: { body: 'hi', createdById: 'agent-1', authorType: 'agent' },
      }),
    ).rejects.toThrow();

    expect(prismaMocks.messageCreate).not.toHaveBeenCalled();
  });

  it('reports another customer ticket as not found and writes nothing', async () => {
    prismaMocks.ticketFindFirst.mockResolvedValue(null);

    await expect(
      createCustomerReply({
        workspaceSlug: workspace.slug,
        ticketId: 'ticket-1',
        rawInput: { body: 'Still broken.' },
      }),
    ).rejects.toBeInstanceOf(CustomerTicketNotFoundError);

    expect(prismaMocks.messageCreate).not.toHaveBeenCalled();
  });

  it('refuses a reply to a closed ticket', async () => {
    prismaMocks.ticketFindFirst.mockResolvedValue(ticketRow({ status: 'closed' }) as never);

    await expect(
      createCustomerReply({
        workspaceSlug: workspace.slug,
        ticketId: 'ticket-1',
        rawInput: { body: 'Still broken.' },
      }),
    ).rejects.toBeInstanceOf(CustomerTicketReplyNotAllowedError);

    expect(prismaMocks.messageCreate).not.toHaveBeenCalled();
  });

  it('never changes ticket status', async () => {
    prismaMocks.ticketFindFirst.mockResolvedValue(ticketRow() as never);
    prismaMocks.messageCreate.mockResolvedValue(createdReply() as never);

    await createCustomerReply({
      workspaceSlug: workspace.slug,
      ticketId: 'ticket-1',
      rawInput: { body: 'Still broken.' },
    });

    // A single insert. No ticket update means a customer cannot implicitly
    // reopen or re-triage their own ticket by replying.
    expect(prismaMocks.ticketFindFirst).toHaveBeenCalledTimes(1);
    expect(prismaMocks.transaction).not.toHaveBeenCalled();
  });

  it('returns a DTO, never a raw row with the message id', async () => {
    prismaMocks.ticketFindFirst.mockResolvedValue(ticketRow() as never);
    prismaMocks.messageCreate.mockResolvedValue(createdReply() as never);

    const { message } = await createCustomerReply({
      workspaceSlug: workspace.slug,
      ticketId: 'ticket-1',
      rawInput: { body: 'Still broken.' },
    });

    expect(message).not.toHaveProperty('id');
    expect(message.author).toBe('customer');
    expect(message.authorLabel).toBe('You');
    expect(JSON.stringify(message)).not.toContain('message-1');
  });

  it('never contacts the database for an unauthenticated caller', async () => {
    mockedRequireSession.mockRejectedValue(new CustomerUnauthenticatedError());

    await expect(
      createCustomerReply({
        workspaceSlug: workspace.slug,
        ticketId: 'ticket-1',
        rawInput: { body: 'Still broken.' },
      }),
    ).rejects.toBeInstanceOf(CustomerUnauthenticatedError);

    expect(prismaMocks.messageCreate).not.toHaveBeenCalled();
  });
});

/**
 * The transaction client the service was handed, captured so the create
 * assertions can read the writes that happened inside it.
 */
let transactionTx: unknown;

type CapturedTx = {
  ticket: { create: ReturnType<typeof vi.fn> };
  ticketActivity: { create: ReturnType<typeof vi.fn> };
};

function capturedTx(): CapturedTx {
  return transactionTx as CapturedTx;
}

function capturedTicketCreate(): { data: Record<string, unknown> } {
  return capturedTx().ticket.create.mock.calls[0]?.[0] as { data: Record<string, unknown> };
}
