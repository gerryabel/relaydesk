# Phase 6 — Task 5: Retry, Failure Handling & Idempotency

## Objective

Make asynchronous execution resilient to transient failures and safe under duplicate delivery.
This task defines the retry contract, error classification, durable failure state, and the idempotency mechanism for handlers with externally visible side effects.

## Architecture

```text
OutboxEvent
  ↓
Dispatcher
  ↓
BullMQ job
  ↓
Worker
  ↓
Email handler
  ↓
EmailProvider
  ↓
External side effect
```

## Retry Policy

### Maximum Attempts

- Email jobs: **3 attempts**
- Default jobs: **3 attempts**

### Backoff Strategy

- Type: **exponential**
- Base delay: **5s**
- Max delay: **30s**

Delay sequence:

- attempt 1 → fail → wait **5s**
- attempt 2 → fail → wait **10s**
- attempt 3 → fail → wait **20s**
- attempt 4 → fail → stop retrying

### Where It Is Enforced

- BullMQ queue options: `attempts` and `backoff`
- Worker path: handler failure is recorded into `OutboxEvent`
- Outbox path: `attempts` and `lastError` are updated on every failure

BullMQ attempts are the transport-level retry budget.
Outbox attempts are the durable recovery state.
They are not independently authoritative forever; the worker records outbox state on every execution.

## Error Classification

### Retryable

- temporary provider outage
- network timeout
- temporary connection failure
- rate limit / transient provider response
- email provider transient failures (`retryable_failure`, `invalid_message`)

### Permanent

- invalid recipient
- malformed email / invalid configuration
- unsupported event type
- missing required domain record where recovery cannot fix it
- authorization/validation failure

## Outbox Failure State

Task 5 extends outbox failure helpers without redesigning Task 3/4.

| Helper | Behavior |
|--------|----------|
| `markOutboxEventProcessed` | `processedAt = now()`, `lastError = null` |
| `recordOutboxFailure` | if `PermanentError` → finalize failed state; else → `processedAt = null`, increment attempts, set `lastError` |
| `markOutboxEventPermanentlyFailed` | `processedAt` set to sentinel, `lastError` prefixed with `[task-5:permanent-failure]` |

Important invariant:
ticket/domain state changes are **not reverted** when async delivery fails.

Example:
- Ticket resolved ✅
- Email delivery ❌ retryable → outbox remains pending for retry
- Email delivery ❌ permanent → outbox marked failed, ticket remains resolved

## Idempotency

### Identity

`outboxEventId` is the stable logical operation identity.

### Durable State

`SentEmail` record:
- `outboxEventId` unique
- `recipient`
- `sentAt`

### Duplicate Detection

Before calling the provider, the handler checks `SentEmail` by `outboxEventId`.
If present, the handler returns success without sending again.

### Crash Window Limitation

There is an unavoidable window:
provider succeeds → worker crashes before `SentEmail` and outbox completion are committed.

In that case:
- retry may cause a duplicate external send
- this is accepted because Phase 6 targets **at-least-once**, not exactly-once
- the application-level mechanism prevents duplicates in the non-crash path

## Logging

Structured logs are emitted for:
- retryable failure with attempt count and backoff
- permanent failure with error code
- successful completion

Never logged:
- API keys
- SMTP passwords
- provider secrets
- full confidential email bodies

## Recovery

Exhausted retry events can be recovered manually:
- inspect failed outbox events
- reset attempts if root cause is fixed
- do not perform manual database surgery for ordinary transient failures

## Development/Test Behavior

- default provider: `console`
- tests verify:
  - provider invoked
  - provider skipped due to idempotency
  - retryable error
  - permanent error
  - successful delivery
  - duplicate suppression

## Security

- worker resolves authoritative ticket/user records from PostgreSQL
- outbox payload contains `workspaceId`; handlers enforce workspace boundaries
- no arbitrary client IDs are trusted
- no secrets are logged

## Why Exactly-Once Is Not Claimed

The system targets at-least-once delivery.
Duplicate BullMQ jobs, worker crashes, and provider retries can all cause duplicate external side effects.
The `SentEmail` record prevents duplicates when the local state persists, but cannot prevent duplicates if the worker crashes after the provider sends and before the local record is written.

## Database / Migration

New migration:
- `prisma/migrations/20260908100000_add_sent_email_idempotency`
- adds `SentEmail` table with unique `outboxEventId`

## Implementation Files

- `src/lib/queue/retry-policy.ts`
- `src/lib/queue/errors.ts`
- `src/lib/queue/worker.ts`
- `src/lib/queue/dispatcher.ts`
- `src/lib/queue/handlers/email-handler.ts`
- `src/lib/outbox/outbox.ts`
- `prisma/schema.prisma`
- `src/__tests__/task-5-retry-idempotency.test.ts`
- `src/__tests__/retry-policy.test.ts`
- docs/phase-6/task-5.md
