/**
 * Structured logger for the async outbox/worker infrastructure.
 *
 * A thin wrapper around console output that emits one JSON object per line.
 * No external logging framework.
 *
 * Correlation chain:
 *   OutboxEvent.id -> job payload.outboxEventId -> log context.outboxEventId
 *
 * Every job-scoped log line carries outboxEventId, jobId, eventType, and
 * attempt so a single outbox event is traceable from creation through
 * dispatch to completion/failure.
 *
 * Attempt semantics (see docs/phase-6/operations.md):
 *   - Worker/handler logs use BullMQ Job.attemptsMade (0-indexed processing
 *     attempt counter — the authoritative source for the current attempt).
 *   - Dispatcher logs use the OutboxEvent.attempts claim count (1-indexed,
 *     incremented at each claim). Both are linked by outboxEventId.
 */

export type LogLevel = 'debug' | 'info' | 'warn' | 'error';

/**
 * Composable log context. Known fields are typed; arbitrary extra fields are
 * permitted so callers can attach domain data without extending this type.
 */
export interface LogContext {
  workerId?: string;
  outboxEventId?: string;
  jobId?: string;
  eventType?: string;
  attempt?: number;
  durationMs?: number;
  [key: string]: unknown;
}

/**
 * Keys whose values may contain credentials. Matched case-insensitively
 * against any key segment so nested objects are also sanitized.
 */
const SENSITIVE_KEY_PATTERNS = [
  'password',
  'secret',
  'token',
  'apikey',
  'api_key',
  'authorization',
  'connectionstring',
  'connection_string',
  'redis_url',
  'database_url',
  'access_token',
  'refresh_token',
  'id_token',
];

let workerId: string | null = null;

/**
 * Override the worker identifier (e.g. with the stable BullMQ Worker.id).
 * Must be called before the first log if you want a deterministic id.
 */
export function setWorkerId(id: string): void {
  workerId = id;
}

/**
 * Returns the process-local worker identifier, generating one on first use.
 * Format: worker-<pid>-<random>. Not globally unique, but stable for the
 * lifetime of the process — enough to correlate logs from one worker.
 */
export function getWorkerId(): string {
  if (!workerId) {
    workerId = generateWorkerId();
  }
  return workerId;
}

function generateWorkerId(): string {
  const pid = process.pid;
  const rand = Math.random().toString(36).slice(2, 10);
  return `worker-${pid}-${rand}`;
}

function isSensitiveKey(key: string): boolean {
  const lower = key.toLowerCase();
  return SENSITIVE_KEY_PATTERNS.some((pattern) => lower.includes(pattern));
}

/**
 * Sanitize a single value: redact sensitive keys, serialize Errors into
 * { message, stack } so they survive JSON.stringify.
 */
function sanitizeValue(key: string, value: unknown): unknown {
  if (isSensitiveKey(key)) {
    return '[REDACTED]';
  }

  if (value instanceof Error) {
    return {
      name: value.name,
      message: value.message,
      ...(value.stack ? { stack: value.stack } : {}),
    };
  }

  return value;
}

/**
 * Produce a sanitized, JSON-safe copy of the context. Sensitive keys are
 * redacted; Error instances are flattened.
 */
function sanitizeContext(context: LogContext): Record<string, unknown> {
  const result: Record<string, unknown> = {};

  for (const [key, value] of Object.entries(context)) {
    if (value === undefined) {
      continue;
    }

    if (typeof value === 'object' && value !== null && !(value instanceof Error)) {
      // Shallow sanitize nested objects (e.g. { error: new Error(...) }).
      const nested: Record<string, unknown> = {};
      for (const [nKey, nValue] of Object.entries(value as Record<string, unknown>)) {
        nested[nKey] = sanitizeValue(nKey, nValue);
      }
      result[key] = nested;
    } else {
      result[key] = sanitizeValue(key, value);
    }
  }

  return result;
}

/**
 * Emit one structured log line. Pure serialization — no level filtering,
 * no external sinks. Operators filter by the `level` field downstream.
 */
export function log(level: LogLevel, message: string, context: LogContext = {}): void {
  const entry: Record<string, unknown> = {
    timestamp: new Date().toISOString(),
    level,
    workerId: getWorkerId(),
    ...sanitizeContext(context),
    message,
  };

  const line = JSON.stringify(entry);

  switch (level) {
    case 'error':
      console.error(line);
      break;
    case 'warn':
      console.warn(line);
      break;
    default:
      console.log(line);
  }
}

export function debug(message: string, context: LogContext = {}): void {
  log('debug', message, context);
}

export function info(message: string, context: LogContext = {}): void {
  log('info', message, context);
}

export function warn(message: string, context: LogContext = {}): void {
  log('warn', message, context);
}

export function error(message: string, context: LogContext = {}): void {
  log('error', message, context);
}
