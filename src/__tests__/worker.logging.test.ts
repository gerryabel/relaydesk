import { describe, it, expect, vi, beforeEach } from 'vitest';

/**
 * These tests verify that processOutboxJob emits structured logs with the
 * required correlation fields (outboxEventId, jobId, eventType, attempt).
 *
 * They mock the logger so we can assert on log calls without depending on
 * console output, and mock the outbox/prisma/registry layers as the
 * existing worker tests do.
 */

vi.mock('@/lib/queue/logger', () => ({
  info: vi.fn(),
  warn: vi.fn(),
  error: vi.fn(),
  debug: vi.fn(),
}));

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

import { info, warn, error as logError } from '@/lib/queue/logger';
import { processOutboxJob } from '@/lib/queue/worker';
import { markOutboxEventProcessed, recordOutboxFailure } from '@/lib/outbox/outbox';
import { getHandler } from '@/lib/queue/handlers/registry';
import { prisma } from '@/lib/db/prisma';

const mockedInfo = vi.mocked(info);
const mockedWarn = vi.mocked(warn);
const mockedError = vi.mocked(logError);
const mockedMarkProcessed = vi.mocked(markOutboxEventProcessed);
const mockedRecordFailure = vi.mocked(recordOutboxFailure);
const mockedGetHandler = vi.mocked(getHandler);
const mockedFindUnique = vi.mocked(prisma.outboxEvent.findUnique);

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

/**
 * Return the context of the first log call whose message matches, or fail
 * the test with a clear message. Using filter + index avoids the
 * "object is possibly undefined" narrowing issue with Array.find.
 */
function firstContext(
  calls: Array<readonly [string, ...unknown[]]>,
  message: string,
): Record<string, unknown> {
  const matches = calls.filter(([msg]) => msg === message);
  expect(matches, `expected a log call with message "${message}"`).toHaveLength(1);
  return matches[0][1] as Record<string, unknown>;
}

describe('worker logging', () => {
  beforeEach(() => {
    vi.resetAllMocks();
  });

  it('logs job completion with outboxEventId, jobId, eventType, and attempt', async () => {
    mockedFindUnique.mockResolvedValue(validEvent as never);
    mockedGetHandler.mockReturnValue(vi.fn().mockResolvedValue(undefined));
    mockedMarkProcessed.mockResolvedValue(undefined);

    await processOutboxJob({
      id: 'job-42',
      data: validJobPayload,
      attemptsMade: 0,
    });

    // The "Handler starting" log must carry the correlation fields.
    expect(firstContext(mockedInfo.mock.calls, 'Handler starting')).toMatchObject({
      outboxEventId: 'outbox-1',
      jobId: 'job-42',
      eventType: 'TICKET_ASSIGNED',
      attempt: 0,
    });

    // The success log must also carry them plus durationMs.
    const successCtx = firstContext(mockedInfo.mock.calls, 'Job completed successfully');
    expect(successCtx).toMatchObject({
      outboxEventId: 'outbox-1',
      jobId: 'job-42',
      eventType: 'TICKET_ASSIGNED',
      attempt: 0,
    });
    expect(typeof successCtx.durationMs).toBe('number');
  });

  it('uses BullMQ attemptsMade as the attempt source of truth', async () => {
    mockedFindUnique.mockResolvedValue(validEvent as never);
    mockedGetHandler.mockReturnValue(vi.fn().mockResolvedValue(undefined));
    mockedMarkProcessed.mockResolvedValue(undefined);

    await processOutboxJob({
      id: 'job-42',
      data: validJobPayload,
      attemptsMade: 2,
    });

    expect(firstContext(mockedInfo.mock.calls, 'Handler starting')).toMatchObject({ attempt: 2 });
  });

  it('falls back to payload attempt when attemptsMade is absent', async () => {
    mockedFindUnique.mockResolvedValue(validEvent as never);
    mockedGetHandler.mockReturnValue(vi.fn().mockResolvedValue(undefined));
    mockedMarkProcessed.mockResolvedValue(undefined);

    await processOutboxJob({
      id: 'job-42',
      data: validJobPayload,
    });

    expect(firstContext(mockedInfo.mock.calls, 'Handler starting')).toMatchObject({ attempt: 0 });
  });

  it('logs retryable failure with correlation fields', async () => {
    mockedFindUnique.mockResolvedValue(validEvent as never);
    mockedGetHandler.mockReturnValue(
      vi.fn().mockResolvedValue({
        status: 'failure',
        error: { message: 'timeout', retryable: true },
      }),
    );
    mockedRecordFailure.mockResolvedValue(undefined);

    await expect(
      processOutboxJob({
        id: 'job-42',
        data: validJobPayload,
        attemptsMade: 1,
      }),
    ).rejects.toThrow('timeout');

    expect(firstContext(mockedWarn.mock.calls, 'Job failed with retryable error')).toMatchObject({
      outboxEventId: 'outbox-1',
      jobId: 'job-42',
      eventType: 'TICKET_ASSIGNED',
      attempt: 1,
      error: 'timeout',
    });
  });

  it('logs permanent failure with correlation fields', async () => {
    mockedFindUnique.mockResolvedValue(validEvent as never);
    mockedGetHandler.mockReturnValue(
      vi.fn().mockResolvedValue({
        status: 'failure',
        error: { message: 'invalid recipient', retryable: false },
      }),
    );

    await expect(
      processOutboxJob({
        id: 'job-42',
        data: validJobPayload,
        attemptsMade: 0,
      }),
    ).rejects.toThrow('invalid recipient');

    expect(firstContext(mockedError.mock.calls, 'Job permanently failed')).toMatchObject({
      outboxEventId: 'outbox-1',
      jobId: 'job-42',
      eventType: 'TICKET_ASSIGNED',
      attempt: 0,
      error: 'invalid recipient',
    });
  });

  it('logs a warning when the outbox event is not found', async () => {
    mockedFindUnique.mockResolvedValue(null);

    const result = await processOutboxJob({
      id: 'job-42',
      data: validJobPayload,
    });

    expect(result.handled).toBe(false);
    expect(firstContext(mockedWarn.mock.calls, 'Outbox event not found, skipping job')).toMatchObject({
      outboxEventId: 'outbox-1',
      jobId: 'job-42',
      eventType: 'TICKET_ASSIGNED',
    });
  });
});
