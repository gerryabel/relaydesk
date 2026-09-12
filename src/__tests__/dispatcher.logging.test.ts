import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { OutboxEventType, OutboxAggregateType } from '@/lib/outbox/types';

/**
 * These tests verify that dispatchNextOutboxEvent emits structured logs for
 * the key dispatch outcomes: successful dispatch, no event available, and
 * enqueue failure.
 */

vi.mock('@/lib/queue/logger', () => ({
  info: vi.fn(),
  warn: vi.fn(),
  error: vi.fn(),
  debug: vi.fn(),
}));

vi.mock('@/lib/outbox/outbox', () => ({
  claimNextOutboxEvent: vi.fn(),
}));

vi.mock('@/lib/queue/producer', () => ({
  getQueue: vi.fn(),
}));

vi.mock('@/lib/db/prisma', () => ({
  prisma: {
    outboxEvent: {
      findFirst: vi.fn(),
      updateMany: vi.fn(),
    },
  },
}));

import { info, error as logError } from '@/lib/queue/logger';
import { dispatchNextOutboxEvent } from '@/lib/queue/dispatcher';
import { claimNextOutboxEvent } from '@/lib/outbox/outbox';
import { getQueue } from '@/lib/queue/producer';

const mockedInfo = vi.mocked(info);
const mockedError = vi.mocked(logError);
const mockedClaim = vi.mocked(claimNextOutboxEvent);
const mockedGetQueue = vi.mocked(getQueue);

const fakeEvent = {
  id: 'outbox-1',
  eventType: 'TICKET_ASSIGNED' as OutboxEventType,
  aggregateType: 'Ticket' as OutboxAggregateType,
  aggregateId: 'ticket-1',
  payload: { workspaceId: 'workspace-1', ticketId: 'ticket-1', assigneeId: 'user-1' },
  createdAt: new Date('2026-09-08T00:00:00Z'),
  processedAt: null,
  completedAt: null,
  failedAt: null,
  attempts: 1,
  lastError: null,
};

describe('dispatcher logging', () => {
  beforeEach(() => {
    vi.resetAllMocks();
  });

  it('logs a successful dispatch with outboxEventId, jobId, eventType, attempt', async () => {
    mockedClaim.mockResolvedValue({
      claimed: true,
      event: fakeEvent,
    });
    mockedGetQueue.mockReturnValue({
      add: vi.fn().mockResolvedValue({ id: 'job-99' }),
    } as never);

    const result = await dispatchNextOutboxEvent();

    expect(result).toEqual({ dispatched: true, eventId: 'outbox-1' });

    const dispatchCall = mockedInfo.mock.calls.find(
      ([msg]) => msg === 'Outbox event dispatched',
    );
    expect(dispatchCall).toBeDefined();
    expect(dispatchCall![1]).toMatchObject({
      outboxEventId: 'outbox-1',
      jobId: 'job-99',
      eventType: 'TICKET_ASSIGNED',
      attempt: 1,
    });
  });

  it('logs when no event is available', async () => {
    mockedClaim.mockResolvedValue({
      claimed: false,
      event: null,
    });

    const result = await dispatchNextOutboxEvent();

    expect(result).toEqual({ dispatched: false });

    const noEventCall = mockedInfo.mock.calls.find(
      ([msg]) => msg === 'No outbox event available for dispatch',
    );
    expect(noEventCall).toBeDefined();
  });

  it('logs enqueue failure with outboxEventId and eventType', async () => {
    mockedClaim.mockResolvedValue({
      claimed: true,
      event: fakeEvent,
    });
    mockedGetQueue.mockReturnValue({
      add: vi.fn().mockRejectedValue(new Error('redis connection lost')),
    } as never);

    await expect(dispatchNextOutboxEvent()).rejects.toThrow('redis connection lost');

    const failCall = mockedError.mock.calls.find(
      ([msg]) => msg === 'Failed to enqueue outbox event',
    );
    expect(failCall).toBeDefined();
    expect(failCall![1]).toMatchObject({
      outboxEventId: 'outbox-1',
      eventType: 'TICKET_ASSIGNED',
      attempt: 1,
    });
  });
});
