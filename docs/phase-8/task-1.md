# Phase 8 — Task 1: Automation Foundation

**Status:** Implemented
**Branch:** `phase-8/task-1-automation-foundation`

## Overview

Task 1 establishes the domain model and event infrastructure for RelayDesk's automation system. It provides the foundation for safe, observable, asynchronous automation execution while reusing the existing transactional outbox, BullMQ worker, and SLA monitoring architecture.

## What This Task Delivers

### 1. Database Schema

Four new models added to `prisma/schema.prisma`:

- **AutomationRule** — workspace-owned configuration for trigger-based rules
- **AutomationExecution** — durable record of each rule evaluation attempt
- **AutomationActionExecution** — durable record of each action attempt within an execution
- **SentSlaBreachNotification** — deduplication marker for SLA breach notifications

Two new enums:
- `AutomationExecutionStatus` — pending, evaluating, awaiting_actions, executing, completed, partial_failure, failed, skipped
- `AutomationActionExecutionStatus` — pending, completed, failed, skipped

### 2. Outbox Event Types

Extended `OutboxEventType` in `src/lib/outbox/types.ts`:
- `AUTOMATION_EVALUATION` — single event type for automation triggers (trigger type encoded in payload)
- `SLA_BREACHED` — semantic domain event for SLA breach

### 3. Domain Event Integration

All domain mutations now emit `AUTOMATION_EVALUATION` outbox events transactionally:

| Domain Mutation | Trigger Type | File |
|----------------|--------------|------|
| `createTicket` | `ticket.created` | `src/lib/tickets/server.ts` |
| `updateTicket` | `ticket.status_changed`, `ticket.priority_changed`, `ticket.customer_linked`, `ticket.customer_unlinked` | `src/lib/tickets/server.ts` |
| `closeTicket` | `ticket.status_changed` | `src/lib/tickets/server.ts` |
| `assignTicket` | `ticket.assigned` | `src/lib/tickets/server.ts` |
| `unassignTicket` | `ticket.unassigned` | `src/lib/tickets/server.ts` |
| `addTagToTicket` | `ticket.tag_added` | `src/lib/tags/server.ts` |
| `removeTagFromTicket` | `ticket.tag_removed` | `src/lib/tags/server.ts` |
| SLA Breach | `sla.breached` | `src/lib/sla/evaluation.ts` |

### 4. Automation Evaluation Handler

`src/lib/queue/handlers/automation.ts` processes `AUTOMATION_EVALUATION` events:

1. **Recursion prevention** — skips events with `causedByAutomation: true`
2. **Rule matching** — queries enabled rules for workspace + trigger type
3. **Condition evaluation** — pure in-memory AND semantics
4. **Execution creation** — auto-commit INSERT with P2002 catch for idempotency
5. **Atomic handoff** — creates all action intents + transitions to `awaiting_actions` in one transaction

### 5. Automation Domain Services

Eight service files under `src/lib/automation/`:

| File | Purpose |
|------|---------|
| `types.ts` | Domain types, trigger type constants |
| `triggers.ts` | Zod schema for trigger types, domain event mapping |
| `conditions.ts` | Condition operators (equals, not_equals, includes, excludes, is_set, is_not_set) |
| `evaluator.ts` | Pure rule matching logic |
| `execution-service.ts` | Execution lifecycle (create, completeHandoff, skipExecution, failExecution) |
| `schema.ts` | Rule config validation |
| `events.ts` | Zod schema for AUTOMATION_EVALUATION payload |
| `outbox.ts` | `queueAutomationEvaluation()` and `queueSemanticDomainEvent()` helpers |

### 6. SLA Breach Integration

`src/lib/sla/breach.ts` provides:
- `claimBreachSlot()` — atomic deduplication marker using `SentSlaBreachNotification`
- `createSlaBreachedOutboxEvent()` — writes `SLA_BREACHED` semantic event

SLA evaluation now emits both `SLA_BREACHED` and `AUTOMATION_EVALUATION` events atomically when a breach is first detected.

## Key Design Decisions

### Single AUTOMATION_EVALUATION Event Type

Rather than separate event types per trigger, we encode the trigger type in the payload. This keeps the handler registry simple and avoids explosion of event types.

### Lease-Based Ownership

