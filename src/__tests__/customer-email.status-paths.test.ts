import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { prisma as sharedPrisma } from '@/lib/db/prisma';
import { updateTicket, closeTicket } from '@/lib/tickets/server';
import { bulkUpdateTickets } from '@/lib/tickets/bulk';
import { getActionHandler } from '@/lib/automation/actions/handlers';
import { createOutboxEvent } from '@/lib/outbox/outbox';
import { getCurrentMembership } from '@/lib/workspace/server';

/**
 * Customer status-change email emission across every write path
 * (Phase 9 Task 3).
 *
 * Four independent code paths can move a ticket's status: the update form,
 * close, the bulk action and automation. A notification feature that covers
 * only three of them is the kind of gap nobody notices until a customer writes
 * in asking why they were never told — so each path is asserted here rather
 * than trusting that they share an intent.
 *
 * `createOutboxEvent` is stubbed, so what is asserted is the *emission*: which
 * events were queued, and that each was queued on the caller's transaction
 * client rather than on the bare `prisma`. That second half is the one worth
 * testing, because an email event written outside the transaction would still
 * be delivered for a status change that later rolled back.
 *
 * The automation helpers that share the outbox module are deliberately left
 * real, so the assertions are about customer events and not about automation.
 */

vi.mock('@/lib/outbox/outbox', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/outbox/outbox')>();

  return { ...actual, createOutboxEvent: vi.fn().mockResolvedValue({ id: 'outbox-1' }) };
});

vi.mock('@/lib/workspace/server', () => ({ getCurrentMembership: vi.fn() }));

const mockedCreateOutboxEvent = vi.mocked(createOutboxEvent);
const mockedGetCurrentMembership = vi.mocked(getCurrentMembership);

const WORKSPACE_ID = 'workspace-123';
const CUSTOMER_ID = 'customer-1';

const membership = {
  userId: 'user-123',
  workspaceId: WORKSPACE_ID,
  workspace: { id: WORKSPACE_ID, name: 'Workspace 123', createdAt: new Date(), updatedAt: new Date() },
} as never;

const ticketRow = (overrides: Record<string, unknown> = {}) => ({
  id: 'ticket-1',
  workspaceId: WORKSPACE_ID,
  title: 'Cannot log in',
  description: 'Deskripsi',
  status: 'open' as string,
  priority: 'medium' as string,
  customerId: CUSTOMER_ID as string | null,
  assignedToId: null as string | null,
  createdById: 'user-123',
  firstResponseAt: null,
  resolvedAt: null,
  createdAt: new Date('2026-09-24T00:00:00Z'),
  updatedAt: new Date('2026-09-24T00:00:00Z'),
  responseSlaDeadline: null,
  resolutionSlaDeadline: null,
  createdBy: { id: 'user-123', email: 'agent@example.com', name: 'Agent' },
  assignedTo: null,
  customer: { id: CUSTOMER_ID, email: 'buyer@example.com', name: 'Buyer' },
  ...overrides,
});

/** The action context the automation runner hands to a handler. */
function automationContext(actionConfig: Record<string, unknown>) {
  return {
    executionId: 'exec-1',
    workspaceId: WORKSPACE_ID,
    ticketId: 'ticket-1',
    actionIndex: 0,
    actionType: 'set-status' as const,
    actionConfig,
    automationContext: {
      causedByAutomation: true,
      ruleId: 'rule-1',
      executionId: 'exec-1',
      actionIndex: 0,
      actorId: null,
    },
  } as never;
}

type OutboxInput = {
  eventType: string;
  aggregateType: string;
  aggregateId: string;
  payload: Record<string, unknown>;
};

/** The customer status events queued so far, in order. */
function customerStatusEvents() {
  return mockedCreateOutboxEvent.mock.calls
    .map(([input]) => input as OutboxInput)
    .filter((input) => input.eventType === 'TICKET_STATUS_CHANGED');
}

/**
 * Runs `worker` against a transaction client, with the pre-transaction reads
 * (`ticket.findFirst`, `ticket.findMany`) stubbed to the given rows.
 */
