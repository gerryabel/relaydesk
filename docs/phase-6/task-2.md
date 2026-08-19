# Phase 6 — Task 2: Transactional Outbox Foundation

## Objective

Create a durable, PostgreSQL-backed outbox that records asynchronous work **atomically** with the domain mutations that produce it, so that no asynchronous intent is ever lost due to a Redis or worker failure after the database transaction commits.

This task introduces the `OutboxEvent` schema, the transaction helper pattern, and the integration points into existing Phase 5 mutations. It does **not** implement dispatching, workers, email, or SLA scheduling.

## Context

Phase 5 performs important mutations transactionally. For example, `assignTicket` in `src/lib/tickets/server.ts` runs inside `prisma.$transaction` and writes:

- `Ticket` update
- `TicketActivity` record
- `Notification` record (when applicable)

The missing piece is a durable record that says "this mutation requires asynchronous follow-up." Without it, any downstream work (email, SLA evaluation) has no reliable trigger.

The architecture decision (see `docs/phase-6/spec.md`) is **Transactional Outbox**:

```
Domain mutation
+ relevant activity/notification state
+ OutboxEvent
        ↓
ONE DATABASE TRANSACTION
        ↓
COMMIT
        ↓
Outbox Dispatcher (Task 3)
        ↓
BullMQ / Redis (Task 1)
        ↓
Worker (Task 3)
```

PostgreSQL remains the source of truth. Redis/BullMQ is only a transport layer.

The codebase currently has:

- Prisma 7 with PostgreSQL adapter
- `prisma.$transaction` pattern used in ticket mutations
- `TicketActivity` as an audit/history mechanism (complementary to, not replaced by, OutboxEvent)
- No `OutboxEvent` model yet

## Dependencies

- **Task 1 (Redis & BullMQ Infrastructure)** — not strictly required for this task's code, but the outbox is meaningless without a downstream transport. Schema and transaction work can proceed in parallel with Task 1, but integration testing of the full path requires Task 1.

## Scope

- Add `OutboxEvent` model to `prisma/schema.prisma`.
- Create the initial migration.
- Define event types and aggregate types as enums or string constants.
- Create a transaction helper/pattern for writing outbox events alongside domain mutations.
- Integrate outbox writes into at least one existing Phase 5 mutation (e.g., ticket assignment) as a proving ground.
- Define indexes for efficient pending-event queries.
- Document the transaction flow and recovery implications.

## Non-Goals

- Event sourcing — `TicketActivity` remains the audit log; `OutboxEvent` is only for async intent.
- Full domain event bus.
- Cross-database distributed transactions.
- Rebuilding all existing `TicketActivity` records as outbox events.
- Dispatching logic (Task 3), email jobs (Task 4), retry policy (Task 5), SLA scheduling (Task 6).

## Current Codebase Integration

The integration surface:

- `prisma/schema.prisma` — new `OutboxEvent` model.
- `prisma/migrations/` — new migration.
- `src/lib/outbox/` — new directory for outbox helpers and types.
- `src/lib/tickets/server.ts` — extend `assignTicket` (and optionally `updateTicket`/`closeTicket`) to write an `OutboxEvent` inside the same transaction.
- `src/generated/prisma/` — regenerated client (via `prisma generate`).

The existing `Notification` creation path is **not** replaced. In-app notifications remain synchronous; the outbox is for **asynchronous** follow-up only.

## Architecture

### OutboxEvent model

```prisma
model OutboxEvent {
  id            String    @id @default(cuid())
  eventType     String
  aggregateType String
  aggregateId   String
  payload       Json
  createdAt     DateTime  @default(now())
  processedAt   DateTime?
  attempts       Int       @default(0)
  lastError     String?

  @@index([processedAt, createdAt])
  @@index([aggregateType, aggregateId])
}
```

### Processing state (implicit)

The model uses timestamps and counters rather than an explicit status enum:

| State | processedAt | attempts | Meaning |
|-------|-------------|----------|---------|
| pending | null | 0 | Not yet dispatched |
| in-flight | null | >0 | Dispatched, not yet completed |
| processed | not null | any | Successfully completed |
| failed | null | >= max | Exhausted retries (Task 5) |

This is intentionally simple. If a later task requires an explicit status enum, that change is scoped to that task.

### Event types (initial)

```
TICKET_CREATED
TICKET_ASSIGNED
TICKET_REPLIED
TICKET_RESOLVED
SLA_AT_RISK
```

These map to the events that Phase 6 integrations actually need. Do not add speculative event types.

### Aggregate types

```
Ticket
```

Extensible to `Customer`, `Message`, etc., if later tasks require it.

### Transaction pattern

```typescript
await prisma.$transaction(async (tx) => {
  // 1. Domain mutation
  const updated = await tx.ticket.update({ ... });

  // 2. Audit activity
  await tx.ticketActivity.create({ ... });

  // 3. Synchronous notification (if applicable)
  await tx.notification.create({ ... });

  // 4. Outbox event (if async work is required)
  await tx.outboxEvent.create({
    data: {
      eventType: 'TICKET_ASSIGNED',
      aggregateType: 'Ticket',
      aggregateId: updated.id,
      payload: { ... },
    },
  });
});
```

