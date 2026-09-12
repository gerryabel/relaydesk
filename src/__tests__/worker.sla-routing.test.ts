import { describe, it, expect, beforeAll, vi } from 'vitest';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import fs from 'node:fs';

/**
 * Regression tests for the SLA_EVALUATION routing.
 *
 * Task 7 must preserve the Task 6 routing exactly: scheduler-created
 * SLA_EVALUATION jobs (data: {}) must run through runSlaEvaluation and
 * NEVER reach processOutboxJob (which would fail OutboxJobSchema).
 */

const workerPath = path.resolve(
  fileURLToPath(new URL('../../scripts/worker.mjs', import.meta.url)),
);
const dispatcherPath = path.resolve(
  fileURLToPath(new URL('../lib/queue/dispatcher.ts', import.meta.url)),
);

describe('SLA_EVALUATION routing regression (source analysis)', () => {
  let workerSource: string;
  let dispatcherSource: string;

  beforeAll(async () => {
    workerSource = await fs.promises.readFile(workerPath, 'utf8');
    dispatcherSource = await fs.promises.readFile(dispatcherPath, 'utf8');
  });

  it('routes SLA_EVALUATION jobs to runSlaEvaluation before processOutboxJob', () => {
    // The routing check must be present in the source.
    expect(workerSource).toContain('SLA_EVALUATION_JOB_NAME');
    expect(workerSource).toContain('runSlaEvaluation');
    expect(workerSource).toContain('processOutboxJob');

    // The routing check (`job.name === SLA_EVALUATION_JOB_NAME`) must come
    // BEFORE the processOutboxJob call in the processor function.
    // Find the routing check pattern, not the import.
    const routingCheckPattern = 'job.name === SLA_EVALUATION_JOB_NAME';
    const processOutboxCallPattern = 'return processOutboxJob(job)';

    const routingCheckIndex = workerSource.indexOf(routingCheckPattern);
    const processOutboxCallIndex = workerSource.indexOf(processOutboxCallPattern);

    expect(routingCheckIndex).toBeGreaterThan(-1);
    expect(processOutboxCallIndex).toBeGreaterThan(-1);
    expect(routingCheckIndex).toBeLessThan(processOutboxCallIndex);
  });

  it('does NOT duplicate the no-event dispatch log in worker.mjs', () => {
    // The dispatcher function logs "No outbox event available for dispatch".
    // The worker must NOT log the same message again — it would cause duplicate
    // log lines per dispatch tick. The log should appear exactly once in the
    // dispatcher, and zero times in the worker.
    const workerLogs = workerSource.match(
      /No outbox event available for dispatch/g,
    ) ?? [];
    expect(workerLogs.length).toBe(0);

    const dispatcherLogs = dispatcherSource.match(
      /No outbox event available for dispatch/g,
    ) ?? [];
    expect(dispatcherLogs.length).toBe(1);
  });
});

// Mock dependencies for processOutboxJob safety net test.
vi.mock('@/lib/outbox/outbox', () => ({
  markOutboxEventProcessed: vi.fn(),
  markOutboxEventPermanentlyFailed: vi.fn(),
  recordOutboxFailure: vi.fn(),
}));
vi.mock('@/lib/queue/handlers/registry', () => ({
  getHandler: vi.fn(),
}));
vi.mock('@/lib/db/prisma', () => ({
  prisma: { outboxEvent: { findUnique: vi.fn() } },
}));
vi.mock('@/lib/queue/logger', () => ({
  info: vi.fn(),
  warn: vi.fn(),
  error: vi.fn(),
  debug: vi.fn(),
}));

describe('processOutboxJob safety net', () => {
  it('rejects non-outbox jobs (missing outboxEventId) with a clear error', async () => {
    const { processOutboxJob } = await import('@/lib/queue/worker');

    // An SLA_EVALUATION job has data: {} — no outboxEventId.
    await expect(
      processOutboxJob({
        id: 'job-sla',
        name: 'SLA_EVALUATION',
        data: {},
        attemptsMade: 0,
      }),
    ).rejects.toThrow(/non-outbox job/);

    await expect(
      processOutboxJob({
        id: 'job-sla',
        name: 'SLA_EVALUATION',
        data: undefined,
        attemptsMade: 0,
      }),
    ).rejects.toThrow(/non-outbox job/);
  });
});
