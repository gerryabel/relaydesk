import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

describe('logger', () => {
  let output: string[];

  beforeEach(() => {
    output = [];
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-09-12T00:00:00.000Z'));
    vi.resetModules();

    vi.spyOn(console, 'log').mockImplementation((line: string) => {
      output.push(line);
    });
    vi.spyOn(console, 'error').mockImplementation((line: string) => {
      output.push(line);
    });
    vi.spyOn(console, 'warn').mockImplementation((line: string) => {
      output.push(line);
    });
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it('emits valid JSON with required job-scoped fields', async () => {
    const { info, setWorkerId } = await import('@/lib/queue/logger');
    setWorkerId('worker-test-123');

    info('Job completed successfully', {
      outboxEventId: 'outbox-123',
      jobId: 'job-456',
      eventType: 'TICKET_ASSIGNED',
      attempt: 2,
      durationMs: 150,
    });

    expect(output).toHaveLength(1);
    const entry = JSON.parse(output[0]);

    expect(entry).toMatchObject({
      level: 'info',
      workerId: 'worker-test-123',
      outboxEventId: 'outbox-123',
      jobId: 'job-456',
      eventType: 'TICKET_ASSIGNED',
      attempt: 2,
      durationMs: 150,
      message: 'Job completed successfully',
    });

    expect(() => JSON.parse(output[0])).not.toThrow();
  });

  it('includes a timestamp field', async () => {
    const { info } = await import('@/lib/queue/logger');
    info('test message');
    const entry = JSON.parse(output[0]);
    expect(entry).toHaveProperty('timestamp');
    expect(typeof entry.timestamp).toBe('string');
  });

  it('propagates arbitrary context fields', async () => {
    const { info } = await import('@/lib/queue/logger');
    info('custom context', { queueName: 'relaydesk-primary', waiting: 5 });
    const entry = JSON.parse(output[0]);
    expect(entry).toMatchObject({ queueName: 'relaydesk-primary', waiting: 5 });
  });

  it('serializes Error instances into message + stack', async () => {
    const { error: logError } = await import('@/lib/queue/logger');
    const err = new Error('something broke');
    err.name = 'HandlerError';
    logError('Job failed', { error: err });

    const entry = JSON.parse(output[0]);
    expect(entry.error).toMatchObject({
      name: 'HandlerError',
      message: 'something broke',
    });
    expect(typeof entry.error.stack).toBe('string');
  });

  it('redacts sensitive keys', async () => {
    const { info } = await import('@/lib/queue/logger');
    info('connect', {
      redis_url: 'redis://secret@localhost:6379',
      database_url: 'postgresql://user:pass@localhost/db',
      password: 'hunter2',
      apiKey: 'sk-1234',
    });

    const entry = JSON.parse(output[0]);
    expect(entry.redis_url).toBe('[REDACTED]');
    expect(entry.database_url).toBe('[REDACTED]');
    expect(entry.password).toBe('[REDACTED]');
    expect(entry.apiKey).toBe('[REDACTED]');
  });

  it('does not redact non-sensitive keys', async () => {
    const { info } = await import('@/lib/queue/logger');
    info('ok', { eventType: 'TICKET_ASSIGNED', attempt: 1 });
    const entry = JSON.parse(output[0]);
    expect(entry.eventType).toBe('TICKET_ASSIGNED');
    expect(entry.attempt).toBe(1);
  });

  it('supports all log levels', async () => {
    const { debug, info, warn, error: logError } = await import('@/lib/queue/logger');
    debug('d');
    info('i');
    warn('w');
    logError('e');

    expect(output).toHaveLength(4);
    expect(JSON.parse(output[0]).level).toBe('debug');
    expect(JSON.parse(output[1]).level).toBe('info');
    expect(JSON.parse(output[2]).level).toBe('warn');
    expect(JSON.parse(output[3]).level).toBe('error');
  });

  it('uses the configured workerId', async () => {
    const { info, setWorkerId } = await import('@/lib/queue/logger');
    setWorkerId('worker-custom-xyz');
    info('test');
    const entry = JSON.parse(output[0]);
    expect(entry.workerId).toBe('worker-custom-xyz');
  });

  it('generates a workerId when none is set', async () => {
    const { getWorkerId } = await import('@/lib/queue/logger');
    const id = getWorkerId();
    expect(typeof id).toBe('string');
    expect(id.length).toBeGreaterThan(0);
  });

  it('routes error level to console.error', async () => {
    const { error: logError } = await import('@/lib/queue/logger');
    logError('boom');
    expect(console.error).toHaveBeenCalled();
    expect(console.log).not.toHaveBeenCalled();
  });

  it('routes warn level to console.warn', async () => {
    const { warn } = await import('@/lib/queue/logger');
    warn('careful');
    expect(console.warn).toHaveBeenCalled();
    expect(console.log).not.toHaveBeenCalled();
  });
});
