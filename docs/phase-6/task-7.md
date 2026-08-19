# Phase 6 — Task 7: Operational Hardening & Observability

## Objective

Make the asynchronous infrastructure (outbox + worker) diagnosable and safe to operate, by adding structured logging, correlation IDs, Redis diagnostics, stale outbox recovery, and operational documentation.

This task is the **final hardening pass** for Phase 6. It ensures that when something goes wrong in production — and something eventually will — the operator can answer: *Which event? Which job? How many attempts? Why did it fail? Can it be safely retried?*

## Context

After Tasks 1–6, RelayDesk has:

- A running worker process (`scripts/worker.mjs`)
- Outbox dispatching with crash recovery (Task 3)
- Email jobs with idempotency (Tasks 4–5)
- SLA evaluation with duplicate suppression (Task 6)
- Retry policy with error classification (Task 5)

But the infrastructure is still **blind**. There is no structured logging, no correlation IDs, no stale outbox recovery, no Redis diagnostics, and no operational documentation.

The codebase currently has:

- Basic `console.log` in the worker entrypoint (Task 1)
- `attempts` and `lastError` fields on `OutboxEvent` (Task 2)
- No structured logging framework
- No correlation IDs in job payloads
- No stale outbox recovery beyond the lease-based claim (Task 3)
- No operational documentation

## Dependencies

- **Task 1 (Redis & BullMQ Infrastructure)** — provides the worker entrypoint that needs logging.
- **Task 3 (Worker Runtime & Outbox Dispatching)** — provides the dispatcher and handler registry that need correlation IDs.
- **Task 5 (Retry, Failure Handling & Idempotency)** — provides the failed-job handling that needs visibility.

## Scope

- Structured worker logging (JSON format recommended).
- Correlation IDs propagated through outbox → job → handler.
- Outbox event IDs and job attempt numbers in every log line.
- Redis connectivity diagnostics (ping, latency, connection state).
- Worker startup/shutdown logging.
- Stale/pending outbox recovery strategy (events stranded with `attempts > 0` and `processedAt = null`).
- Operational documentation (how to start/stop/inspect/recover the worker).
- Failure visibility (querying failed events, alerting on persistent failures).
- Infrastructure-focused testing (logging, diagnostics, recovery).

## Non-Goals

- Full observability platform (Prometheus, Grafana, OpenTelemetry).
- Distributed tracing product.
- Complex metrics warehouse.
- Manual operational dashboard.
- Automatic failure remediation.

## Current Codebase Integration

The integration surface:

- `src/lib/queue/logger.ts` — new: structured logger with correlation IDs.
- `src/lib/queue/diagnostics.ts` — new: Redis and worker diagnostics.
- `src/lib/queue/recovery.ts` — new: stale outbox recovery helpers.
- `src/lib/queue/dispatcher.ts` — extended: log dispatch events with correlation IDs.
- `src/lib/queue/handlers/base-handler.ts` — extended: log handler execution with correlation IDs.
- `scripts/worker.mjs` — extended: use structured logger, log startup/shutdown.
- `docs/phase-6/operations.md` — new (or extend from Task 5): operational documentation.
- `scripts/infra-check.mjs` — extended: add Redis diagnostics.

## Architecture

### Structured logging

All worker and dispatcher logs use a consistent JSON structure:

```json
{
  "timestamp": "2026-08-19T10:30:00.000Z",
  "level": "info",
  "workerId": "worker-1",
  "outboxEventId": "outbox-abc123",
  "jobId": "bullmq-job-456",
  "eventType": "TICKET_ASSIGNED",
  "attempt": 2,
  "message": "Job completed successfully",
  "durationMs": 150
}
```

The logger is a thin wrapper around `console.log`/`console.error` that formats logs as JSON. No external logging library is required for Phase 6.

### Correlation IDs

The correlation chain:

```
OutboxEvent.id → Job payload.outboxEventId → Log context.outboxEventId
```

Every log line within a job handler includes `outboxEventId`, `jobId`, `eventType`, and `attempt`. This makes it possible to trace a single outbox event from creation through dispatch to completion/failure.

### Redis diagnostics

A `diagnostics.ts` module provides:

- `pingRedis(): Promise<number>` — returns ping latency in ms.
- `getRedisInfo(): Promise<object>` — returns Redis server info (version, memory, connections).
- `getQueueHealth(queueName): Promise<object>` — returns queue depth, waiting jobs, active jobs, failed jobs.

These are exposed through `scripts/infra-check.mjs` and optionally through a simple HTTP endpoint in the web process (if the project adds a healthcheck route).

### Stale outbox recovery

Three categories of stale events can occur:

| Category | Condition | Recovery |
|----------|-----------|----------|
| **Never dispatched** | `processedAt = null AND attempts = 0` | Dispatcher picks it up on next poll |
| **Stranded (claim without completion)** | `processedAt = null AND attempts > 0 AND lastError IS NOT NULL` | Dispatcher re-claims after lease expiry |
| **Lease expired** | `processedAt < now() AND processedAt IS NOT NULL` | Dispatcher re-claims |

The lease-based claim (Task 3) handles most cases. This task adds:

