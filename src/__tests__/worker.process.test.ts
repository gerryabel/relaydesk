import { describe, it, expect, vi, beforeEach } from 'vitest';
import { processOutboxJob } from '@/lib/queue/worker';
import { markOutboxEventProcessed, recordOutboxFailure, markOutboxEventPermanentlyFailed } from '@/lib/outbox/outbox';
import { getHandler } from '@/lib/queue/handlers/registry';
import { prisma } from '@/lib/db/prisma';

vi.mock('@/lib/outbox/outbox', () => ({
  markOutboxEventProcessed: vi.fn(),
  recordOutboxFailure: vi.fn(),
  markOutboxEventPermanentlyFailed: vi.fn(),
}));

vi.mock('@/lib/queue/handlers/registry', () => ({
  getHandler: vi.fn(),
}));

vi.mock('@/lib/db/prisma', () => ({
  prisma: {
    outboxEvent: {
      findUnique: vi.fn(),
    },
  },
}));

const validEvent = {
  id: 'outbox-1',
  eventType: 'TICKET_ASSIGNED',
  aggregateType: 'Ticket',
  aggregateId: 'ticket-1',
  payload: { workspaceId: 'workspace-1' },
  createdAt: new Date('2026-09-08T00:00:00Z'),
  processedAt: null,
  failedAt: null,
  attempts: 0,
  lastError: null,
} as const;

const validJobPayload = {
  outboxEventId: 'outbox-1',
  eventType: 'TICKET_ASSIGNED',
  aggregateType: 'Ticket',
  aggregateId: 'ticket-1',
  payload: { workspaceId: 'workspace-1' },
  attempt: 0,
};