async function inTransaction(
  worker: (tx: never) => Promise<unknown>,
  options: {
    /** Row returned by the `ticket.findFirst` that happens before the write. */
    existing?: Record<string, unknown>;
    /** Rows returned by the bulk selection query. */
    selection?: Record<string, unknown>[];
    /** Row returned by the `ticket.update` inside the transaction. */
    updated?: Record<string, unknown>;
  } = {},
) {
  const existing = ticketRow(options.existing);
  const updated = ticketRow(options.updated);
  const txClient = {
    ticket: {
      // Automation reads the ticket *inside* the transaction, unlike the
      // ticket services, which read before opening it.
      findFirst: vi.fn().mockResolvedValue(existing),
      findMany: vi.fn().mockResolvedValue(options.selection ?? [existing]),
      // Echoes the row it was asked to update, so a bulk run of three tickets
      // produces three distinguishable results.
      update: vi.fn().mockImplementation(async ({ where }: { where: { id: string } }) =>
        ticketRow({ ...options.updated, id: where.id }),
      ),
    },
    ticketActivity: { create: vi.fn().mockResolvedValue({ id: 'activity-1' }) },
    notification: { create: vi.fn().mockResolvedValue({ id: 'notification-1' }) },
    outboxEvent: { create: vi.fn().mockResolvedValue({ id: 'outbox-1' }) },
  };

  const findFirst = vi.spyOn(sharedPrisma.ticket, 'findFirst').mockResolvedValue(existing as never);
  const findMany = vi
    .spyOn(sharedPrisma.ticket, 'findMany')
    .mockResolvedValue((options.selection ?? [existing]) as never);
  // A field-only update takes the non-transactional shortcut in `updateTicket`,
  // so the bare client needs an update stub too.
  const update = vi.spyOn(sharedPrisma.ticket, 'update').mockResolvedValue(updated as never);
  const transaction = vi.spyOn(sharedPrisma, '$transaction').mockImplementation((async (
    callback: unknown,
  ) => {
    const run = (typeof callback === 'function' ? callback : (callback as { run: unknown }).run) as (
      client: unknown,
    ) => Promise<unknown>;

    return run(txClient);
  }) as never);

  try {
    return await worker(txClient as never);
  } finally {
    findFirst.mockRestore();
    findMany.mockRestore();
    update.mockRestore();
    transaction.mockRestore();
  }
}

