# Phase 6 — Task 6: SLA Background Processing

## Objective

Use the new asynchronous infrastructure (outbox + worker) to perform background evaluation of SLA-at-risk tickets — the behavior that Phase 5 explicitly deferred because no scheduler/job infrastructure existed.

This task implements the **SLA evaluation job** that runs on a schedule, identifies tickets approaching SLA thresholds, and emits notifications through the outbox. It reuses the existing SLA calculation logic from `src/lib/tickets/sla.ts`.

## Context

Phase 5 introduced SLA fields (`responseSlaDeadline`, `resolutionSlaDeadline`) and calculation functions (`getSlaMonitoringStatus`, `getResponseSlaMonitoringStatus`, `getResolutionSlaMonitoringStatus`), but deferred `SLA_AT_RISK` notifications because there was no background scheduler.

The codebase currently has:

- `Ticket` model with `responseSlaDeadline`, `resolutionSlaDeadline`, `firstResponseAt`, `resolvedAt` fields
- `src/lib/tickets/sla.ts` with `getResponseSlaMonitoringStatus()` and `getResolutionSlaMonitoringStatus()` functions
- `AT_RISK_THRESHOLD_RATIO = 0.8` (80% of SLA duration elapsed = at-risk)
- Outbox + worker infrastructure (Tasks 1–3)
- No SLA scheduler, no SLA evaluation job

The key requirement: **Browser polling, request-time polling, and UI timers MUST NOT be used as the authoritative SLA scheduler.** The scheduler must run from the worker/background infrastructure.

## Dependencies

- **Task 1 (Redis & BullMQ Infrastructure)** — provides the queue transport.
- **Task 2 (Transactional Outbox Foundation)** — provides the durable async intent.
- **Task 3 (Worker Runtime & Outbox Dispatching)** — provides the handler registry and job execution.
- **Task 5 (Retry, Failure Handling & Idempotency)** — provides retry policy and idempotency for the SLA job.

## Scope

- Scheduled background evaluation using BullMQ delayed/repeatable jobs.
- Identification of tickets approaching SLA thresholds using existing SLA domain rules.
- At-risk event generation (outbox event creation).
- Notification/outbox integration (in-app notification + optional email).
- Duplicate-event suppression (a ticket entering the same at-risk window repeatedly must not generate unbounded notifications).
- Failure/retry behavior.

## Non-Goals

- Configurable SLA policy editor.
- Business-hours calendar.
- Holiday calendar.
- Escalation policy engine.
- Multiple policy hierarchy.
- SLA policy recommendation or optimization.

## Current Codebase Integration

The integration surface:

- `src/lib/sla/scheduler.ts` — new: SLA evaluation scheduler setup.
- `src/lib/sla/evaluation.ts` — new: SLA at-risk detection logic.
- `src/lib/sla/duplicate-suppression.ts` — new: duplicate suppression strategy.
- `src/lib/queue/handlers/sla.ts` — new: SLA evaluation job handler.
- `src/lib/notifications/server.ts` — extended: SLA-at-risk notification creation.
- `scripts/worker.mjs` — extended: register SLA repeatable job.

The existing `src/lib/tickets/sla.ts` is **not** modified. This task reuses its functions.

## Architecture

### Scheduling

The SLA evaluation runs on a schedule using BullMQ's repeatable jobs:

```typescript
await queue.add(
  'SLA_EVALUATION',
  {},
  {
    repeat: {
      pattern: '*/5 * * * *', // every 5 minutes
    },
  }
);
```

The exact interval is configurable. The initial default is every 5 minutes — frequent enough to catch at-risk tickets promptly, infrequent enough to avoid excessive database load.

### Evaluation logic

The evaluation job:

1. Queries all active tickets (`status NOT IN ('resolved', 'closed')`) with non-null SLA deadlines.
2. For each ticket, calls `getResponseSlaMonitoringStatus()` and `getResolutionSlaMonitoringStatus()` (from `src/lib/tickets/sla.ts`).
3. If either status is `'at_risk'`, checks duplicate suppression.
4. If not suppressed, creates an outbox event with `eventType: 'SLA_AT_RISK'`.

### Duplicate suppression

A ticket entering the same at-risk window repeatedly must not generate unbounded notifications. The suppression strategy:

- A `SentSlaNotification` model records each SLA-at-risk notification with `ticketId`, `slaType` ('response' | 'resolution'), and `sentAt`.
- Before creating a new SLA-at-risk notification, the evaluator checks if a `SentSlaNotification` record exists for the same `ticketId` + `slaType` within a suppression window (e.g., 24 hours).
- If a record exists, the notification is suppressed.
- If the ticket's SLA status changes to `breached` or `completed`, the suppression record is cleared (allowing future at-risk notifications if the ticket re-enters the at-risk state).

### Notification flow

```
SLA evaluation job runs (every 5 min)
        ↓
Query active tickets with SLA deadlines
        ↓
For each ticket, calculate SLA status
        ↓
If at_risk and not suppressed:
        ↓
Create OutboxEvent (SLA_AT_RISK)
        ↓
Worker dispatches SLA_AT_RISK job
        ↓
Handler creates in-app Notification
        ↓
Handler optionally creates email OutboxEvent
        ↓
Mark SentSlaNotification record
```

