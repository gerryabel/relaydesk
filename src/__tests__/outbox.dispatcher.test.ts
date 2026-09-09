import { describe, it, expect, vi, beforeEach } from 'vitest';
import { claimNextOutboxEvent, markOutboxEventProcessed, markOutboxEventFailed } from '@/lib/outbox/outbox';
import { enqueueOutboxJob } from '@/lib/queue/dispatcher';
import type { Prisma } from '@/generated/prisma';

const baseEvent = {
  id: 'outbox-1',
  eventType: 'TICKET_ASSIGNED',
  aggregateType: 'Ticket',
  aggregateId: 'ticket-1',
  payload: { workspaceId: 'workspace-1' },
  createdAt: new Date('2026-09-08T00:00:00Z'),
  processedAt: null,
  attempts: 0,
  lastError: null,
};

describe('outbox dispatcher', () => {
  beforeEach(() => {
    vi.resetModules();
  });

  it('claims a pending outbox event and enqueues a BullMQ job', async () => {
    const tx = {
      outboxEvent: {
        findFirst: vi.fn().mockResolvedValue(baseEvent),
        updateMany: vi.fn().mockResolvedValue({ count: 1 }),
      },
    } as unknown as Prisma.TransactionClient;

    const claimed = await claimNextOutboxEvent(tx);
    expect(claimed.event).not.toBeNull();
    expect(claimed.event?.id).toBe('outbox-1');
    expect(tx.outboxEvent.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 'outbox-1', processedAt: null },
        data: expect.objectContaining({
          processedAt: expect.any(Date),
          attempts: { increment: 1 },
        }),
      }),
    );

    const queue = { add: vi.fn().mockResolvedValue({ id: 'job-1' }) };
    const job = await enqueueOutboxJob(claimed.event!, queue);

    expect(queue.add).toHaveBeenCalledWith(
      'outbox-event',
      expect.objectContaining({ outboxEventId: 'outbox-1', eventType: 'TICKET_ASSIGNED' }),
      expect.objectContaining({ attempts: 3 }),
    );
    expect(job.id).toBe('job-1');
  });

  it('returns null when no pending outbox event exists', async () => {
    const tx = {
      outboxEvent: {
        findFirst: vi.fn().mockResolvedValue(null),
      },
    } as unknown as Prisma.TransactionClient;

    const claimed = await claimNextOutboxEvent(tx);

    expect(claimed.event).toBeNull();
    expect(claimed.claimed).toBe(false);
  });

  it('returns null when conditional claim finds no row', async () => {
    const tx = {
      outboxEvent: {
        findFirst: vi.fn().mockResolvedValue(baseEvent),
        updateMany: vi.fn().mockResolvedValue({ count: 0 }),
      },
    } as unknown as Prisma.TransactionClient;

    const claimed = await claimNextOutboxEvent(tx);

    expect(claimed.event).toBeNull();
    expect(claimed.claimed).toBe(false);
    expect(tx.outboxEvent.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 'outbox-1', processedAt: null },
      }),
    );
  });

  it('re-claims an event with an expired lease', async () => {
    const expiredAt = new Date(Date.now() - 1000);
    const tx = {
      outboxEvent: {
        findFirst: vi.fn().mockResolvedValue({ ...baseEvent, processedAt: expiredAt }),
        updateMany: vi.fn().mockResolvedValue({ count: 1 }),
      },
    } as unknown as Prisma.TransactionClient;

    const claimed = await claimNextOutboxEvent(tx);

    expect(claimed.event).not.toBeNull();
    expect(tx.outboxEvent.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 'outbox-1', processedAt: { lt: expect.any(Date) } },
        data: expect.objectContaining({ attempts: { increment: 1 } }),
      }),
    );
  });

  it('does not mark the event processed when BullMQ enqueue fails', async () => {
    const queue = { add: vi.fn().mockRejectedValue(new Error('redis down')) };

    await expect(enqueueOutboxJob(baseEvent, queue)).rejects.toThrow('redis down');
    expect(queue.add).toHaveBeenCalledTimes(1);
  });
});

describe('outbox completion helpers', () => {
  it('marks an outbox event processed', async () => {
    const tx = {
      outboxEvent: {
        updateMany: vi.fn().mockResolvedValue({ count: 1 }),
      },
    } as unknown as Prisma.TransactionClient;

    await markOutboxEventProcessed(tx, 'outbox-1');

    expect(tx.outboxEvent.updateMany).toHaveBeenCalledWith({
      where: { id: 'outbox-1' },
      data: { processedAt: expect.any(Date), lastError: null },
    });
  });

  it('marks an outbox event failed without resetting attempts', async () => {
    const tx = {
      outboxEvent: {
        updateMany: vi.fn().mockResolvedValue({ count: 1 }),
      },
    } as unknown as Prisma.TransactionClient;

    await markOutboxEventFailed(tx, 'outbox-1', new Error('handler boom'));

    expect(tx.outboxEvent.updateMany).toHaveBeenCalledWith({
      where: { id: 'outbox-1' },
      data: {
        processedAt: null,
        attempts: { increment: 1 },
        lastError: 'handler boom',
      },
    });
  });
});
