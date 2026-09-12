import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { createOutboxEvent } from '@/lib/outbox/outbox';
import type { Prisma } from '@/generated/prisma';

function createTransactionClient() {
  const outboxEventCreate = vi.fn().mockResolvedValue({ id: 'outbox-1' } as never);

  return {
    outboxEvent: {
      create: outboxEventCreate,
    },
  } as unknown as Prisma.TransactionClient;
}

describe('outbox service', () => {
  beforeEach(() => {
    vi.useFakeTimers().setSystemTime(new Date('2026-09-08T00:00:00Z'));
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('creates an outbox event with stable payload fields and pending defaults', async () => {
    const tx = createTransactionClient();

    await createOutboxEvent(
      {
        eventType: 'TICKET_ASSIGNED',
        aggregateType: 'Ticket',
        aggregateId: 'ticket-1',
        payload: {
          workspaceId: 'workspace-1',
          ticketId: 'ticket-1',
          actorId: 'actor-1',
          assigneeId: 'assignee-1',
          previousAssigneeId: null,
        },
      },
      tx,
    );

    expect(tx.outboxEvent.create).toHaveBeenCalledWith({
      data: {
        eventType: 'TICKET_ASSIGNED',
        aggregateType: 'Ticket',
        aggregateId: 'ticket-1',
        payload: {
          workspaceId: 'workspace-1',
          ticketId: 'ticket-1',
          actorId: 'actor-1',
          assigneeId: 'assignee-1',
          previousAssigneeId: null,
        },
      },
    });
  });
});
