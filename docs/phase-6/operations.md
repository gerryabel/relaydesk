# Phase 6 — Operations Guide

This guide is for a developer or operator who has never worked on Phase 6 and needs to diagnose an outage, inspect the worker, or recover stuck events. It covers the outbox + worker infrastructure end-to-end.

---

## 1. Architecture Overview

RelayDesk uses a **transactional outbox** pattern with a **BullMQ worker**:

1. Application code writes an `OutboxEvent` row inside the same database transaction as the business change (e.g. ticket assignment).
2. A background **dispatcher** polls for unclaimed outbox events, claims one (setting a lease deadline), and enqueues a BullMQ job.
3. A **worker** processes the job through a registered handler (email send, SLA notification, etc.).
4. On success the event is marked `completedAt`. On retryable failure the lease is released (`processedAt = null`) so the dispatcher re-claims it. On permanent failure `failedAt` is set.

```
[App transaction] -> OutboxEvent row
                          |
                   [dispatcher poll]
                          |
                    BullMQ job (Redis)
                          |
                   [worker process]
                          |
              handler (email / SLA / ...)
```

### Key components

| Component | File | Role |
|-----------|------|------|
| Outbox store | `src/lib/outbox/outbox.ts` | Create, claim, complete, fail events |
| Dispatcher | `src/lib/queue/dispatcher.ts` | Poll + enqueue |
| Worker entrypoint | `scripts/worker.mjs` | Process jobs, run scheduler |
| Job processor | `src/lib/queue/worker.ts` | Parse job, invoke handler |
| Handler registry | `src/lib/queue/handlers/registry.ts` | Map eventType -> handler |
| Structured logger | `src/lib/queue/logger.ts` | JSON logs with correlation IDs |
| Diagnostics | `src/lib/queue/diagnostics.ts` | Redis + queue health |
| Recovery helpers | `src/lib/queue/recovery.ts` | Stale event classification |

---

## 2. Starting the Worker

### Development

```bash
npm run worker
```

This runs `scripts/worker.mjs` via `tsx`, loading `.env` automatically.

### Production

Run the same command in a process manager (systemd, PM2, Docker, etc.):

```bash
tsx scripts/worker.mjs
```

Required environment variables:

| Variable | Purpose |
|----------|---------|
| `DATABASE_URL` | PostgreSQL connection string |
| `REDIS_URL` | Redis connection string |
| `DISPATCH_INTERVAL_MS` | Outbox poll interval in ms (default `5000`) |

### What happens at startup

1. **Redis ping** — fails fast if Redis is unreachable.
2. **Diagnostics** — logs Redis ping latency, connection state, queue health, and selected Redis INFO fields. These are informational; a diagnostics failure does not block startup.
3. **Startup recovery** — queries for stranded outbox events (`attempts > 0`, `processedAt = null`) and logs their count and IDs. **Does not re-dispatch them automatically** (avoids thundering herd).
4. **SLA scheduler registration** — registers the recurring SLA evaluation job via BullMQ's idempotent `upsertJobScheduler`. Fails fast if registration fails.
5. **Worker starts** — begins processing jobs and dispatching outbox events.

---

## 3. Stopping the Worker

### Graceful shutdown

Send `SIGTERM` or `SIGINT` (Ctrl+C):

```bash
kill -TERM <pid>
# or
Ctrl+C
```

The worker:

1. Stops the dispatcher poll timer.
2. Waits for any in-flight dispatch to finish.
3. Closes the BullMQ worker (waits for active jobs to complete).
4. Closes the Redis connection.
5. Exits.

### Process signals

| Signal | Behavior |
|--------|----------|
| `SIGTERM` | Graceful shutdown |
| `SIGINT` | Graceful shutdown |
| `uncaughtException` | Logs the error, shuts down with exit code 1 |
| `unhandledRejection` | Logs the reason, shuts down with exit code 1 |

---

## 4. Reading Structured Logs

Every log line is a single JSON object written to stdout/stderr. Fields:

```json
{
  "timestamp": "2026-09-12T00:00:00.000Z",
  "level": "info",
  "workerId": "worker-12345-abcdef12",
  "outboxEventId": "outbox-123",
  "jobId": "bullmq-job-456",
  "eventType": "TICKET_ASSIGNED",
  "attempt": 0,
  "message": "Job completed successfully",
  "durationMs": 150
}
```