- A `recovery.ts` module with helper functions to query each category.
- A startup recovery pass in the worker: when the worker starts, it queries for stranded events and logs them (or optionally re-dispatches them).
- Operational documentation explaining how to manually recover each category.

### Operational documentation

`docs/phase-6/operations.md` covers:

1. **Starting the worker**: `npm run worker` (development), production deployment instructions.
2. **Stopping the worker**: `Ctrl+C` / `SIGTERM` — graceful shutdown behavior.
3. **Inspecting the worker**: key log fields, how to filter by `outboxEventId` or `jobId`.
4. **Inspecting the outbox**: SQL queries for pending, failed, and stale events.
5. **Recovering failed events**: how to retry or discard.
6. **Redis diagnostics**: how to run `infra:check`, what the output means.
7. **Common failure scenarios**: Redis unavailable, worker crash, provider failure, duplicate execution.

## Data Model / Schema Changes

None. This task uses existing models (`OutboxEvent`, `SentEmail`, `SentSlaNotification`).

## Runtime / Application Changes

| Area | Change |
|------|--------|
| `src/lib/queue/logger.ts` | New — structured logger |
| `src/lib/queue/diagnostics.ts` | New — Redis and queue diagnostics |
| `src/lib/queue/recovery.ts` | New — stale outbox recovery helpers |
| `src/lib/queue/dispatcher.ts` | Extended — structured logging |
| `src/lib/queue/handlers/base-handler.ts` | Extended — structured logging |
| `scripts/worker.mjs` | Extended — structured logging, startup recovery |
| `scripts/infra-check.mjs` | Extended — Redis diagnostics |
| `docs/phase-6/operations.md` | New — operational documentation |

## Error Handling

- Diagnostic failures (e.g., Redis ping timeout) are logged but do not crash the worker.
- Recovery helpers are idempotent — running them multiple times has no harmful side effects.
- Structured logging includes error stack traces for unexpected failures.

## Security / Authorization

- Logs do not include sensitive data (email bodies, tokens, Redis credentials).
- Diagnostic output (Redis info) is logged at `debug` level to avoid leaking internal details.

## Testing Strategy

- **Unit tests**:
  - Logger produces valid JSON with required fields.
  - Diagnostics module correctly reports Redis ping latency.
  - Recovery helpers correctly identify each stale event category.
- **Integration tests**:
  - Worker startup logs a structured startup message.
  - Worker shutdown logs a structured shutdown message.
  - Each job handler log line includes `outboxEventId`, `jobId`, `eventType`, and `attempt`.
  - Infra check reports Redis health status.
- **Regression tests**: All existing Phase 5 tests pass.

## Acceptance Criteria

1. All worker/dispatcher/handler logs are structured JSON with `timestamp`, `level`, `outboxEventId`, `jobId`, `eventType`, `attempt`, and `message` fields.
2. A single outbox event can be traced from creation through dispatch to completion/failure by filtering logs on `outboxEventId`.
3. `scripts/infra-check.mjs` reports Redis ping latency, queue depth, and connection status.
4. On worker startup, stranded outbox events (`attempts > 0`, `processedAt = null`) are logged with their count and IDs.
5. Operational documentation (`docs/phase-6/operations.md`) covers starting, stopping, inspecting, and recovering the worker.
6. Recovery SQL queries for pending, failed, and stale events are documented.
7. All existing Phase 5 tests pass.

## Definition of Done

- All acceptance criteria above are demonstrably true.
- Structured logging is used throughout the worker, dispatcher, and handlers.
- Redis diagnostics are implemented and accessible via `infra-check`.
- Stale outbox recovery helpers are implemented and documented.
- Operational documentation is complete.
- All existing tests pass.
- Branch and commit are clean; no unrelated changes.

## Files / Areas Expected to Change

```
src/lib/queue/logger.ts             (new)
src/lib/queue/diagnostics.ts        (new)
src/lib/queue/recovery.ts           (new)
src/lib/queue/dispatcher.ts         (extended)
src/lib/queue/handlers/base-handler.ts  (extended)
scripts/worker.mjs                  (extended)
scripts/infra-check.mjs             (extended)
docs/phase-6/operations.md          (new)
```

## Implementation Notes

- The structured logger should be a single function (e.g., `log(level, message, context)`) that writes JSON to stdout. No need for a full logging framework.
- The correlation ID chain is the most important observability feature. Ensure every log line within a job handler includes `outboxEventId`.
- Redis diagnostics should be lightweight — a simple `ping` and `info` command. Avoid expensive operations like `KEYS *`.
- The stale outbox recovery query should be efficient: `SELECT COUNT(*) FROM "OutboxEvent" WHERE "processedAt" IS NULL AND attempts > 0`. Add appropriate indexes if needed.
- Operational documentation should be written for a developer who has never worked on Phase 6 and needs to diagnose a production issue at 3 AM.
- Do **not** build a Prometheus exporter, Grafana dashboard, or distributed tracing system. Structured logs + SQL queries are sufficient for Phase 6.
- The startup recovery pass should log but not automatically re-dispatch stranded events — automatic re-dispatch can cause thundering herd issues. Document the manual recovery path instead.
