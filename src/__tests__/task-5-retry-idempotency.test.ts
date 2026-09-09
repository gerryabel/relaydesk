import { describe, it, expect, vi, beforeEach } from 'vitest';
import { recordOutboxFailure, markOutboxEventPermanentlyFailed } from '@/lib/outbox/outbox';
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
        updateMany: vi.fn().mockResolvedValue({ count: 1 } as never),
      },
    };
  });

  it('records retryable failure without finalizing', async () => {
    await recordOutboxFailure(tx as Parameters<typeof recordOutboxFailure>[0], 'outbox-1', new Error('timeout'));

    expect((tx as { outboxEvent: { updateMany: ReturnType<typeof vi.fn> } }).outboxEvent.updateMany).toHaveBeenCalledWith({
      where: { id: 'outbox-1' },
      data: { processedAt: null, attempts: { increment: 1 }, lastError: 'timeout' },
    });
  });

  it('marks permanent failure state', async () => {
    await markOutboxEventPermanentlyFailed(tx as Parameters<typeof markOutboxEventPermanentlyFailed>[0], 'outbox-1', new Error('invalid recipient'));

    const updateMany = (tx as { outboxEvent: { updateMany: ReturnType<typeof vi.fn> } }).outboxEvent.updateMany;
    expect(updateMany).toHaveBeenCalledTimes(1);
    expect(updateMany).toHaveBeenCalledWith({
      where: { id: 'outbox-1', attempts: { lt: 3 } },
      data: expect.objectContaining({
        lastError: '[task-5:permanent-failure] invalid recipient',
      }),
    });

    const [[calledArgs]] = updateMany.mock.calls;
    const processedAt = calledArgs.data.processedAt as Date | undefined;
    expect(processedAt).toBeInstanceOf(Date);
    expect(processedAt!.getTime()).toBeLessThan(Date.now());
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