The critical invariant: **if the transaction commits, the outbox event exists. If the transaction rolls back, the outbox event does not exist.**

### Idempotency identity

Every `OutboxEvent` has a stable `id` (cuid). This `id` is propagated into the BullMQ job payload in Task 3, enabling downstream handlers to detect and suppress duplicate side effects (Task 5).

### Ordering

Default processing order is chronological by `createdAt` (enforced by the `@@index([processedAt, createdAt])`). No partitioning or complex stream semantics.

## Data Model / Schema Changes

| Change | Type | Description |
|--------|------|-------------|
| `OutboxEvent` model | New | Durable async intent record |
| `eventType` field | String | Discriminator for handler routing |
| `aggregateType` field | String | Entity type for correlation |
| `aggregateId` field | String | Entity ID for correlation |
| `payload` field | Json | Job-specific data |
| `createdAt` field | DateTime | Processing order |
| `processedAt` field | DateTime? | Completion marker |
| `attempts` field | Int | Retry counter |
| `lastError` field | String? | Last failure reason |
| `@@index([processedAt, createdAt])` | Index | Pending-event query |
| `@@index([aggregateType, aggregateId])` | Index | Aggregate lookup |

## Runtime / Application Changes

| Area | Change |
|------|--------|
| `prisma/schema.prisma` | Add `OutboxEvent` model |
| `prisma/migrations/...` | Add migration |
| `src/lib/outbox/types.ts` | New — event type constants, payload types |
| `src/lib/outbox/outbox.ts` | New — helper to write outbox events |
| `src/lib/tickets/server.ts` | Extend `assignTicket` to write outbox event |
| `src/generated/prisma/` | Regenerated client |

## Error Handling

- Outbox write failure **inside** the transaction causes the entire transaction to roll back — this is correct behavior, not a bug.
- Outbox write failure **outside** the transaction (e.g., dispatcher error) is handled in Task 3.
- The `lastError` field captures the last failure reason for observability (Task 7).

## Security / Authorization

- Outbox events carry `aggregateType` and `aggregateId` but **not** workspace ID directly. The `payload` should include `workspaceId` so the worker can enforce authorization boundaries (Task 3).
- No sensitive data (passwords, tokens) in `payload`.

## Testing Strategy

- **Unit tests**: Outbox helper writes an event with correct fields.
- **Integration tests**:
  - Domain mutation + outbox transaction atomicity: when the transaction commits, both the domain change and the outbox event exist.
  - No outbox record on transaction rollback: when the transaction fails, neither the domain change nor the outbox event exists.
  - Outbox event carries correct `eventType`, `aggregateType`, `aggregateId`, and `payload`.
- **Regression tests**: All existing Phase 5 tests must continue to pass.

Tests use the existing Vitest + test database setup (`src/__tests__/setup.ts`).

## Acceptance Criteria

1. `OutboxEvent` model exists in `prisma/schema.prisma` with all fields and indexes specified above.
2. Migration is generated and applies cleanly (`prisma migrate dev`).
3. `prisma generate` succeeds and the `OutboxEvent` client types are available.
4. When `assignTicket` runs successfully, an `OutboxEvent` with `eventType: 'TICKET_ASSIGNED'` exists in the database with the correct `aggregateId` and `payload`.
5. When the transaction inside `assignTicket` rolls back (e.g., due to a simulated error after the outbox write), **no** `OutboxEvent` remains in the database.
6. The `OutboxEvent` `id` is a valid cuid and is unique per event.
7. The `@@index([processedAt, createdAt])` index exists and is used by the pending-event query (verified via `EXPLAIN` or Prisma logs).
8. All existing Phase 5 tests pass.

## Definition of Done

- All acceptance criteria above are demonstrably true.
- Migration is committed and applies cleanly on a fresh database.
- `prisma generate` output is committed (if the project commits generated code).
- Outbox helper and types are unit-tested.
- At least one existing Phase 5 mutation (`assignTicket`) writes an outbox event.
- All existing tests pass.
- Branch and commit are clean; no unrelated changes.

## Files / Areas Expected to Change

```
prisma/schema.prisma                (add OutboxEvent model)
prisma/migrations/<name>/migration.sql  (new migration)
src/lib/outbox/types.ts             (new)
src/lib/outbox/outbox.ts            (new)
src/lib/tickets/server.ts           (extend assignTicket)
src/generated/prisma/               (regenerated)
```

## Implementation Notes

- Use `cuid()` for `id` (consistent with existing models).
- Use `Json` for `payload` (consistent with `TicketActivity.metadata`).
- The `eventType` field is a `String`, not a Prisma enum, to avoid migration churn when adding new event types in later tasks. If the project prefers enums, document the choice.
- The initial integration point is `assignTicket` because it's the clearest example of a mutation that requires async follow-up (email notification to the assignee). Other mutations (`updateTicket`, `closeTicket`) can be extended in later tasks.
- Do **not** replace `TicketActivity` with `OutboxEvent`. They serve different purposes: activity is audit history, outbox is async intent.
- Do **not** add dispatching logic. The outbox write is the only change to the mutation path.
