import { describe, it, expect, vi, afterEach } from 'vitest';
import { processOutboxJob } from '@/lib/queue/worker';
import { claimNextOutboxEvent, markOutboxEventProcessed, markOutboxEventFailed } from '@/lib/outbox/outbox';
import { getHandler } from '@/lib/queue/handlers/registry';

vi.mock('@/lib/outbox/outbox', () => ({
  claimNextOutboxEvent: vi.fn(),
  markOutboxEventProcessed: vi.fn(),
  markOutboxEventFailed: vi.fn(),
}));

vi.mock('@/lib/queue/handlers/registry', () => ({
  getHandler: vi.fn(),
}));

const validJobPayload = {
  outboxEventId: 'outbox-email-1',
  eventType: 'TICKET_ASSIGNED',
  aggregateType: 'Ticket',
  aggregateId: 'ticket-1',
  payload: {
    workspaceId: 'workspace-123',
    ticketId: 'ticket-1',
    assigneeId: 'user-456',
    previousAssigneeId: null,
    actorId: 'user-123',
  },
  attempt: 0,
};

afterEach(() => {
  vi.mocked(claimNextOutboxEvent).mockReset();
  vi.mocked(getHandler).mockReset();
  vi.mocked(markOutboxEventProcessed).mockReset();
  vi.mocked(markOutboxEventFailed).mockReset();
});

describe('email worker integration', () => {
  it('completes the outbox event when email delivery succeeds', async () => {
    vi.mocked(claimNextOutboxEvent).mockResolvedValue({
      event: {
        id: 'outbox-email-1',
        eventType: 'TICKET_ASSIGNED',
        aggregateType: 'Ticket',
        aggregateId: 'ticket-1',
        payload: validJobPayload.payload,
        createdAt: new Date('2026-09-08T00:00:00Z'),
        processedAt: null,
        attempts: 1,
        lastError: null,
      },
      claimed: true,
    });

    const handler = vi.fn().mockResolvedValue({ status: 'success' });
    vi.mocked(getHandler).mockReturnValue(handler as never);

    const result = await processOutboxJob({ id: 'job-1', data: validJobPayload });

    expect(result.handled).toBe(true);
    expect(markOutboxEventProcessed).toHaveBeenCalledTimes(1);
    expect(markOutboxEventFailed).not.toHaveBeenCalled();
  });

  it('fails the outbox event when provider returns retryable failure', async () => {
    vi.mocked(claimNextOutboxEvent).mockResolvedValue({
      event: {
        id: 'outbox-email-1',
        eventType: 'TICKET_ASSIGNED',
        aggregateType: 'Ticket',
        aggregateId: 'ticket-1',
        payload: validJobPayload.payload,
        createdAt: new Date('2026-09-08T00:00:00Z'),
        processedAt: null,
        attempts: 1,
        lastError: null,
      },
      claimed: true,
    });

    const handler = vi.fn().mockResolvedValue({ status: 'failure', error: { message: 'temporarily unavailable', retryable: true } });
    vi.mocked(getHandler).mockReturnValue(handler as never);

    await expect(processOutboxJob({ id: 'job-1', data: validJobPayload })).rejects.toThrow();

    expect(markOutboxEventFailed).toHaveBeenCalledTimes(1);
    expect(markOutboxEventProcessed).not.toHaveBeenCalled();
  });
});
