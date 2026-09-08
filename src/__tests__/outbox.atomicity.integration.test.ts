import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { PrismaClient } from '@/generated/prisma';
import { PrismaPg } from '@prisma/adapter-pg';
import { getTestDatabaseUrl } from '@/lib/test/db';

function createPrismaClient() {
  const connectionString = getTestDatabaseUrl();
  const adapter = new PrismaPg(connectionString);
  return new PrismaClient({ adapter });
}

function createId(prefix: string) {
  return `${prefix}-${Date.now()}-${Math.random().toString(16).slice(2, 10)}`;
}

describe('outbox transactional atomicity', () => {
  let prisma: PrismaClient;
  let actorId: string;
  let assigneeId: string;

  beforeAll(async () => {
    prisma = createPrismaClient();
    const [actor, assignee] = await Promise.all([
      prisma.user.create({
        data: { id: createId('actor'), email: `atomic-actor-${Date.now()}@example.com`, name: 'Atomic Actor' },
      }),
      prisma.user.create({
        data: { id: createId('assignee'), email: `atomic-assignee-${Date.now()}@example.com`, name: 'Atomic Assignee' },
      }),
    ]);
    actorId = actor.id;
    assigneeId = assignee.id;
  });

  afterAll(async () => {
    await prisma.$disconnect();
  });

  it('commits domain mutation and outbox event together', async () => {
    const workspace = await prisma.workspace.create({
      data: { id: createId('workspace'), name: `Atomic Workspace ${Date.now()}` },
    });

    await prisma.$transaction(async (tx) => {
      const ticket = await tx.ticket.create({
        data: {
          workspaceId: workspace.id,
          title: 'Atomic Ticket',
          createdById: actorId,
          status: 'open',
          priority: 'medium',
        },
        include: { createdBy: true },
      });

      await tx.ticketActivity.create({
        data: {
          ticketId: ticket.id,
          actorId: actorId,
          type: 'TICKET_CREATED',
        },
      });

      await tx.outboxEvent.create({
        data: {
          eventType: 'TICKET_ASSIGNED',
          aggregateType: 'Ticket',
          aggregateId: ticket.id,
          payload: {
            workspaceId: workspace.id,
            ticketId: ticket.id,
            actorId: actorId,
            assigneeId: assigneeId,
            previousAssigneeId: null,
          },
        },
      });
    });

    const ticket = await prisma.ticket.findFirst({ where: { workspaceId: workspace.id, title: 'Atomic Ticket' } });
    expect(ticket).not.toBeNull();

    const activity = await prisma.ticketActivity.findFirst({ where: { ticketId: ticket!.id, type: 'TICKET_CREATED' } });
    expect(activity).not.toBeNull();

    const outboxEvent = await prisma.outboxEvent.findFirst({ where: { aggregateType: 'Ticket', aggregateId: ticket!.id } });
    expect(outboxEvent).not.toBeNull();
    expect(outboxEvent!.eventType).toBe('TICKET_ASSIGNED');
    expect(outboxEvent!.processedAt).toBeNull();
    expect(outboxEvent!.attempts).toBe(0);
  });

  it('rolls back domain mutation and outbox event together', async () => {
    const workspace = await prisma.workspace.create({
      data: { id: createId('workspace'), name: `Rollback Workspace ${Date.now()}` },
    });

    await expect(
      prisma.$transaction(async (tx) => {
        const ticket = await tx.ticket.create({
          data: {
            workspaceId: workspace.id,
            title: 'Rollback Ticket',
            createdById: actorId,
            status: 'open',
            priority: 'medium',
          },
          include: { createdBy: true },
        });

        await tx.ticketActivity.create({
          data: {
            ticketId: ticket.id,
            actorId: actorId,
            type: 'TICKET_CREATED',
          },
        });

        await tx.outboxEvent.create({
          data: {
            eventType: 'TICKET_ASSIGNED',
            aggregateType: 'Ticket',
            aggregateId: ticket.id,
            payload: {
              workspaceId: workspace.id,
              ticketId: ticket.id,
              actorId: actorId,
              assigneeId: assigneeId,
              previousAssigneeId: null,
            },
          },
        });

        throw new Error('force rollback');
      }),
    ).rejects.toThrow('force rollback');

    const ticket = await prisma.ticket.findFirst({ where: { workspaceId: workspace.id, title: 'Rollback Ticket' } });
    expect(ticket).toBeNull();
  });
});
