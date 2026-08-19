# Phase 6 — Task 3: Worker Runtime & Outbox Dispatching

## Objective

Build the reliable bridge between the transactional outbox (Task 2) and the BullMQ worker runtime (Task 1), so that durable outbox events are dispatched to background jobs, executed by idempotent handlers, and marked complete — with a clear recovery path for crashes that occur between claim and completion.

This task is the **core reliability layer** of Phase 6. Every other task (email, retry, SLA, observability) depends on the dispatching contract established here.

## Context

Task 2 gives us durable `OutboxEvent` records in PostgreSQL. Task 1 gives us a Redis/BullMQ connection, queue configuration, and a worker entrypoint with a placeholder handler.

The missing piece is the **dispatcher**: a component that polls pending outbox events, claims them, creates BullMQ jobs, and marks them complete (or failed) after the handler finishes.

The critical failure mode is a crash **between** outbox claim and job completion:

```
OutboxEvent claimed
        ↓
[crash here]
        ↓
Job completed
```

Without a recovery path, the outbox event remains stranded — never completed, never retried.

The codebase currently has:

- BullMQ `Worker` started in `scripts/worker.mjs` (Task 1)
- `OutboxEvent` model with `processedAt`, `attempts`, `lastError` fields (Task 2)
- Shared queue config and connection (Task 1)
- No dispatcher yet, no handler registry, no completion logic

## Dependencies

- **Task 1 (Redis & BullMQ Infrastructure)** — provides connection, queue config, and worker entrypoint.
- **Task 2 (Transactional Outbox Foundation)** — provides the `OutboxEvent` model and schema.

## Scope

- Outbox polling/claiming strategy with crash recovery.
- BullMQ job creation from claimed outbox events.
- Handler registry for routing `eventType` to handler functions.
- Job payload validation.
- Outbox completion/failure handling.
- Worker graceful shutdown.
- Job-level logging with correlation IDs.
- Recovery path for stranded outbox events.

## Non-Goals

- Arbitrary user-defined jobs.
- Dynamic code execution.
- Workflow graphs or DAGs.
- Email-specific logic (Task 4).
- Retry policy (Task 5) — this task establishes the retry **hook**, but the policy (max attempts, backoff) is Task 5.
- SLA scheduling (Task 6).
- Full observability platform (Task 7).

## Current Codebase Integration

The integration surface:

- `src/lib/queue/dispatcher.ts` — new: polls and claims outbox events, creates BullMQ jobs.
- `src/lib/queue/handlers/` — new: handler registry and initial handlers.
- `src/lib/queue/job-types.ts` — new: typed job payloads.
- `scripts/worker.mjs` — modified: replace placeholder handler with real dispatcher + handler registry.
- `src/lib/outbox/outbox.ts` — extended: claim/complete/fail helpers.

## Architecture

### Dispatch flow

```
Pending OutboxEvent (processedAt = null)
        ↓
Dispatcher polls (interval or trigger)
        ↓
Claim: set processedAt = now() + lease, attempts++
        ↓
Create BullMQ job with outbox ID in payload
        ↓
Worker receives job
        ↓
Validate payload
        ↓
Route eventType → handler
        ↓
Execute handler
        ↓
On success: mark OutboxEvent.processedAt = now()
On failure: increment attempts, set lastError
```

### Claiming strategy

The dispatcher uses a **lease-based claim**:

1. Query for pending events: `processedAt = null OR processedAt < now()` (the latter recovers stranded events).
2. For each event, atomically claim it by setting `processedAt` to a future lease timestamp (e.g., `now() + 5 minutes`) and incrementing `attempts`.
3. Use a conditional `updateMany` with `where: { id, processedAt: null }` to prevent double-claiming across concurrent dispatchers.
4. If the claim succeeds, create a BullMQ job with the outbox event ID in the payload.

### Crash recovery

If the dispatcher crashes **after** claiming but **before** creating the BullMQ job:

- The event has `processedAt` set to a future lease timestamp.
- On the next poll, the dispatcher sees `processedAt < now()` (lease expired) and re-claims it.
- The event is not lost; it's retried.

If the worker crashes **after** the BullMQ job is created but **before** completion:

- BullMQ's built-in retry/visibility timeout returns the job to the queue.
- The handler re-executes. Idempotency (Task 5) prevents duplicate side effects.
- The outbox event remains uncompleted until the handler succeeds or retries are exhausted.

### Handler registry

```typescript
type Handler = (payload: JobPayload) => Promise<void>;

const handlers: Record<string, Handler> = {
  TICKET_ASSIGNED: handleTicketAssigned,
  TICKET_CREATED: handleTicketCreated,
  // ...
};
```

Handlers are plain async functions. They receive a typed payload and return void. Side effects (email, SLA evaluation) are implemented in later tasks.

### Job payload

```typescript
interface JobPayload {
  outboxEventId: string;
  eventType: string;
  aggregateType: string;
  aggregateId: string;
  payload: Record<string, unknown>;
  attempt: number;
}
```

The `outboxEventId` is the idempotency key — handlers use it to detect duplicate execution (Task 5).

### Completion semantics

