import { describe, it, expect, vi, beforeEach } from 'vitest';
import { processOutboxJob } from '@/lib/queue/worker';
import { claimNextOutboxEvent, markOutboxEventProcessed, recordOutboxFailure } from '@/lib/outbox/outbox';
import { getHandler } from '@/lib/queue/handlers/registry';

vi.mock('@/lib/outbox/outbox', () => ({
  claimNextOutboxEvent: vi.fn(),
  markOutboxEventProcessed: vi.fn(),
  recordOutboxFailure: vi.fn(),
}));

vi.mock('@/lib/queue/handlers/registry', () => ({
  getHandler: vi.fn(),
}));

const validEvent = {
  id: 'outbox-1',
  eventType: 'TICKET_ASSIGNED',
  aggregateType: 'Ticket',
  aggregateId: 'ticket-1',
  payload: { workspaceId: 'workspace-1' },
  createdAt: new Date('2026-09-08T00:00:00Z'),
  processedAt: null,
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
    vi.resetModules();
    vi.mocked(claimNextOutboxEvent).mockReset();
    vi.mocked(markOutboxEventProcessed).mockReset();
    vi.mocked(recordOutboxFailure).mockReset();
    vi.mocked(getHandler).mockReset();
  });

  it('processes a valid job successfully', async () => {
    vi.mocked(claimNextOutboxEvent).mockResolvedValue({
      event: validEvent,
      claimed: true,
    });

    const handler = vi.fn().mockResolvedValue(undefined);
    vi.mocked(getHandler).mockReturnValue(handler);

    const result = await processOutboxJob({
      id: 'job-1',
      data: validJobPayload,
    });

    expect(result.handled).toBe(true);
    expect(handler).toHaveBeenCalledWith(validEvent);
    expect(recordOutboxFailure).not.toHaveBeenCalled();
  });

  it('records handler failure exactly once for retryable failures', async () => {
    vi.mocked(claimNextOutboxEvent).mockResolvedValue({
      event: validEvent,
      claimed: true,
    });

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
  });

  it('records thrown handler failure once', async () => {
    vi.mocked(claimNextOutboxEvent).mockResolvedValue({
      event: validEvent,
      claimed: true,
    });

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
  });

  it('handles missing outbox event safely', async () => {
    vi.mocked(claimNextOutboxEvent).mockResolvedValue({
      event: null,
      claimed: false,
    });

    const result = await processOutboxJob({
      id: 'job-1',
      data: validJobPayload,
    });

    expect(result.handled).toBe(false);
    expect(recordOutboxFailure).not.toHaveBeenCalled();
  });
});
