import { describe, it, expect, vi, beforeEach } from 'vitest';
import { recordOutboxFailure, markOutboxEventPermanentlyFailed, claimNextOutboxEvent } from '@/lib/outbox/outbox';
import { classifyProviderError } from '@/lib/email/errors';
import { classifyDeliveryResult } from '@/lib/queue/errors';

vi.mock('@/lib/email/provider', () => ({
  sendEmail: vi.fn().mockResolvedValue({ status: 'success' }),
  parseEmailProviderConfig: vi.fn().mockReturnValue({ provider: 'console', from: 'test' }),
}));

describe('outbox failure state', () => {
  let tx: unknown;

  beforeEach(() => {
    tx = {
      outboxEvent: {
        findFirst: vi.fn().mockResolvedValue({ attempts: 0, failedAt: null } as never),
        updateMany: vi.fn().mockResolvedValue({ count: 1 } as never),
      },
    };
  });

  it('records retryable failure without finalizing', async () => {
    await recordOutboxFailure(tx as Parameters<typeof recordOutboxFailure>[0], 'outbox-1', new Error('timeout'));

    expect((tx as { outboxEvent: { updateMany: ReturnType<typeof vi.fn> } }).outboxEvent.updateMany).toHaveBeenCalledWith({
      where: { id: 'outbox-1', failedAt: null },
      data: { processedAt: null, lastError: 'timeout' },
    });
  });

  it('records permanent failure as terminal', async () => {
    await markOutboxEventPermanentlyFailed(tx as Parameters<typeof markOutboxEventPermanentlyFailed>[0], 'outbox-1', new Error('invalid recipient'));

    const updateMany = (tx as { outboxEvent: { updateMany: ReturnType<typeof vi.fn> } }).outboxEvent.updateMany;
    expect(updateMany).toHaveBeenCalledTimes(1);
    expect(updateMany).toHaveBeenCalledWith({
      where: { id: 'outbox-1', failedAt: null },
      data: expect.objectContaining({
        failedAt: expect.any(Date),
        lastError: '[task-5:permanent-failure] invalid recipient',
      }),
    });

    const [[calledArgs]] = updateMany.mock.calls;
    const failedAt = calledArgs.data.failedAt as Date | undefined;
    expect(failedAt).toBeInstanceOf(Date);
    expect(failedAt!.getTime()).toBeLessThanOrEqual(Date.now());
  });
});

describe('claim eligibility', () => {
  const baseEvent = {
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
  };

  it('claims pending events', async () => {
    const tx = {
      outboxEvent: {
        findFirst: vi.fn().mockResolvedValue(baseEvent),
        updateMany: vi.fn().mockResolvedValue({ count: 1 } as never),
      },
    } as unknown as Parameters<typeof claimNextOutboxEvent>[0];

    const claimed = await claimNextOutboxEvent(tx);
    expect(claimed.claimed).toBe(true);
    expect(claimed.event?.id).toBe('outbox-1');
  });

  it('excludes permanently failed events from claim', async () => {
    const tx = {
      outboxEvent: {
        findFirst: vi.fn().mockResolvedValue({ ...baseEvent, failedAt: new Date() }),
        updateMany: vi.fn(),
      },
    } as unknown as Parameters<typeof claimNextOutboxEvent>[0];

    const claimed = await claimNextOutboxEvent(tx);
    expect(claimed.claimed).toBe(false);
    expect(claimed.event).toBeNull();
    expect(tx.outboxEvent.updateMany).not.toHaveBeenCalled();
  });

  it('excludes completed events from claim', async () => {
    const tx = {
      outboxEvent: {
        findFirst: vi.fn().mockResolvedValue(null),
        updateMany: vi.fn(),
      },
    } as unknown as Parameters<typeof claimNextOutboxEvent>[0];

    const claimed = await claimNextOutboxEvent(tx);
    expect(claimed.claimed).toBe(false);
    expect(claimed.event).toBeNull();
    expect(tx.outboxEvent.updateMany).not.toHaveBeenCalled();
  });
});

describe('error classification', () => {
  it('classifies invalid message errors as non-retryable', async () => {
    const error = classifyProviderError(new Error('invalid request: missing required subject'));

    expect(error.retryable).toBe(false);
    expect(error.code).toBe('INVALID_MESSAGE');
  });

  it('classifies retryable provider failure as retryable', async () => {
    const error = classifyProviderError(new Error('network timeout while delivering email'));

    expect(error.retryable).toBe(true);
    expect(error.code).toBe('RETRYABLE_FAILURE');
  });

  it('classifies invalid delivery result as permanent', async () => {
    const error = classifyDeliveryResult({
      status: 'invalid_message',
      error: { code: 'INVALID_MESSAGE', message: 'missing field', retryable: false },
    });

    expect(error.message).toContain('missing field');
    expect((error as Error & { retryable?: boolean }).retryable).toBe(false);
  });
});
