import { describe, it, expect, vi, afterEach } from 'vitest';
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

const emailEvent = {
  id: 'outbox-email-1',
  eventType: 'TICKET_ASSIGNED',
  aggregateType: 'Ticket',
  aggregateId: 'ticket-1',
  payload: validJobPayload.payload,
  createdAt: new Date('2026-09-08T00:00:00Z'),
  processedAt: null,
  failedAt: null,
  attempts: 1,
  lastError: null,
};

afterEach(() => {
  vi.mocked(prisma.outboxEvent.findUnique).mockReset();
  vi.mocked(getHandler).mockReset();
  vi.mocked(markOutboxEventProcessed).mockReset();
  vi.mocked(recordOutboxFailure).mockReset();
  vi.mocked(markOutboxEventPermanentlyFailed).mockReset();
});

describe('email worker integration', () => {
  it('completes the outbox event when email delivery succeeds', async () => {
    vi.mocked(prisma.outboxEvent.findUnique).mockResolvedValue(emailEvent as never);

    const handler = vi.fn().mockResolvedValue({ status: 'success' });
    vi.mocked(getHandler).mockReturnValue(handler as never);

    const result = await processOutboxJob({ id: 'job-1', data: validJobPayload });

    expect(result.handled).toBe(true);
    expect(handler).toHaveBeenCalledWith(emailEvent);
    expect(markOutboxEventProcessed).toHaveBeenCalledTimes(1);
    expect(recordOutboxFailure).not.toHaveBeenCalled();
    expect(markOutboxEventPermanentlyFailed).not.toHaveBeenCalled();
  });

  it('records retryable failure without finalizing the outbox event', async () => {
    vi.mocked(prisma.outboxEvent.findUnique).mockResolvedValue(emailEvent as never);

    const handler = vi.fn().mockResolvedValue({ status: 'failure', error: { message: 'temporarily unavailable', retryable: true } });
    vi.mocked(getHandler).mockReturnValue(handler as never);

    await expect(processOutboxJob({ id: 'job-1', data: validJobPayload })).rejects.toThrow();

    expect(recordOutboxFailure).toHaveBeenCalledTimes(1);
    expect(markOutboxEventPermanentlyFailed).not.toHaveBeenCalled();
    expect(markOutboxEventProcessed).not.toHaveBeenCalled();
  });
});