### SLA-at-risk notification content

```
Title: SLA at risk
Body: Ticket #{ticketId} is approaching its {response/resolution} SLA deadline.
```

The notification is created for the ticket's assignee (`assignedToId`). If the ticket is unassigned, the notification is skipped (or sent to the workspace owner, depending on implementation).

## Data Model / Schema Changes

A new `SentSlaNotification` model is introduced to support duplicate suppression:

```prisma
model SentSlaNotification {
  id        String   @id @default(cuid())
  ticketId  String
  slaType   String   // 'response' | 'resolution'
  sentAt    DateTime @default(now())

  @@unique([ticketId, slaType])
  @@index([ticketId])
}
```

The `@@unique([ticketId, slaType])` constraint ensures at most one suppression record per ticket per SLA type.

## Runtime / Application Changes

| Area | Change |
|------|--------|
| `src/lib/sla/scheduler.ts` | New — SLA evaluation scheduler setup |
| `src/lib/sla/evaluation.ts` | New — SLA at-risk detection logic |
| `src/lib/sla/duplicate-suppression.ts` | New — duplicate suppression strategy |
| `src/lib/queue/handlers/sla.ts` | New — SLA evaluation job handler |
| `src/lib/notifications/server.ts` | Extended — SLA-at-risk notification creation |
| `scripts/worker.mjs` | Extended — register SLA repeatable job |
| `prisma/schema.prisma` | Add `SentSlaNotification` model |
| `prisma/migrations/...` | Add migration |

## Error Handling

- If the SLA evaluation job fails, it retries according to the retry policy (Task 5).
- If a ticket's SLA calculation throws (e.g., missing deadline), the ticket is skipped and the error is logged.
- If duplicate suppression check fails, the notification is skipped (fail-safe: no duplicate notifications).

## Security / Authorization

- SLA evaluation only considers tickets in the evaluator's workspace scope (the worker resolves tickets from the database, not from client input).
- SLA-at-risk notifications are only created for agents who are members of the ticket's workspace.

## Testing Strategy

- **Unit tests**:
  - `getSlaMonitoringStatus()` correctly identifies at-risk tickets (reuse existing tests in `src/__tests__/tickets.sla.test.ts`).
  - Duplicate suppression logic correctly suppresses repeated notifications.
  - Duplicate suppression logic allows notifications after the suppression window expires.
- **Integration tests**:
  - SLA evaluation job identifies at-risk tickets and creates outbox events.
  - SLA evaluation job does not create duplicate notifications for the same ticket within the suppression window.
  - SLA-at-risk handler creates an in-app notification for the assignee.
  - SLA evaluation job skips resolved/closed tickets.
- **Regression tests**: All existing Phase 5 tests pass.

## Acceptance Criteria

1. The SLA evaluation job runs on a schedule (every 5 minutes by default) using BullMQ repeatable jobs.
2. The evaluation job identifies tickets with `getSlaMonitoringStatus() === 'at_risk'` and creates `SLA_AT_RISK` outbox events.
3. The evaluation job does **not** create duplicate `SLA_AT_RISK` notifications for the same ticket within the suppression window.
4. The SLA-at-risk handler creates an in-app notification for the ticket's assignee.
5. The evaluation job skips resolved and closed tickets.
6. The evaluation job retries on failure according to the retry policy.
7. The `SentSlaNotification` model records each notification and enforces the suppression window.
8. All existing Phase 5 tests pass.

## Definition of Done

- All acceptance criteria above are demonstrably true.
- SLA evaluation job runs on schedule and creates outbox events.
- Duplicate suppression works correctly.
- SLA-at-risk handler creates in-app notifications.
- `SentSlaNotification` model exists and is used for suppression.
- All existing tests pass.
- Branch and commit are clean; no unrelated changes.

## Files / Areas Expected to Change

```
src/lib/sla/scheduler.ts            (new)
src/lib/sla/evaluation.ts           (new)
src/lib/sla/duplicate-suppression.ts (new)
src/lib/queue/handlers/sla.ts       (new)
src/lib/notifications/server.ts     (extended)
scripts/worker.mjs                  (extended)
prisma/schema.prisma                (add SentSlaNotification model)
prisma/migrations/...               (add migration)
```

## Implementation Notes

- Reuse `getResponseSlaMonitoringStatus()` and `getResolutionSlaMonitoringStatus()` from `src/lib/tickets/sla.ts`. Do not duplicate the calculation logic.
- The evaluation job should query tickets in batches (e.g., 100 at a time) to avoid loading all active tickets into memory at once.
- The suppression window (default 24 hours) should be configurable.
- The SLA-at-risk notification should include the ticket ID and SLA type in the body so the agent knows which deadline is at risk.
- Do **not** implement a configurable SLA policy editor or business-hours calendar. The existing `DEFAULT_SLA_POLICIES` in `src/lib/tickets/sla.ts` is the only policy source.
- The SLA evaluation job should be idempotent — running it multiple times should not create duplicate notifications (enforced by `SentSlaNotification`).