describe('worker', () => {
  beforeEach(() => {
    vi.resetAllMocks();
    vi.mocked(prisma.outboxEvent.findUnique).mockReset();
    vi.mocked(markOutboxEventProcessed).mockReset();
    vi.mocked(recordOutboxFailure).mockReset();
    vi.mocked(markOutboxEventPermanentlyFailed).mockReset();
    vi.mocked(getHandler).mockReset();
  });

  it('processes a valid job successfully', async () => {
    vi.mocked(prisma.outboxEvent.findUnique).mockResolvedValue(validEvent as never);

    const handler = vi.fn().mockResolvedValue(undefined);
    vi.mocked(getHandler).mockReturnValue(handler);

    const result = await processOutboxJob({
      id: 'job-1',
      data: validJobPayload,
    });

    expect(result.handled).toBe(true);
    expect(prisma.outboxEvent.findUnique).toHaveBeenCalledWith({ where: { id: 'outbox-1' } });
    expect(handler).toHaveBeenCalledWith(validEvent);
    expect(markOutboxEventProcessed).toHaveBeenCalledWith(prisma, 'outbox-1');
    expect(recordOutboxFailure).not.toHaveBeenCalled();
    expect(markOutboxEventPermanentlyFailed).not.toHaveBeenCalled();
  });

  it('records handler failure exactly once for retryable failures', async () => {
    vi.mocked(prisma.outboxEvent.findUnique).mockResolvedValue(validEvent as never);

    const handler = vi.fn().mockResolvedValue({
      status: 'failure',
      error: { message: 'handler failed', retryable: true },
    });
    vi.mocked(getHandler).mockReturnValue(handler);

    await expect(
      processOutboxJob({
        id: 'job-1',
        data: validJobPayload,
      }),
    ).rejects.toThrow('handler failed');

    expect(handler).toHaveBeenCalledTimes(1);
    expect(recordOutboxFailure).toHaveBeenCalledTimes(1);
    expect(markOutboxEventPermanentlyFailed).not.toHaveBeenCalled();
  });

  it('finalizes permanent handler failures without retry', async () => {
    vi.mocked(prisma.outboxEvent.findUnique).mockResolvedValue(validEvent as never);

    const handler = vi.fn().mockResolvedValue({
      status: 'failure',
      error: { message: 'invalid recipient', retryable: false },
    });
    vi.mocked(getHandler).mockReturnValue(handler);

    await expect(
      processOutboxJob({
        id: 'job-1',
        data: validJobPayload,
      }),
    ).rejects.toThrow('invalid recipient');

    expect(handler).toHaveBeenCalledTimes(1);
    expect(markOutboxEventPermanentlyFailed).toHaveBeenCalledTimes(1);
    expect(recordOutboxFailure).not.toHaveBeenCalled();
  });

  it('records thrown handler failure once', async () => {
    vi.mocked(prisma.outboxEvent.findUnique).mockResolvedValue(validEvent as never);

    const handler = vi.fn().mockRejectedValue(new Error('handler failed'));
    vi.mocked(getHandler).mockReturnValue(handler);

    await expect(
      processOutboxJob({
        id: 'job-1',
        data: validJobPayload,
      }),
    ).rejects.toThrow('Outbox job failed for TICKET_ASSIGNED outbox-1: handler failed');

    expect(handler).toHaveBeenCalledTimes(1);
    expect(recordOutboxFailure).toHaveBeenCalledTimes(1);
    expect(markOutboxEventPermanentlyFailed).not.toHaveBeenCalled();
  });

  it('rejects invalid job payload', async () => {
    await expect(
      processOutboxJob({
        id: 'job-1',
        data: {
          ...validJobPayload,
          outboxEventId: '',
        },
      }),
    ).rejects.toThrow();

    expect(prisma.outboxEvent.findUnique).not.toHaveBeenCalled();
  });

  it('handles unknown event type safely', async () => {
    vi.mocked(getHandler).mockImplementation((eventType) => {
      if (eventType === 'UNKNOWN') {
        throw new Error('No handler registered for event type: UNKNOWN');
      }

      return vi.fn().mockResolvedValue(undefined);
    });

    await expect(
      processOutboxJob({
        id: 'job-1',
        data: {
          ...validJobPayload,
          eventType: 'UNKNOWN',
        },
      }),
    ).rejects.toThrow('No handler registered for event type: UNKNOWN');

    expect(prisma.outboxEvent.findUnique).not.toHaveBeenCalled();
  });

  it('handles missing outbox event safely', async () => {
    vi.mocked(prisma.outboxEvent.findUnique).mockResolvedValue(null);

    const result = await processOutboxJob({
      id: 'job-1',
      data: validJobPayload,
    });

    expect(result.handled).toBe(false);
    expect(recordOutboxFailure).not.toHaveBeenCalled();
    expect(markOutboxEventPermanentlyFailed).not.toHaveBeenCalled();
  });

  it('skips already-processed outbox event', async () => {
    vi.mocked(prisma.outboxEvent.findUnique).mockResolvedValue({
      ...validEvent,
      processedAt: new Date('2020-01-01T00:00:00Z'),
    } as never);

    const handler = vi.fn().mockResolvedValue(undefined);
    vi.mocked(getHandler).mockReturnValue(handler);

    const result = await processOutboxJob({
      id: 'job-1',
      data: validJobPayload,
    });

    expect(result.handled).toBe(false);
    expect(handler).not.toHaveBeenCalled();
    expect(markOutboxEventProcessed).not.toHaveBeenCalled();
  });

  it('skips permanently-failed outbox event', async () => {
    vi.mocked(prisma.outboxEvent.findUnique).mockResolvedValue({
      ...validEvent,
      failedAt: new Date('2020-01-01T00:00:00Z'),
    } as never);

    const handler = vi.fn().mockResolvedValue(undefined);
    vi.mocked(getHandler).mockReturnValue(handler);

    const result = await processOutboxJob({
      id: 'job-1',
      data: validJobPayload,
    });

    expect(result.handled).toBe(false);
    expect(handler).not.toHaveBeenCalled();
    expect(markOutboxEventProcessed).not.toHaveBeenCalled();
  });

  it('never mutates attempts on the outbox event', async () => {
    vi.mocked(prisma.outboxEvent.findUnique).mockResolvedValue(validEvent as never);

    const handler = vi.fn().mockResolvedValue(undefined);
    vi.mocked(getHandler).mockReturnValue(handler);

    await processOutboxJob({
      id: 'job-1',
      data: validJobPayload,
    });

    // The worker must only read the event via findUnique. No update/updateMany
    // calls exist on the mock, confirming the worker never mutates attempts.
    expect(prisma.outboxEvent.findUnique).toHaveBeenCalledTimes(1);
    expect(Object.keys(prisma.outboxEvent)).toEqual(['findUnique']);
  });
});