Each execution has `leasedBy` + `leasedAt` fields. Workers claim leases before processing. Lease fences prevent stale workers from corrupting state:

```typescript
// Atomic ownership check + update
UPDATE ... SET status = 'awaiting_actions'
WHERE id = X AND leasedBy = Y AND leasedAt > $now
```

### Atomic Handoff

The transition from `evaluating` to `awaiting_actions` happens in a single transaction that also creates all action intents. If any part fails, nothing is committed:

```typescript
await prisma.$transaction(async (tx) => {
  await tx.automationActionExecution.createMany({ data: intents, skipDuplicates: true });
  // Verify count
  // Transition status with lease fence
});
```

### Conflict-Safe Insertion

Following the repository's established pattern from `duplicate-suppression.ts`:
- Auto-commit INSERT outside transaction for execution creation
- P2002 catch + SELECT in fresh context for idempotency

### Application-Computed Timestamps

All lease comparisons use `new Date()` (not PostgreSQL `now()`), consistent with existing `claimNextOutboxEvent`.

## File Changes

### New Files

- `src/lib/automation/types.ts`
- `src/lib/automation/triggers.ts`
- `src/lib/automation/conditions.ts`
- `src/lib/automation/evaluator.ts`
- `src/lib/automation/execution-service.ts`
- `src/lib/automation/schema.ts`
- `src/lib/automation/events.ts`
- `src/lib/automation/outbox.ts`
- `src/lib/automation/context.ts` (helper, retained for future use)
- `src/lib/queue/handlers/automation.ts`
- `src/lib/queue/handlers/sla-breached.ts`
- `src/lib/sla/breach.ts`
- `prisma/migrations/20260918000000_add_automation_foundation/migration.sql`
- `src/__tests__/automation.events.test.ts`
- `src/__tests__/automation.triggers.test.ts`
- `src/__tests__/automation.conditions.test.ts`
- `src/__tests__/automation.evaluator.test.ts`
- `src/__tests__/automation.schema.test.ts`
- `src/__tests__/automation.outbox.test.ts`
- `src/__tests__/sla.breach.test.ts`
- `docs/phase-8/task-1.md`

### Modified Files

- `prisma/schema.prisma` — added 4 models, 2 enums, reverse relations
- `src/lib/outbox/types.ts` — added `AUTOMATION_EVALUATION` and `SLA_BREACHED`
- `src/lib/queue/handlers/registry.ts` — registered new handlers
- `src/lib/tickets/server.ts` — emit automation events for create, update, close, assign, unassign
- `src/lib/tags/server.ts` — emit automation events for tag add/remove
- `src/lib/sla/evaluation.ts` — emit SLA_BREACHED + AUTOMATION_EVALUATION on breach
- `src/__tests__/sla.evaluation.test.ts` — updated for breach behavior
- `src/__tests__/tickets.service.test.ts` — added outboxEvent to mocks
- `src/__tests__/tickets.activity.service.test.ts` — added outboxEvent to mocks
- `src/__tests__/ticket-assignment.service.test.ts` — added outboxEvent to mocks
- `src/__tests__/tags.ticket-tags.service.test.ts` — added outboxEvent to mocks
- `src/__tests__/customer-ticket-linking.test.ts` — added outboxEvent to mocks
- `src/__tests__/sla.integration.test.ts` — updated cleanup for breach notifications

## Test Results

```
Test Files  77 passed (77)
Tests       829 passed (829)
```

Note: Integration tests (`*.integration.test.ts`) require a running PostgreSQL database and are skipped when `DATABASE_URL_TEST` is not configured.

## Next Steps (Task 2+)

Task 1 provides the foundation. Remaining tasks will build on this:

- **Task 2: Automation Rule Management** — CRUD API for automation rules
- **Task 3: Automation Action Execution** — dispatcher/poller, action handlers, lease ownership checks
- **Task 4: Configurable SLA Policies** — workspace SLA configuration UI/API
- **Task 5: Automation Operations & Audit** — execution history, retry, debugging tools

## Migration

The migration file is at `prisma/migrations/20260918000000_add_automation_foundation/migration.sql`. Apply with:

```bash
prisma migrate deploy
```

Or for development:

```bash
prisma migrate dev
```
