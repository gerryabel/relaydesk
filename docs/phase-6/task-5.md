# Phase 6 — Task 5: Retry, Failure Handling & Idempotency

## Objective

Make asynchronous execution resilient to transient failures and safe under duplicate delivery, by defining retry policies, distinguishing retryable from non-retryable errors, and ensuring that every handler with externally visible side effects is idempotent.

This task establishes the **reliability contract** that every job handler depends on. Without it, at-least-once delivery (the Phase 6 target) would cause duplicate emails, duplicate SLA notifications, or other harmful side effects.

## Context

Phase 6 targets **at-least-once** delivery. The system assumes a job can be delivered or executed more than once. Therefore, consumers must be idempotent where duplicate execution could create externally visible side effects.

The codebase currently has:

- BullMQ `Worker` with retry/visibility timeout (Task 1)
- `OutboxEvent` model with `attempts` and `lastError` fields (Task 2)
- Dispatcher that increments `attempts` and sets `lastError` on failure (Task 3)
- Email job handler (Task 4)
- No retry policy, no idempotency mechanism, no failure classification yet

The critical question this task answers: **When a job is executed more than once, how does the system prevent duplicate side effects?**

## Dependencies

- **Task 3 (Worker Runtime & Outbox Dispatching)** — provides the completion/failure handling that this task extends.
- **Task 4 (Email Abstraction & Delivery)** — provides the email job handler that needs idempotency.

## Scope

- Maximum retry count per job type.
- Exponential or explicit backoff strategy.
- Retryable vs non-retryable error classification.
- Failed-job handling (permanent failure path).
- Outbox failure metadata (`attempts`, `lastError`).
- Structured error logging.
- Idempotency guarantees for external side effects.
- Recovery documentation.

## Non-Goals

- Manual operational dashboard for retrying failed jobs.
- Automatic infinite retries.
- Distributed tracing platform.
- Exactly-once execution (not a Phase 6 requirement).

## Current Codebase Integration

The integration surface:

- `src/lib/queue/retry-policy.ts` — new: retry configuration per job type.
- `src/lib/queue/errors.ts` — new: typed errors (`RetryableError`, `NonRetryableError`).
- `src/lib/queue/handlers/base-handler.ts` — new: base handler with idempotency support.
- `src/lib/queue/dispatcher.ts` — extended: use retry policy on handler failure.
- `src/lib/email/send-email.ts` — extended: idempotency check before sending.
- `src/lib/outbox/outbox.ts` — extended: idempotency record helpers.

## Architecture

### Retry policy

Each job type has a configurable retry policy:

```typescript
interface RetryPolicy {
  maxAttempts: number;
  backoffType: 'exponential' | 'fixed';
  backoffDelayMs: number;
  maxBackoffDelayMs: number;
}

const DEFAULT_RETRY_POLICY: RetryPolicy = {
  maxAttempts: 3,
  backoffType: 'exponential',
  backoffDelayMs: 5000,
  maxBackoffDelayMs: 30000,
};
```

Example for email jobs:

```typescript
const EMAIL_RETRY_POLICY: RetryPolicy = {
  maxAttempts: 3,
  backoffType: 'exponential',
  backoffDelayMs: 5000,
  maxBackoffDelayMs: 30000,
};
```

### Backoff calculation

```
attempt 1 → fail → wait 5s
attempt 2 → fail → wait 10s
attempt 3 → fail → wait 20s
attempt 4 → fail → mark as failed (maxAttempts = 3 means 3 retries after initial)
```

The exact values are configurable. BullMQ supports built-in backoff; the policy maps to BullMQ's `attempts` and `backoff` options.

### Error classification

```typescript
class RetryableError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'RetryableError';
  }
}

class NonRetryableError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'NonRetryableError';
  }
}
```

| Error type | Examples | Behavior |
|------------|----------|----------|
| `RetryableError` | Network timeout, rate limit (429), provider 5xx | Retry according to policy |
| `NonRetryableError` | Invalid email, auth failure (401/403), payload validation error | Mark failed immediately, no retry |

### Idempotency mechanism

Every handler with externally visible side effects uses the **outbox event ID** as the idempotency key:

```typescript
async function handleEmailJob(payload: JobPayload): Promise<void> {
  const { outboxEventId } = payload;
  
  // Idempotency check: has this outbox event already been processed?
  const existing = await prisma.outboxEvent.findUnique({
    where: { id: outboxEventId },
    select: { processedAt: true },
  });
  
  if (existing?.processedAt) {
    // Already processed, skip
    return;
  }
  
  // Send email
  await sendEmail(payload.payload);
  
  // Mark complete
  await markOutboxComplete(outboxEventId);
}
```

For email specifically, an additional idempotency layer can be added:

```typescript
// Store a record of sent emails to prevent duplicates
await prisma.sentEmail.create({
  data: {
    outboxEventId,
    recipient: message.to,
    sentAt: new Date(),
  },
});
```

The `outboxEventId` is unique per outbox event, so the `SentEmail` record acts as a durable idempotency marker. Before sending, the handler checks if a `SentEmail` record with the same `outboxEventId` exists.

### Failed job handling

When `attempts >= maxAttempts`:

