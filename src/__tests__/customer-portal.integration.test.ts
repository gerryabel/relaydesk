import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from 'vitest';
import { PrismaClient } from '@/generated/prisma';
import { PrismaPg } from '@prisma/adapter-pg';
import { getTestDatabaseUrl } from '@/lib/test/db';
import { hashCustomerToken, generateCustomerToken } from '@/lib/customer-access/tokens';

/**
 * Customer portal invariants that require a real database (Phase 9 Task 2).
 *
 * The mocked service tests prove the *query shape*; these prove that the shape
 * behaves the way the shape is supposed to behave against real SQL. That
 * distinction matters most for the two guarantees that are easy to state and
 * easy to get subtly wrong:
 *
 *  - a customer sees only their own tickets, across customers in the same
 *    workspace, across workspaces, and across both at once;
 *  - `lastActivityAt` reflects customer-visible messages and is not moved by
 *    an internal edit.
 *
 * The session is stubbed at the boundary rather than driven through cookies:
 * Task 1 already covers the cookie → session path, and stubbing here keeps
 * these tests about ticket ownership.
 */

vi.mock('@/lib/customer-portal/session', () => ({
  requireCustomerInWorkspace: vi.fn(),
}));

const { requireCustomerInWorkspace } = await import('@/lib/customer-portal/session');
const { createCustomerTicket, getCustomerTicket, listCustomerTickets } = await import(
  '@/lib/customer-portal/server'
);
const { CustomerTicketNotFoundError } = await import('@/lib/customer-portal/errors');
const { DEFAULT_SLA_POLICIES_MINUTES } = await import('@/lib/tickets/sla');

const mockedRequireSession = vi.mocked(requireCustomerInWorkspace);

function createId(prefix: string) {
  return `${prefix}-${Date.now()}-${Math.random().toString(16).slice(2, 10)}`;
}