| Field | Present when | Description |
|-------|--------------|-------------|
| `timestamp` | Always | ISO-8601 timestamp |
| `level` | Always | `debug`, `info`, `warn`, or `error` |
| `workerId` | Always | Process-local worker identifier |
| `outboxEventId` | Job-scoped logs | The OutboxEvent.id — the correlation key |
| `jobId` | Job-scoped logs | BullMQ job id |
| `eventType` | Job-scoped logs | e.g. `TICKET_ASSIGNED`, `SLA_AT_RISK` |
| `attempt` | Job-scoped logs | See [Attempt semantics](#attempt-semantics) |
| `durationMs` | Completion/failure logs | Handler execution time |
| `message` | Always | Human-readable description |

### Attempt semantics

There are two attempt counters in the system. They answer different questions:

| Counter | Source | Meaning | Used in |
|---------|--------|---------|---------|
| `Job.attemptsMade` | BullMQ runtime | Number of **processing** attempts so far (0 on first try). Authoritative for "how many times has this job been processed". | Worker and handler logs |
| `OutboxEvent.attempts` | Database, incremented at each **claim** | Number of times the event was claimed for dispatch. Always >= 1 once dispatched. | Dispatcher logs, recovery queries |

Both are linked by `outboxEventId`. When tracing an event through its lifecycle, filter on `outboxEventId` and read `attempt` in context of which component emitted the log.

### Filtering logs

Using `jq`:

```bash
# All logs for one outbox event
npm run worker 2>&1 | jq 'select(.outboxEventId == "outbox-123")'

# All logs for one BullMQ job
npm run worker 2>&1 | jq 'select(.jobId == "bullmq-job-456")'

# All errors
npm run worker 2>&1 | jq 'select(.level == "error")'

# All job-scoped logs (have outboxEventId)
npm run worker 2>&1 | jq 'select(.outboxEventId != null)'

# Failed jobs with their event context
npm run worker 2>&1 | jq 'select(.message == "Job failed after exhausting retries")'
```

---

## 5. Inspecting the Outbox

Connect to the PostgreSQL database and run the queries below. Table and column names match the Prisma schema exactly.

### Pending events (never dispatched)

```sql
SELECT id, "eventType", "createdAt", attempts
FROM "OutboxEvent"
WHERE "processedAt" IS NULL
  AND "failedAt" IS NULL
  AND "completedAt" IS NULL
  AND attempts = 0
ORDER BY "createdAt" ASC;
```

### Stranded events (claimed but not completed — past failures)

```sql
SELECT id, "eventType", attempts, "lastError", "createdAt"
FROM "OutboxEvent"
WHERE "processedAt" IS NULL
  AND "failedAt" IS NULL
  AND "completedAt" IS NULL
  AND attempts > 0
ORDER BY "createdAt" ASC;
```

### Currently leased (actively being processed)

```sql
SELECT id, "eventType", attempts, "processedAt"
FROM "OutboxEvent"
WHERE "processedAt" > now()
  AND "failedAt" IS NULL
  AND "completedAt" IS NULL
ORDER BY "processedAt" ASC;
```

### Expired leases (lease deadline passed without completion)

```sql
SELECT id, "eventType", attempts, "processedAt", "lastError"
FROM "OutboxEvent"
WHERE "processedAt" <= now()
  AND "processedAt" IS NOT NULL
  AND "failedAt" IS NULL
  AND "completedAt" IS NULL
ORDER BY "processedAt" ASC;
```

### Permanently failed events

```sql
SELECT id, "eventType", attempts, "failedAt", "lastError", "createdAt"
FROM "OutboxEvent"
WHERE "failedAt" IS NOT NULL
ORDER BY "failedAt" DESC;
```

### Completed events

```sql
SELECT id, "eventType", "completedAt", "createdAt"
FROM "OutboxEvent"
WHERE "completedAt" IS NOT NULL
ORDER BY "completedAt" DESC
LIMIT 100;
```

### Summary counts

```sql
SELECT
  COUNT(*) FILTER (
    WHERE "processedAt" IS NULL AND attempts = 0
    AND "failedAt" IS NULL AND "completedAt" IS NULL
  ) AS pending,
  COUNT(*) FILTER (
    WHERE "processedAt" IS NULL AND attempts > 0
    AND "failedAt" IS NULL AND "completedAt" IS NULL
  ) AS stranded,
  COUNT(*) FILTER (
    WHERE "processedAt" > now()
    AND "failedAt" IS NULL AND "completedAt" IS NULL
  ) AS active_leases,
  COUNT(*) FILTER (
    WHERE "processedAt" <= now() AND "processedAt" IS NOT NULL
    AND "failedAt" IS NULL AND "completedAt" IS NULL
  ) AS expired_leases,
  COUNT(*) FILTER (
    WHERE "failedAt" IS NOT NULL
  ) AS failed,
  COUNT(*) FILTER (
    WHERE "completedAt" IS NOT NULL
  ) AS completed
FROM "OutboxEvent";
```

---

## 6. Inspecting Failed Events

Failed events have `failedAt IS NOT NULL`. They are **terminal** — the worker will not retry them automatically.

To inspect:

```sql
SELECT id, "eventType", attempts, "failedAt", "lastError"
FROM "OutboxEvent"
WHERE "failedAt" IS NOT NULL
ORDER BY "failedAt" DESC
LIMIT 50;
```

The `lastError` column contains the error message prefixed with `[task-5:permanent-failure]` for permanent failures.

---

## 7. Manual Recovery Procedure

### Stranded events (most common)

Stranded events have `attempts > 0` and `processedAt IS NULL`. They were claimed and then had their lease released by a retryable failure. **The dispatcher will naturally re-claim them on its next poll** because the claim query includes `processedAt IS NULL`.

If they are not being re-claimed, verify:

1. The worker is running: check process status and logs.
2. The dispatcher is polling: look for `"No outbox event available for dispatch"` logs (normal when idle) vs. dispatcher errors.
3. The event is not excluded by another condition: `failedAt IS NULL` and `completedAt IS NULL`.

### Expired leases

Expired leases have `processedAt <= now()` and `processedAt IS NOT NULL`. The claim query includes `processedAt < now()`, so the dispatcher will re-claim them. If a worker crashed mid-processing, the lease eventually expires and the event is re-claimed.

### Permanently failed events

These require operator decision. To retry a permanently failed event, clear the terminal state:

```sql
-- Re-enable a permanently failed event for re-dispatch.
-- WARNING: understand why it failed first (see lastError).
UPDATE "OutboxEvent"
SET "failedAt" = NULL,
    "processedAt" = NULL,
    attempts = 0,
    "lastError" = NULL
WHERE id = '<outbox-event-id>';
```

**Do not blindly reset failed events.** Read `lastError` first. If the failure was due to a transient issue (provider timeout, network error), resetting is safe. If it was a permanent data problem (missing recipient, invalid payload), fix the underlying data first.

### What NOT to do

- **Do not** set `processedAt = null` on a large number of events at once — this causes the dispatcher to enqueue many jobs simultaneously (thundering herd).
- **Do not** delete `OutboxEvent` rows to "clear the queue" — this loses audit history and may leave side effects undelivered.
- **Do not** run `KEYS *` or `SCAN` in production Redis — use `infra:check` and the documented SQL queries instead.
- **Do not** reset `failedAt` on events whose `lastError` indicates a permanent data issue without fixing the data first.

---

## 8. Redis Diagnostics

### Run the infra check

```bash
npm run infra:check
```

This reports:

- PostgreSQL connection status
- Redis connection status + ping latency (ms)
- Redis connection state (status, host, port)
- Redis INFO (version, uptime, clients, memory)
- Queue health: waiting, active, completed, failed, delayed counts

### Interpreting output

| Output | Meaning |
|--------|---------|
| `PostgreSQL: OK` | Database reachable |
| `Redis: OK (ping X.XX ms)` | Redis reachable, latency in ms |
| `Redis connection: {"status":"ready",...}` | ioredis connection state |
| `Queue "relaydesk-primary": waiting=0 active=0 ...` | Job counts per state |
| `Queue warning: N failed job(s)` | Failed jobs exist — investigate |

### Manual Redis inspection

```bash
redis-cli PING
redis-cli INFO server
redis-cli INFO memory
redis-cli INFO stats
```

**Avoid** `KEYS *` in production. BullMQ keys are namespaced and can be inspected with `SCAN` if absolutely necessary, but the queue health counts from `infra:check` are the recommended view.

---

## 9. Common Failure Scenarios

### Redis unavailable

- **Symptom**: Worker exits immediately at startup with `"Failed to connect to Redis during startup"`.
- **Fix**: Start/restart Redis. Verify `REDIS_URL` is correct.
- **Impact**: No jobs processed, no outbox events dispatched. Events accumulate as pending in the database (safe — they are durably stored).

### Worker crash

- **Symptom**: Worker process exits. Active jobs are abandoned by BullMQ.
- **Fix**: Restart the worker. BullMQ will retry jobs that were being processed (up to the configured `attempts`).
- **Outbox impact**: Events being processed when the worker crashed have `processedAt` set to a future lease deadline. Once the deadline passes, the dispatcher re-claims them.

### Provider failure (email)

- **Symptom**: Handler logs `"Job failed with retryable error"`. Event has `attempts > 0`, `processedAt = null`, `lastError` set.
- **Fix**: Transient provider failures self-heal via retry. Persistent failures eventually exhaust retries and become permanent (`failedAt` set).
- **Permanent failure**: Read `lastError`. Fix the underlying issue (e.g. missing assignee email) and reset the event if appropriate.

### Duplicate execution

- **Idempotency**: The email handler checks for an existing `SentEmail` with status `SENT` before sending. The SLA handler uses `outboxEventId` as a unique key on `Notification` (P2002 = safe no-op).
- **Impact**: At-least-once delivery is safe. At-most-once is guaranteed by idempotency checks within handlers.

---

## 10. Retry and Idempotency Behavior

### Retry policy

Configured in `src/lib/queue/retry-policy.ts`:

| Setting | Value |
|---------|-------|
| `maxAttempts` | 3 |
| `backoffType` | exponential |
| `backoffDelayMs` | 5000 |
| `maxBackoffDelayMs` | 30000 |

Jobs are retried up to 3 times with exponential backoff (5s, 10s, 20s, capped at 30s).

### Error classification

Errors are classified as **retryable** or **permanent**:

- **Retryable**: network timeouts, provider rate limits, transient failures. The outbox event's lease is released (`processedAt = null`) so it can be re-claimed.
- **Permanent**: invalid payload, missing recipient, authentication failures. The outbox event is marked `failedAt` (terminal).

Classification happens in `src/lib/queue/errors.ts` (provider errors) and in each handler (domain errors).

### Idempotency

Handlers must be idempotent because BullMQ guarantees at-least-once delivery:

- **Email handler** (`src/lib/queue/handlers/email-handler.ts`): checks `SentEmail` for an existing `SENT` record before sending.
- **SLA handler** (`src/lib/queue/handlers/sla.ts`): uses `outboxEventId` as a unique key on `Notification`. A P2002 unique-constraint violation means the notification already exists — returns success as a safe no-op.

---

## 11. Useful SQL Queries

All queries use the actual Prisma schema table and column names.

### Recent outbox activity (last 24h)

```sql
SELECT
  "eventType",
  COUNT(*) FILTER (WHERE "completedAt" IS NOT NULL) AS completed,
  COUNT(*) FILTER (WHERE "failedAt" IS NOT NULL) AS failed,
  COUNT(*) FILTER (
    WHERE "processedAt" IS NULL AND attempts = 0
    AND "failedAt" IS NULL AND "completedAt" IS NULL
  ) AS pending,
  COUNT(*) FILTER (
    WHERE "processedAt" IS NULL AND attempts > 0
    AND "failedAt" IS NULL AND "completedAt" IS NULL
  ) AS stranded
FROM "OutboxEvent"
WHERE "createdAt" > now() - interval '24 hours'
GROUP BY "eventType";
```

### Events stuck for more than 1 hour (any non-terminal state)

```sql
SELECT id, "eventType", attempts, "createdAt", "processedAt", "lastError"
FROM "OutboxEvent"
WHERE "failedAt" IS NULL
  AND "completedAt" IS NULL
  AND "createdAt" < now() - interval '1 hour'
ORDER BY "createdAt" ASC;
```

### Oldest pending event

```sql
SELECT id, "eventType", "createdAt"
FROM "OutboxEvent"
WHERE "processedAt" IS NULL
  AND "failedAt" IS NULL
  AND "completedAt" IS NULL
  AND attempts = 0
ORDER BY "createdAt" ASC
LIMIT 1;
```

### Failed events by error pattern

```sql
SELECT
  "lastError",
  COUNT(*) AS count,
  MIN("failedAt") AS first_failed,
  MAX("failedAt") AS last_failed
FROM "OutboxEvent"
WHERE "failedAt" IS NOT NULL
GROUP BY "lastError"
ORDER BY count DESC;
```

---

## 12. Infrastructure Tests

Phase 6 includes focused tests for the operational infrastructure:

| Test file | Coverage |
|-----------|----------|
| `src/__tests__/logger.test.ts` | Logger JSON output, required fields, context propagation, error serialization |
| `src/__tests__/diagnostics.test.ts` | Redis ping latency, info parsing, queue health, connection state |
| `src/__tests__/recovery.test.ts` | Pending, stranded, active lease, expired lease, failed, completed classification |
| `src/__tests__/worker.logging.test.ts` | Structured startup/shutdown logging, job log correlation fields |
| `src/__tests__/dispatcher.logging.test.ts` | Dispatch, no-event, enqueue-failure logging |

Run all tests:

```bash
npm test
```

---

## 13. Operational Checklist

When paged about an outage:

1. **Is the worker running?** Check process status and recent logs.
2. **Is Redis reachable?** Run `npm run infra:check`.
3. **Is PostgreSQL reachable?** `infra:check` reports this too.
4. **Are there stranded events?** Run the stranded-events SQL query above.
5. **Are there failed events?** Run the failed-events SQL query. Read `lastError`.
6. **Is the queue backed up?** Check `waiting` count in `infra:check` output.
7. **Trace a specific event**: filter logs by `outboxEventId`.