1. The outbox event is marked with `lastError` and `processedAt` remains null (or set to a sentinel value like a far-future timestamp to indicate permanent failure).
2. A structured error log is emitted with the outbox event ID, job type, and failure reason.
3. No further retries occur automatically.
4. Recovery requires manual intervention (e.g., re-dispatch after fixing the root cause).

### Recovery documentation

A `docs/phase-6/operations.md` (or similar) document describes:

- How to identify failed outbox events (`SELECT * FROM "OutboxEvent" WHERE "processedAt" IS NULL AND attempts >= max`).
- How to retry a failed event (reset `attempts` to 0 and `processedAt` to null, or re-create the BullMQ job).
- When to retry vs when to discard.

## Data Model / Schema Changes

A new `SentEmail` model is introduced to support email idempotency:

```prisma
model SentEmail {
  id             String   @id @default(cuid())
  outboxEventId  String   @unique
  recipient      String
  sentAt         DateTime @default(now())

  @@index([outboxEventId])
}
```

This model is **only** for email idempotency. Other job types may use different idempotency mechanisms (e.g., a `SentSlaNotification` model, or simply the outbox event's `processedAt` timestamp).

## Runtime / Application Changes

| Area | Change |
|------|--------|
| `src/lib/queue/retry-policy.ts` | New — retry configuration |
| `src/lib/queue/errors.ts` | New — typed errors |
| `src/lib/queue/handlers/base-handler.ts` | New — base handler with idempotency |
| `src/lib/queue/dispatcher.ts` | Extended — use retry policy |
| `src/lib/email/send-email.ts` | Extended — idempotency check |
| `src/lib/outbox/outbox.ts` | Extended — idempotency record helpers |
| `prisma/schema.prisma` | Add `SentEmail` model |
| `prisma/migrations/...` | Add migration |
| `docs/phase-6/operations.md` | New — recovery documentation |

## Error Handling

- `RetryableError` triggers retry according to policy.
- `NonRetryableError` triggers immediate failure.
- After `maxAttempts`, the event is marked permanently failed.
- All errors are logged with structured context (outbox event ID, job type, attempt number, error type).

## Security / Authorization

- Idempotency records (`SentEmail`) are scoped to the outbox event, preventing cross-event replay.
- Failed job logs do not include sensitive data (email bodies, tokens).

## Testing Strategy

- **Unit tests**:
  - Retry policy calculates correct backoff delays.
  - `RetryableError` and `NonRetryableError` are correctly classified.
  - Base handler skips execution if idempotency record exists.
- **Integration tests**:
  - Job handler retries on `RetryableError` up to `maxAttempts`.
  - Job handler marks event failed on `NonRetryableError`.
  - Duplicate job execution (same outbox event ID) does not cause duplicate email send.
  - After `maxAttempts`, the event is marked failed and no further retries occur.
- **Regression tests**: All existing Phase 5 tests pass.

## Acceptance Criteria

1. `RetryableError` triggers retry according to the configured policy.
2. `NonRetryableError` marks the outbox event as failed immediately, with no retry.
3. After `maxAttempts` failures, the outbox event is marked permanently failed and no further retries occur.
4. A job executed twice with the same `outboxEventId` does not cause a duplicate email send (idempotency check via `SentEmail` record).
5. Retry backoff delays follow the configured exponential/fixed policy.
6. Failed outbox events are queryable (`processedAt IS NULL AND attempts >= max`).
7. Recovery documentation exists and describes how to retry failed events.
8. All existing Phase 5 tests pass.

## Definition of Done

- All acceptance criteria above are demonstrably true.
- Retry policy is configurable per job type.
- Error classification is implemented and tested.
- Idempotency mechanism works for email jobs.
- `SentEmail` model exists and is used for idempotency.
- Recovery documentation is written.
- All existing tests pass.
- Branch and commit are clean; no unrelated changes.

## Files / Areas Expected to Change

```
src/lib/queue/retry-policy.ts       (new)
src/lib/queue/errors.ts             (new)
src/lib/queue/handlers/base-handler.ts  (new)
src/lib/queue/dispatcher.ts         (extended)
src/lib/email/send-email.ts         (extended)
src/lib/outbox/outbox.ts            (extended)
prisma/schema.prisma                (add SentEmail model)
prisma/migrations/...               (add migration)
docs/phase-6/operations.md          (new)
```

## Implementation Notes

- BullMQ has built-in retry/attempt handling. Use it where possible rather than reinventing it. The `attempts` field on the `OutboxEvent` is for observability and recovery, not for BullMQ's internal retry logic.
- The idempotency check should happen **before** any side effect. For email: check `SentEmail` → send email → create `SentEmail` record. The `SentEmail` creation and outbox completion should be in the same transaction.
- The `maxAttempts` value should be chosen based on the job type. Email: 3-5 attempts. SLA: 2-3 attempts. These are starting points; adjust based on operational experience.
- Non-retryable errors should be rare. If something fails due to a configuration error (missing API key), retrying won't help — mark it failed immediately.
- Do not implement a manual retry dashboard in this task. The recovery documentation should describe manual SQL-based recovery; a dashboard is a future enhancement.