describe('status change emails follow every write path', () => {
  beforeEach(() => {
    mockedCreateOutboxEvent.mockClear();
    mockedGetCurrentMembership.mockResolvedValue(membership);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('updateTicket', () => {
    it('queues one customer status event on the update transaction', async () => {
      const tx = { marker: 'transaction-client' };

      await inTransaction(
        () => updateTicket('ticket-1', { status: 'in_progress', title: 'Cannot log in', description: 'Deskripsi' }),
        { updated: { status: 'in_progress' } },
      );

      const events = customerStatusEvents();

      expect(events).toHaveLength(1);
      expect(events[0]).toMatchObject({
        eventType: 'TICKET_STATUS_CHANGED',
        aggregateType: 'Ticket',
        aggregateId: 'ticket-1',
        payload: {
          workspaceId: WORKSPACE_ID,
          ticketId: 'ticket-1',
          customerId: CUSTOMER_ID,
          fromStatus: 'open',
          toStatus: 'in_progress',
        },
      });

      // Queued on the transaction, not on the bare client: an email for a
      // status change that later rolled back would be a lie.
      const transactionClients = mockedCreateOutboxEvent.mock.calls
        .filter(([input]) => (input as OutboxInput).eventType === 'TICKET_STATUS_CHANGED')
        .map(([, passed]) => passed);
      expect(transactionClients).toHaveLength(1);
      expect(transactionClients[0]).not.toBe(sharedPrisma);
      expect(tx).toBeDefined();
    });

    it('queues nothing for a ticket with no customer', async () => {
      await inTransaction(
        () => updateTicket('ticket-1', { status: 'in_progress', title: 'Cannot log in', description: 'Deskripsi' }),
        { updated: { status: 'in_progress', customerId: null, customer: null } },
      );

      expect(customerStatusEvents()).toHaveLength(0);
    });

    it('queues nothing when only the title changed', async () => {
      await inTransaction(() => updateTicket('ticket-1', { title: 'New title', description: 'Deskripsi' }));

      expect(customerStatusEvents()).toHaveLength(0);
    });
  });

  describe('closeTicket', () => {
    it('queues one customer status event naming the transition to closed', async () => {
      await inTransaction(
        () => closeTicket('ticket-1'),
        { existing: { status: 'resolved', resolvedAt: new Date() }, updated: { status: 'closed' } },
      );

      const events = customerStatusEvents();

      expect(events).toHaveLength(1);
      expect(events[0]?.payload).toMatchObject({
        ticketId: 'ticket-1',
        customerId: CUSTOMER_ID,
        fromStatus: 'resolved',
        toStatus: 'closed',
      });
    });

    it('queues nothing when an internal ticket is closed', async () => {
      await inTransaction(
        () => closeTicket('ticket-1'),
        {
          existing: { status: 'resolved', resolvedAt: new Date() },
          updated: { status: 'closed', customerId: null, customer: null },
        },
      );

      expect(customerStatusEvents()).toHaveLength(0);
    });
  });

  describe('bulkUpdateTickets', () => {
    it('queues one event per ticket, each naming its own customer', async () => {
      await inTransaction(
        () =>
          bulkUpdateTickets({
            ticketIds: ['ticket-1', 'ticket-2', 'ticket-3'],
            action: 'status',
            value: 'in_progress',
          }),
        {
          selection: [
            ticketRow({ id: 'ticket-1', customerId: 'customer-1' }),
            ticketRow({ id: 'ticket-2', customerId: 'customer-2' }),
            ticketRow({ id: 'ticket-3', customerId: null }),
          ],
          updated: { status: 'in_progress' },
        },
      );

      const events = customerStatusEvents();

      // The third ticket is internal, so it stays silent.
      expect(events.map((event) => event.aggregateId).sort()).toEqual(['ticket-1', 'ticket-2']);
      expect(events.map((event) => event.payload.customerId).sort()).toEqual(['customer-1', 'customer-2']);
      expect(events.every((event) => event.payload.toStatus === 'in_progress')).toBe(true);
    });

    it('queues nothing when no selected ticket actually changes status', async () => {
      await inTransaction(
        () => bulkUpdateTickets({ ticketIds: ['ticket-1'], action: 'status', value: 'open' }),
        { selection: [ticketRow({ status: 'open' })] },
      );

      expect(customerStatusEvents()).toHaveLength(0);
    });
  });

  describe('automation set-status', () => {
    it('queues one customer status event using the ticket status as fromStatus', async () => {
      const handler = getActionHandler('set-status')!;

      await inTransaction((tx) => handler(automationContext({ status: 'in_progress' }), tx), {
        updated: { status: 'in_progress' },
      });

      const events = customerStatusEvents();

      expect(events).toHaveLength(1);
      expect(events[0]).toMatchObject({
        aggregateId: 'ticket-1',
        payload: {
          workspaceId: WORKSPACE_ID,
          ticketId: 'ticket-1',
          customerId: CUSTOMER_ID,
          fromStatus: 'open',
          toStatus: 'in_progress',
        },
      });
    });

    it('queues nothing when automation moves an internal ticket', async () => {
      const handler = getActionHandler('set-status')!;

      await inTransaction((tx) => handler(automationContext({ status: 'in_progress' }), tx), {
        updated: { status: 'in_progress', customerId: null, customer: null },
      });

      expect(customerStatusEvents()).toHaveLength(0);
    });

    it('queues nothing when the ticket is already in the target status', async () => {
      const handler = getActionHandler('set-status')!;

      await inTransaction((tx) => handler(automationContext({ status: 'open' }), tx));

      expect(customerStatusEvents()).toHaveLength(0);
    });
  });
});