- **Success**: `UPDATE OutboxEvent SET processedAt = now() WHERE id = ?`
- **Failure (retryable)**: `UPDATE OutboxEvent SET attempts = attempts + 1, lastError = ?, processedAt = null WHERE id = ?`
- **Failure (permanent)**: `UPDATE OutboxEvent SET attempts = attempts + 1, lastError = ?, processedAt = failed_marker WHERE id = ?` (Task 5 defines the policy)

The dispatcher **never** marks an event complete before the handler returns successfully.

## Data Model / Schema Changes

None. This task uses the `OutboxEvent` model from Task 2 as-is.

## Runtime / Application Changes

| Area | Change |
|------|--------|
| `src/lib/queue/dispatcher.ts` | New — polling, claiming, job creation |
| `src/lib/queue/handlers/registry.ts` | New — handler registry |
| `src/lib/queue/handlers/types.ts` | New — handler type definitions |
| `src/lib/queue/job-types.ts` | New — job payload types |
| `src/lib/outbox/outbox.ts` | Extended — claim/complete/fail helpers |
| `scripts/worker.mjs` | Modified — real handler replaces placeholder |

## Error Handling

- **Claim failure**: If the conditional `updateMany` returns 0 rows, another dispatcher claimed the event first. Skip it.
- **BullMQ enqueue failure**: The event remains claimed with a future lease. The next poll re-claims it (lease expired) and retries the enqueue.
- **Handler failure**: The outbox event's `attempts` is incremented and `lastError` is set. The event remains pending for retry (Task 5 defines the retry policy).
- **Handler timeout**: If a handler hangs, the BullMQ job visibility timeout eventually returns it to the queue. The lease-based claim ensures the outbox event is not permanently stranded.

## Security / Authorization

- Job payloads carry `aggregateType` and `aggregateId` but **not** workspace ID directly. The `payload` includes `workspaceId` (set in Task 2).
- Handlers resolve authoritative records from the database using stable identifiers and verify expected ownership/relationships before performing sensitive work.
- No arbitrary code execution — handlers are registered functions, not dynamic imports.

## Testing Strategy

- **Unit tests**:
  - Handler registry routes `eventType` to the correct handler.
  - Job payload validation rejects malformed payloads.
  - Claim helper sets `processedAt` and increments `attempts` atomically.
- **Integration tests**:
  - Dispatcher claims a pending outbox event and creates a BullMQ job.
  - Dispatcher does not claim an already-claimed event (lease not expired).
  - Dispatcher re-claims a stranded event (lease expired).
  - Worker executes the correct handler for a given `eventType`.
  - On handler success, the outbox event is marked `processedAt = now()`.
  - On handler failure, the outbox event's `attempts` is incremented and `lastError` is set.
- **Regression tests**: All existing Phase 5 tests pass.

Tests use the existing Vitest + test database setup. BullMQ is tested against the Redis instance provisioned in Task 1.

## Acceptance Criteria

1. A pending `OutboxEvent` is claimed by the dispatcher and a BullMQ job is created with the correct `outboxEventId` in the payload.
2. A claimed `OutboxEvent` (lease not expired) is **not** re-claimed by a concurrent dispatcher.
3. A stranded `OutboxEvent` (lease expired) is re-claimed and re-dispatched.
4. The worker routes `eventType` to the correct handler via the registry.
5. On handler success, the `OutboxEvent.processedAt` is set to a non-null timestamp.
6. On handler failure, the `OutboxEvent.attempts` is incremented and `lastError` is set.
7. A crash between claim and job creation does not permanently orphan the outbox event — it is recovered on the next poll.
8. The worker shuts down gracefully (finishes in-flight jobs, closes connections) on `SIGINT`/`SIGTERM`.
9. All existing Phase 5 tests pass.

## Definition of Done

- All acceptance criteria above are demonstrably true.
- Dispatcher polls, claims, and dispatches outbox events.
- Handler registry routes events to handlers.
- Completion/failure handling updates the outbox event correctly.
- Crash recovery path is documented and tested.
- All existing tests pass.
- Branch and commit are clean; no unrelated changes.

## Files / Areas Expected to Change

```
src/lib/queue/dispatcher.ts         (new)
src/lib/queue/handlers/registry.ts  (new)
src/lib/queue/handlers/types.ts     (new)
src/lib/queue/job-types.ts          (new)
src/lib/outbox/outbox.ts            (extended)
scripts/worker.mjs                  (modified)
```

## Implementation Notes

- The dispatcher can be implemented as a simple interval-based poll (e.g., every 5 seconds) for now. A more sophisticated trigger (e.g., PostgreSQL `LISTEN/NOTIFY`) is optional and should only be added if the simple poll proves insufficient.
- The lease duration should be configurable but default to 5 minutes. This gives enough time for the handler to complete while ensuring stranded events are recovered promptly.
- The conditional `updateMany` for claiming is critical — it prevents double-claiming across concurrent dispatchers. Use `where: { id, processedAt: null }` for new events and `where: { id, processedAt: { lt: now } }` for stranded events.
- The handler registry is a simple `Record<string, Handler>`. Do not over-engineer it with decorators, dependency injection, or plugin systems.
- The initial handlers can be minimal — they just need to prove the dispatch→execute→complete loop works. Task 4 and Task 6 will add real handlers for email and SLA.
- Do **not** implement retry policy (max attempts, backoff) in this task. Task 5 owns that. This task only increments `attempts` and sets `lastError`.