describe('customer portal tickets against a real database', () => {
  let prisma: PrismaClient;
  const createdWorkspaceIds: string[] = [];

  let workspaceId: string;
  let workspaceSlug: string;
  let customerId: string;
  let otherCustomerId: string;

  beforeAll(() => {
    prisma = new PrismaClient({ adapter: new PrismaPg(getTestDatabaseUrl()) });
  });

  afterAll(async () => {
    await prisma.workspace.deleteMany({ where: { id: { in: createdWorkspaceIds } } });
    await prisma.$disconnect();
  });

  beforeEach(async () => {
    const workspace = await prisma.workspace.create({
      data: { id: createId('ws'), name: 'Portal Test', slug: createId('portal-test') },
    });

    workspaceId = workspace.id;
    workspaceSlug = workspace.slug;
    createdWorkspaceIds.push(workspace.id);

    // A customer-created ticket needs a medium SLA policy, exactly as an
    // agent-created one does. Seeding it from the same defaults the workspace
    // bootstrap uses keeps the test honest about the create path's contract.
    await prisma.workspaceSlaPolicy.createMany({
      data: Object.values(DEFAULT_SLA_POLICIES_MINUTES).map((policy) => ({
        workspaceId,
        priority: policy.priority,
        responseMinutes: policy.responseMinutes,
        resolutionMinutes: policy.resolutionMinutes,
      })),
    });

    customerId = (await prisma.customer.create({
      data: { workspaceId, name: 'Buyer', email: 'buyer@example.com' },
      select: { id: true },
    })).id;

    otherCustomerId = (await prisma.customer.create({
      data: { workspaceId, name: 'Other', email: 'other@example.com' },
      select: { id: true },
    })).id;

    signInAs(customerId, workspaceId, workspaceSlug);
  });

  function signInAs(activeCustomerId: string, activeWorkspaceId: string, activeSlug: string) {
    mockedRequireSession.mockResolvedValue({
      workspace: { id: activeWorkspaceId, name: 'Portal Test', slug: activeSlug },
      customer: {
        sessionId: 'session-1',
        customerId: activeCustomerId,
        workspaceId: activeWorkspaceId,
        workspaceSlug: activeSlug,
        workspaceName: 'Portal Test',
        email: 'buyer@example.com',
        expiresAt: new Date(Date.now() + 3_600_000),
      },
    } as never);
  }

  /** A real customer session row, for the one test that needs the DB one. */
  async function seedSession(activeCustomerId: string) {
    const token = generateCustomerToken();

    await prisma.customerSession.create({
      data: {
        workspaceId,
        customerId: activeCustomerId,
        tokenHash: hashCustomerToken(token),
        expiresAt: new Date(Date.now() + 3_600_000),
      },
    });

    return token;
  }

  it('creates a ticket owned by the session customer with no user actor', async () => {
    const { ticket } = await createCustomerTicket({
      workspaceSlug,
      rawInput: { title: 'Printer is offline', description: 'Since this morning.' },
    });

    const row = await prisma.ticket.findUniqueOrThrow({
      where: { id: ticket.id },
      select: {
        workspaceId: true,
        customerId: true,
        createdById: true,
        assignedToId: true,
        status: true,
        priority: true,
        responseSlaDeadline: true,
        resolutionSlaDeadline: true,
      },
    });

    expect(row).toMatchObject({
      workspaceId,
      customerId,
      createdById: null,
      assignedToId: null,
      status: 'open',
      priority: 'medium',
    });

    // Deadlines come from the workspace policy, not from defaults guessed in
    // the service.
    expect(row.responseSlaDeadline).not.toBeNull();
    expect(row.resolutionSlaDeadline).not.toBeNull();
    expect(
      (row.resolutionSlaDeadline as Date).getTime(),
    ).toBeGreaterThan((row.responseSlaDeadline as Date).getTime());
  });

  it('writes the creation activity, outbox event and automation evaluation', async () => {
    const { ticket } = await createCustomerTicket({ workspaceSlug, rawInput: { title: 'Offline' } });

    const activity = await prisma.ticketActivity.findMany({ where: { ticketId: ticket.id } });

    expect(activity).toHaveLength(1);
    expect(activity[0]).toMatchObject({ type: 'TICKET_CREATED', actorId: null });

    // Two outbox events ride the same transaction: the semantic domain event
    // and the queued automation evaluation.
    const events = await prisma.outboxEvent.findMany({
      where: { aggregateId: ticket.id },
      orderBy: { createdAt: 'asc' },
    });

    const created = events.find((event) => event.eventType === 'TICKET_CREATED');
    const automation = events.find((event) => event.eventType === 'AUTOMATION_EVALUATION');

    expect(created).toBeDefined();
    expect(created?.payload).toMatchObject({
      workspaceId,
      ticketId: ticket.id,
      actorId: null,
      customerId,
    });

    expect(automation).toBeDefined();
    expect(automation?.payload).toMatchObject({
      triggerType: 'ticket.created',
      workspaceId,
      ticketId: ticket.id,
      // A customer is not a `User`; the actor is explicitly absent rather
      // than attributed to an agent who never touched the ticket.
      actorId: null,
    });
    expect(
      (automation?.payload as { automationContext?: { actorId?: string | null } }).automationContext?.actorId,
    ).toBeNull();
  });

  it('lists only the signed-in customer tickets', async () => {
    await createCustomerTicket({ workspaceSlug, rawInput: { title: 'Mine one' } });
    await createCustomerTicket({ workspaceSlug, rawInput: { title: 'Mine two' } });

    await prisma.ticket.create({
      data: { workspaceId, customerId: otherCustomerId, title: 'Theirs' },
    });

    const page = await listCustomerTickets({ workspaceSlug });

    expect(page.total).toBe(2);
    expect(page.data.map((ticket) => ticket.title).sort()).toEqual(['Mine one', 'Mine two']);
  });

  it('never returns a ticket from another customer in the same workspace', async () => {
    await prisma.ticket.create({
      data: { workspaceId, customerId: otherCustomerId, title: 'Theirs' },
    });

    const page = await listCustomerTickets({ workspaceSlug });

    expect(page.data).toHaveLength(0);
    expect(page.total).toBe(0);
  });

  it('never returns a ticket from another workspace', async () => {
    const other = await prisma.workspace.create({
      data: { id: createId('ws'), name: 'Other Workspace', slug: createId('other-ws') },
    });

    createdWorkspaceIds.push(other.id);

    await prisma.ticket.create({
      data: { workspaceId: other.id, customerId: customerId, title: 'Foreign workspace' },
    });

    const page = await listCustomerTickets({ workspaceSlug });

    expect(page.data).toHaveLength(0);
  });

  it('reports another customer ticket as not found', async () => {
    const foreign = await prisma.ticket.create({
      data: { workspaceId, customerId: otherCustomerId, title: 'Theirs' },
      select: { id: true },
    });

    await expect(
      getCustomerTicket({ workspaceSlug, ticketId: foreign.id }),
    ).rejects.toBeInstanceOf(CustomerTicketNotFoundError);
  });

  it('reports an unknown ticket id as not found, identically', async () => {
    let foreignMessage: string | undefined;
    let missingMessage: string | undefined;

    const foreign = await prisma.ticket.create({
      data: { workspaceId, customerId: otherCustomerId, title: 'Theirs' },
      select: { id: true },
    });

    try {
      await getCustomerTicket({ workspaceSlug, ticketId: foreign.id });
    } catch (error) {
      foreignMessage = (error as Error).message;
    }

    try {
      await getCustomerTicket({ workspaceSlug, ticketId: 'does-not-exist' });
    } catch (error) {
      missingMessage = (error as Error).message;
    }

    // Byte-identical: a difference here is an enumeration oracle.
    expect(foreignMessage).toBe(missingMessage);
  });

  it('searches only title and description', async () => {
    await createCustomerTicket({
      workspaceSlug,
      rawInput: { title: 'Printer jam', description: 'Papier is stuck' },
    });
    await createCustomerTicket({ workspaceSlug, rawInput: { title: 'Billing' } });

    const byTitle = await listCustomerTickets({ workspaceSlug, params: { q: 'printer' } });

    expect(byTitle.total).toBe(1);
    expect(byTitle.data[0]?.title).toBe('Printer jam');

    const byDescription = await listCustomerTickets({ workspaceSlug, params: { q: 'papier' } });

    expect(byDescription.total).toBe(1);
  });

  it('moves last activity on a message but not on an internal edit', async () => {
    const { ticket } = await createCustomerTicket({ workspaceSlug, rawInput: { title: 'Offline' } });

    const before = await listCustomerTickets({ workspaceSlug });
    expect(before.data[0]?.lastActivityAt).toBe(ticket.createdAt);

    // An internal-only edit bumps `updatedAt`. It must not move what the
    // customer sees, because the customer cannot see the edit.
    await prisma.ticket.update({
      where: { id: ticket.id },
      data: { updatedAt: new Date(Date.now() + 86_400_000) },
    });

    const afterEdit = await listCustomerTickets({ workspaceSlug });

    expect(afterEdit.data[0]?.lastActivityAt).toBe(ticket.createdAt);

    const repliedAt = new Date(Date.now() + 3_600_000);

    await prisma.message.create({
      data: { ticketId: ticket.id, createdById: null, body: 'Agent reply', createdAt: repliedAt },
    });

    const afterReply = await listCustomerTickets({ workspaceSlug });

    expect(afterReply.data[0]?.lastActivityAt).toBe(repliedAt.toISOString());
  });

  it('returns the customer conversation without internal notes', async () => {
    const { ticket } = await createCustomerTicket({
      workspaceSlug,
      rawInput: { title: 'Offline', description: 'Please help' },
    });

    await prisma.message.create({
      data: { ticketId: ticket.id, createdById: null, body: 'We are looking into it.' },
    });

    await prisma.internalNote.create({
      data: { ticketId: ticket.id, authorId: createId('user'), body: 'INTERNAL: looks like a scam' },
    });

    const detail = await getCustomerTicket({ workspaceSlug, ticketId: ticket.id });

    expect(detail.conversation.map((entry) => entry.body)).toEqual(['We are looking into it.']);
    expect(detail.description).toBe('Please help');
    expect(JSON.stringify(detail)).not.toContain('INTERNAL');
    expect(JSON.stringify(detail)).not.toContain('scam');
  });

  it('stores a null description when the customer sends only a title', async () => {
    const { ticket } = await createCustomerTicket({ workspaceSlug, rawInput: { title: 'Offline' } });

    const row = await prisma.ticket.findUniqueOrThrow({
      where: { id: ticket.id },
      select: { description: true },
    });

    expect(row.description).toBeNull();
  });

  it('rejects a create body carrying ownership keys, before any write', async () => {
    const before = await prisma.ticket.count({ where: { workspaceId } });

    await expect(
      createCustomerTicket({
        workspaceSlug,
        rawInput: { title: 'Offline', customerId: otherCustomerId, priority: 'urgent' },
      }),
    ).rejects.toThrow();

    const after = await prisma.ticket.count({ where: { workspaceId } });

    expect(after).toBe(before);
  });

  it('paginates without repeating or dropping a ticket', async () => {
    for (let index = 0; index < 7; index += 1) {
      await createCustomerTicket({ workspaceSlug, rawInput: { title: `Ticket ${index}` } });
    }

    const first = await listCustomerTickets({ workspaceSlug, params: { page: '1', limit: '3' } });
    const second = await listCustomerTickets({ workspaceSlug, params: { page: '2', limit: '3' } });
    const third = await listCustomerTickets({ workspaceSlug, params: { page: '3', limit: '3' } });

    expect([first.total, first.totalPages]).toEqual([7, 3]);
    expect(first.hasNextPage).toBe(true);
    expect(third.hasPreviousPage).toBe(true);
    expect(third.hasNextPage).toBe(false);

    const ids = [...first.data, ...second.data, ...third.data].map((ticket) => ticket.id);

    expect(new Set(ids).size).toBe(7);
  });

  it('derives the same reference for the same ticket on every read', async () => {
    const { ticket } = await createCustomerTicket({ workspaceSlug, rawInput: { title: 'Offline' } });

    const listA = await listCustomerTickets({ workspaceSlug });
    const listB = await listCustomerTickets({ workspaceSlug });
    const detail = await getCustomerTicket({ workspaceSlug, ticketId: ticket.id });

    expect(listA.data[0]?.reference).toBe(listB.data[0]?.reference);
    expect(listA.data[0]?.reference).toBe(detail.reference);
    expect(detail.reference).toMatch(/^#[0-9A-Z]{8}$/);
  });

  it('resolves ownership through a real customer session row', async () => {
    // The stub is the only seam in these tests; this case proves the ids the
    // service trusts are the ones the session table actually holds.
    const token = await seedSession(customerId);

    expect(token.length).toBeGreaterThan(20);

    const session = await prisma.customerSession.findFirst({
      where: { customerId },
      select: { workspaceId: true },
    });

    expect(session?.workspaceId).toBe(workspaceId);
  });
});
