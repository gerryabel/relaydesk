import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { Prisma } from '@/generated/prisma';

function createMockTx(overrides: Record<string, unknown> = {}) {
  const defaults = {
    outboxEvent: {
      findMany: vi.fn().mockResolvedValue([]),
      count: vi.fn().mockResolvedValue(0),
    },
  };

  return { ...defaults, ...overrides } as unknown as Prisma.TransactionClient;
}

describe('recovery', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-09-12T00:00:00.000Z'));
  });

  describe('getPendingEvents', () => {
    it('returns events that have never been claimed', async () => {
      const { getPendingEvents } = await import('@/lib/queue/recovery');

      const tx = createMockTx({
        outboxEvent: {
          findMany: vi.fn().mockResolvedValue([
            {
              id: 'outbox-1',
              eventType: 'TICKET_ASSIGNED',
              attempts: 0,
              lastError: null,
              createdAt: new Date('2026-09-11T00:00:00Z'),
              processedAt: null,
            },
          ]),
          count: vi.fn().mockResolvedValue(0),
        },
      });

      const result = await getPendingEvents(tx);

      expect(result).toHaveLength(1);
      expect(result[0]).toMatchObject({
        id: 'outbox-1',
        eventType: 'TICKET_ASSIGNED',
        attempts: 0,
        lastError: null,
      });

      // Never leak the full payload — only summary fields.
      expect(result[0]).not.toHaveProperty('payload');
    });

    it('queries for processedAt null + attempts 0 + not failed + not completed', async () => {
      const { getPendingEvents } = await import('@/lib/queue/recovery');
      const findMany = vi.fn().mockResolvedValue([]);
      const tx = createMockTx({ outboxEvent: { findMany, count: vi.fn() } });

      await getPendingEvents(tx);

      expect(findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: {
            failedAt: null,
            completedAt: null,
            processedAt: null,
            attempts: 0,
          },
        }),
      );
    });
  });

  describe('getStrandedEvents', () => {
    it('returns events with attempts > 0 and processedAt null', async () => {
      const { getStrandedEvents } = await import('@/lib/queue/recovery');

      const tx = createMockTx({
        outboxEvent: {
          findMany: vi.fn().mockResolvedValue([
            {
              id: 'outbox-2',
              eventType: 'TICKET_ASSIGNED',
              attempts: 2,
              lastError: 'timeout',
              createdAt: new Date('2026-09-11T00:00:00Z'),
              processedAt: null,
            },
          ]),
          count: vi.fn().mockResolvedValue(0),
        },
      });

      const result = await getStrandedEvents(tx);

      expect(result).toHaveLength(1);
      expect(result[0].attempts).toBe(2);
      expect(result[0].lastError).toBe('timeout');
    });

    it('excludes completed events', async () => {
      const { getStrandedEvents } = await import('@/lib/queue/recovery');
      const findMany = vi.fn().mockResolvedValue([]);
      const tx = createMockTx({ outboxEvent: { findMany, count: vi.fn() } });

      await getStrandedEvents(tx);

      const where = findMany.mock.calls[0][0].where;
      expect(where.completedAt).toBeNull();
      expect(where.failedAt).toBeNull();
      expect(where.processedAt).toBeNull();
      expect(where.attempts).toEqual({ gt: 0 });
    });
  });

  describe('getActiveLeases', () => {
    it('returns events with processedAt in the future', async () => {
      const { getActiveLeases } = await import('@/lib/queue/recovery');
      const now = new Date('2026-09-12T00:00:00Z');
      const future = new Date('2026-09-12T00:05:00Z');

      const tx = createMockTx({
        outboxEvent: {
          findMany: vi.fn().mockResolvedValue([
            {
              id: 'outbox-3',
              eventType: 'SLA_AT_RISK',
              attempts: 1,
              lastError: null,
              createdAt: new Date('2026-09-11T00:00:00Z'),
              processedAt: future,
            },
          ]),
          count: vi.fn().mockResolvedValue(0),
        },
      });

      const result = await getActiveLeases(tx, now);

      expect(result).toHaveLength(1);
      expect(result[0].id).toBe('outbox-3');
    });

    it('queries for processedAt > now', async () => {
      const { getActiveLeases } = await import('@/lib/queue/recovery');
      const findMany = vi.fn().mockResolvedValue([]);
      const tx = createMockTx({ outboxEvent: { findMany, count: vi.fn() } });
      const now = new Date('2026-09-12T00:00:00Z');

      await getActiveLeases(tx, now);

      const where = findMany.mock.calls[0][0].where;
      expect(where.processedAt).toEqual({ gt: now });
    });
  });

  describe('getExpiredLeases', () => {
    it('returns events with processedAt <= now and not null', async () => {
      const { getExpiredLeases } = await import('@/lib/queue/recovery');
      const now = new Date('2026-09-12T00:00:00Z');
      const past = new Date('2026-09-11T23:55:00Z');

      const tx = createMockTx({
        outboxEvent: {
          findMany: vi.fn().mockResolvedValue([
            {
              id: 'outbox-4',
              eventType: 'TICKET_ASSIGNED',
              attempts: 1,
              lastError: 'worker crashed',
              createdAt: new Date('2026-09-11T00:00:00Z'),
              processedAt: past,
            },
          ]),
          count: vi.fn().mockResolvedValue(0),
        },
      });

      const result = await getExpiredLeases(tx, now);

      expect(result).toHaveLength(1);
      expect(result[0].id).toBe('outbox-4');
    });

    it('queries for processedAt <= now and not null', async () => {
      const { getExpiredLeases } = await import('@/lib/queue/recovery');
      const findMany = vi.fn().mockResolvedValue([]);
      const tx = createMockTx({ outboxEvent: { findMany, count: vi.fn() } });
      const now = new Date('2026-09-12T00:00:00Z');

      await getExpiredLeases(tx, now);

      const where = findMany.mock.calls[0][0].where;
      expect(where.processedAt).toEqual({ not: null, lte: now });
    });
  });

  describe('getFailedEvents', () => {
    it('returns permanently failed events', async () => {
      const { getFailedEvents } = await import('@/lib/queue/recovery');

      const tx = createMockTx({
        outboxEvent: {
          findMany: vi.fn().mockResolvedValue([
            {
              id: 'outbox-5',
              eventType: 'TICKET_ASSIGNED',
              attempts: 3,
              lastError: '[task-5:permanent-failure] invalid recipient',
              createdAt: new Date('2026-09-11T00:00:00Z'),
              processedAt: null,
            },
          ]),
          count: vi.fn().mockResolvedValue(0),
        },
      });

      const result = await getFailedEvents(tx);

      expect(result).toHaveLength(1);
      expect(result[0].id).toBe('outbox-5');
    });

    it('queries for failedAt not null', async () => {
      const { getFailedEvents } = await import('@/lib/queue/recovery');
      const findMany = vi.fn().mockResolvedValue([]);
      const tx = createMockTx({ outboxEvent: { findMany, count: vi.fn() } });

      await getFailedEvents(tx);

      const where = findMany.mock.calls[0][0].where;
      expect(where.failedAt).toEqual({ not: null });
    });
  });

  describe('getCompletedEvents', () => {
    it('returns completed events', async () => {
      const { getCompletedEvents } = await import('@/lib/queue/recovery');

      const tx = createMockTx({
        outboxEvent: {
          findMany: vi.fn().mockResolvedValue([
            {
              id: 'outbox-6',
              eventType: 'TICKET_ASSIGNED',
              attempts: 1,
              lastError: null,
              createdAt: new Date('2026-09-11T00:00:00Z'),
              processedAt: new Date('2026-09-11T00:00:01Z'),
            },
          ]),
          count: vi.fn().mockResolvedValue(0),
        },
      });

      const result = await getCompletedEvents(tx);

      expect(result).toHaveLength(1);
      expect(result[0].id).toBe('outbox-6');
    });

    it('queries for completedAt not null', async () => {
      const { getCompletedEvents } = await import('@/lib/queue/recovery');
      const findMany = vi.fn().mockResolvedValue([]);
      const tx = createMockTx({ outboxEvent: { findMany, count: vi.fn() } });

      await getCompletedEvents(tx);

      const where = findMany.mock.calls[0][0].where;
      expect(where.completedAt).toEqual({ not: null });
    });
  });

  describe('buildRecoveryReport', () => {
    it('aggregates all categories into a single report', async () => {
      const { buildRecoveryReport } = await import('@/lib/queue/recovery');
      const now = new Date('2026-09-12T00:00:00Z');

      const tx = createMockTx({
        outboxEvent: {
          findMany: vi.fn().mockImplementation(({ where }) => {
            if (where.attempts === 0) {
              return [{ id: 'p1', eventType: 'TICKET_ASSIGNED', attempts: 0, lastError: null, createdAt: new Date(), processedAt: null }];
            }
            if (where.attempts && where.attempts.gt === 0) {
              return [{ id: 's1', eventType: 'TICKET_ASSIGNED', attempts: 2, lastError: 'err', createdAt: new Date(), processedAt: null }];
            }
            if (where.processedAt && where.processedAt.gt) {
              return [{ id: 'a1', eventType: 'SLA_AT_RISK', attempts: 1, lastError: null, createdAt: new Date(), processedAt: new Date('2026-09-12T00:05:00Z') }];
            }
            if (where.processedAt && where.processedAt.lte) {
              return [{ id: 'e1', eventType: 'TICKET_ASSIGNED', attempts: 1, lastError: 'crash', createdAt: new Date(), processedAt: new Date('2026-09-11T23:55:00Z') }];
            }
            if (where.failedAt) {
              return [{ id: 'f1', eventType: 'TICKET_ASSIGNED', attempts: 3, lastError: 'perm', createdAt: new Date(), processedAt: null }];
            }
            if (where.completedAt) {
              return [{ id: 'c1', eventType: 'TICKET_ASSIGNED', attempts: 1, lastError: null, createdAt: new Date(), processedAt: new Date() }];
            }
            return [];
          }),
          count: vi.fn().mockResolvedValue(0),
        },
      });

      const report = await buildRecoveryReport(tx, now);

      expect(report.pending).toHaveLength(1);
      expect(report.stranded).toHaveLength(1);
      expect(report.activeLeases).toHaveLength(1);
      expect(report.expiredLeases).toHaveLength(1);
      expect(report.failed).toHaveLength(1);
      expect(report.completed).toHaveLength(1);
    });
  });

  describe('getStartupRecoverySummary', () => {
    it('returns stranded count and event ids', async () => {
      const { getStartupRecoverySummary } = await import('@/lib/queue/recovery');

      const tx = createMockTx({
        outboxEvent: {
          findMany: vi.fn().mockResolvedValue([{ id: 's1' }, { id: 's2' }]),
          count: vi.fn().mockResolvedValue(0),
        },
      });

      const summary = await getStartupRecoverySummary(tx);

      expect(summary.strandedCount).toBe(2);
      expect(summary.strandedEventIds).toEqual(['s1', 's2']);
    });

    it('returns zero stranded when none exist', async () => {
      const { getStartupRecoverySummary } = await import('@/lib/queue/recovery');

      const tx = createMockTx({
        outboxEvent: {
          findMany: vi.fn().mockResolvedValue([]),
          count: vi.fn().mockResolvedValue(5),
        },
      });

      const summary = await getStartupRecoverySummary(tx);

      expect(summary.strandedCount).toBe(0);
      expect(summary.strandedEventIds).toEqual([]);
      expect(summary.pendingCount).toBe(5);
    });
  });
});
