import { describe, it, expect, vi, beforeEach } from 'vitest';
import { dispatchNextOutboxEvent } from '@/lib/queue/dispatcher';
import type { OutboxEventRecord } from '@/lib/outbox/types';

const fakeEvent: OutboxEventRecord = {
  id: 'outbox-1',
  eventType: 'TICKET_ASSIGNED',
  aggregateType: 'Ticket',
  aggregateId: 'ticket-1',
  payload: { workspaceId: 'workspace-1', ticketId: 'ticket-1', assigneeId: 'user-1' },
  createdAt: new Date('2026-09-08T00:00:00Z'),
  processedAt: null,
  completedAt: null,
  failedAt: null,
  attempts: 1,
  lastError: null,
};

vi.mock('@/lib/outbox/outbox', () => ({
  claimNextOutboxEvent: vi.fn(),
}));

vi.mock('@/lib/queue/producer', () => ({
  getQueue: vi.fn(),
}));

import { claimNextOutboxEvent } from '@/lib/outbox/outbox';
import { getQueue } from '@/lib/queue/producer';

const mockedClaimNextOutboxEvent = vi.mocked(claimNextOutboxEvent);
const mockedGetQueue = vi.mocked(getQueue);

describe('dispatchNextOutboxEvent', () => {
  beforeEach(() => {
    vi.resetAllMocks();
  });

  it('enqueues a claimed event and returns dispatched true with eventId', async () => {
    mockedClaimNextOutboxEvent.mockResolvedValue({
      claimed: true,
      event: fakeEvent,
    });
    mockedGetQueue.mockReturnValue({
      add: vi.fn().mockResolvedValue({ id: 'job-1' }),
    } as never);

    const result = await dispatchNextOutboxEvent();

    expect(result).toEqual({ dispatched: true, eventId: 'outbox-1' });
    expect(mockedClaimNextOutboxEvent).toHaveBeenCalledTimes(1);
    expect(mockedGetQueue).toHaveBeenCalledTimes(1);
  });

  it('returns dispatched false and does not enqueue when no event is claimed', async () => {
    mockedClaimNextOutboxEvent.mockResolvedValue({
      claimed: false,
      event: null,
    });
    mockedGetQueue.mockReturnValue({
      add: vi.fn().mockResolvedValue({ id: 'job-1' }),
    } as never);

    const result = await dispatchNextOutboxEvent();

    expect(result).toEqual({ dispatched: false });
    expect(mockedGetQueue).not.toHaveBeenCalled();
  });

  it('propagates claim errors to the caller', async () => {
    mockedClaimNextOutboxEvent.mockRejectedValue(new Error('database connection lost'));

    await expect(dispatchNextOutboxEvent()).rejects.toThrow('database connection lost');
    expect(mockedGetQueue).not.toHaveBeenCalled();
  });

  it('propagates enqueue errors to the caller', async () => {
    mockedClaimNextOutboxEvent.mockResolvedValue({
      claimed: true,
      event: fakeEvent,
    });
    mockedGetQueue.mockReturnValue({
      add: vi.fn().mockRejectedValue(new Error('redis connection lost')),
    } as never);

    await expect(dispatchNextOutboxEvent()).rejects.toThrow('redis connection lost');
  });
});
