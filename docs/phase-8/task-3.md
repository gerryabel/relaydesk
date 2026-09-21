# Phase 8 — Task 3: Automation Action Execution

**Status:** Implemented
**Branch:** `phase-8/task-3-automation-action-execution`

## Overview

Task 3 connects the Task 1 automation foundation (rule matching, execution records, action intents) to the actual execution of configured actions. It delivers worker-safe, idempotent, sequentially-ordered execution of all eight Phase 8 action types using the existing transactional outbox + BullMQ infrastructure.

## Architectural Decisions

### Use the Existing Pipeline

Per the spec (section 3.1, "Existing Infrastructure First"), Task 3 reuses:
- The existing `outboxEvent` table (no new action-execution table for events)
- The existing outbox dispatcher
- The existing BullMQ queue and worker
- The existing retry/recovery infrastructure

There is no second automation queue, no separate job runner, no parallel worker system, and no database polling loop. Action execution is driven by `AUTOMATION_ACTION_EXECUTION` outbox events, identical in shape to `AUTOMATION_EVALUATION`.

### One New Outbox Event Type

A single `AUTOMATION_ACTION_EXECUTION` event drives all action executions. The `actionIndex` in the payload identifies which action is being executed. This mirrors the `AUTOMATION_EVALUATION` pattern of encoding variant data in the payload rather than exploding the type enum.

### Sequential Execution via Outbox Chaining

Actions execute strictly in order (`actionIndex` 0, 1, 2, ...). The mechanism:

1. **First action** — created transactionally with the handoff in `completeHandoff()` (Task 1's execution-service.ts, modified).
2. **Subsequent actions** — when an action reaches a terminal state (completed or failed), the executor creates the next `AUTOMATION_ACTION_EXECUTION` outbox event for `actionIndex + 1` in the same transaction.
3. **Finalization** — when no next action exists, the executor aggregates all action states and transitions the execution to its terminal status.

This guarantees:
- Each action runs at most once (the outbox event is created only after the previous action is terminal).
- A crash between action N and action N+1 is recoverable — the already-committed outbox event for action N+1 will be dispatched when the worker restarts.
- No polling is required — the dispatcher drives everything.

### Crash-Safe Finalization

The finalization query uses `updateMany` with a `WHERE status = 'awaiting_actions'` filter so concurrent calls are race-safe — exactly one call succeeds, the other returns `count: 0` and reports `finalized: false`.

## What This Task Delivers

### 1. Action Schemas and Validation

`src/lib/automation/actions/schema.ts`:
- Zod schemas for all eight action types
- `validateActionConfig(actionType, config)` — returns `{ valid: true }` or `{ valid: false, error }`
- `AUTOMATION_ACTION_TYPES` constant union

### 2. Action Types and Context

`src/lib/automation/actions/types.ts`:
- `ActionContext` — executionId, workspaceId, ticketId, actionIndex, actionType, actionConfig, automationContext
- `ActionResult` — `{ status: 'completed', summary?, ... }`
- `ActionPermanentFailure` — `{ status: 'failed', error }`
- `ActionTransientFailure` — `{ status: 'retryable', error }`
- `ActionHandler` — `(ctx, tx) => Promise<ActionResult | ActionPermanentFailure | ActionTransientFailure>`

### 3. Action Handlers

`src/lib/automation/actions/handlers.ts` — eight handlers registered in `ACTION_HANDLERS`:

| Handler | Natural Idempotency Check | Workspace Boundary |
|---------|--------------------------|--------------------|
| `assignHandler` | ticket already assigned to target | assignee must be workspace member |
| `unassignHandler` | ticket already unassigned | n/a |
| `setStatusHandler` | ticket already in status | validates transition |
| `setPriorityHandler` | ticket already at priority | n/a |
| `addTagHandler` | ticket already has tag | tag must belong to workspace |
| `removeTagHandler` | ticket doesn't have tag | n/a |
| `internalNoteHandler` | dedupe key match | author must be workspace member (if specified) |
| `notificationHandler` | dedupe key match | recipient must be workspace member |

### 4. Action Execution Engine

`src/lib/automation/actions/execution.ts`:

- `executeAction(executionId, actionIndex)` — loads the action intent, validates config, runs the handler, persists the terminal result, schedules the next action or finalizes the execution. Single transaction.
- `scheduleNextOrFinalize(tx, executionId, currentActionIndex, ...)` — creates the next `AUTOMATION_ACTION_EXECUTION` outbox event or calls `finalizeExecution`.
- `finalizeExecution(tx, executionId)` — aggregates all action states using `updateMany ... WHERE status = 'awaiting_actions'` for race safety.
- `findNextPendingAction`, `loadActions`, `queueAutomationActionExecution` — shared helpers.

### 5. Queue Handler

`src/lib/queue/handlers/automation-action.ts` — `handleAutomationActionExecution`:
- Loads the execution and verifies it's in `awaiting_actions` state
- Calls `executeAction`
- Re-throws transient failures as `RetryableError` so BullMQ retries with backoff
- Permanent failures are returned as success (the outbox event is consumed, the action is recorded as failed)

### 6. Worker-Safe Domain APIs

Two new worker-safe helpers that do not depend on `getCurrentMembership()` or HTTP session context:

- `src/lib/internal-notes/automation.ts` — `createAutomationInternalNote()` accepts explicit `authorId`, `workspaceId`, `dedupeKey`. Prefixes the body with `[Automation]`.
- `src/lib/notifications/automation.ts` — `createAutomationNotification()` accepts explicit `recipientId`, `workspaceId`, `ticketId`, `dedupeKey`. Prefixes the title with `[Automation]`.

### 7. Deduplication Columns

Added `automationDedupeKey String? @unique` to both `InternalNote` and `Notification` models. The unique constraint guarantees at-most-once creation even under concurrent redelivery.

Migration: `prisma/migrations/20260921000000_add_automation_action_execution/migration.sql`.

### 8. Recursion Prevention

All automation-generated events carry `causedByAutomation: true` in the `AutomationContext`. The `AUTOMATION_EVALUATION` handler (Task 1) already skips events with this flag, so automation-triggered state changes never re-enter the rule-matching pipeline.

## Execution Semantics

### Status Aggregation

| Action States | Execution Status |
|---------------|------------------|
| all completed | `completed` |
| some completed, some failed | `partial_failure` |
| all failed | `failed` |

### Failure Handling

| Failure Type | Behavior |
|--------------|----------|
| Transient (network, lock) | Throw `RetryableError` → BullMQ retries with exponential backoff. Action stays `pending`. |
| Permanent (invalid config, nonexistent assignee, cross-workspace resource, invalid transition) | Record action as `failed`, create next outbox event in same transaction, return success. |

A permanently failed action never blocks later actions — the next outbox event is created regardless of whether the current action succeeded or failed.

### Idempotency

- **Redelivery** — if `executeAction` is called for an action already in `completed` or `failed` state, it returns immediately with `detail: 'already-completed'` or `detail: 'already-failed'`. No new outbox event is created.
- **State-setting actions** — natural idempotency (check desired state before mutating).
- **Append-only actions** — deduplication key (`executionId:actionIndex`) enforced by unique constraint.

## File Changes

### New Files

- `src/lib/automation/actions/schema.ts` — Zod schemas for all 8 action types
- `src/lib/automation/actions/types.ts` — ActionContext, ActionResult, handler types
- `src/lib/automation/actions/handlers.ts` — 8 action handlers + registry
- `src/lib/automation/actions/execution.ts` — executeAction, finalizeExecution, scheduleNextOrFinalize
- `src/lib/automation/actions/index.ts` — barrel exports
- `src/lib/queue/handlers/automation-action.ts` — outbox handler for AUTOMATION_ACTION_EXECUTION
- `src/lib/internal-notes/automation.ts` — worker-safe internal note creation
- `src/lib/notifications/automation.ts` — worker-safe notification creation
- `prisma/migrations/20260921000000_add_automation_action_execution/migration.sql`
- `src/__tests__/automation.actions.schema.test.ts` — 35 tests
- `src/__tests__/automation.actions.handlers.test.ts` — 20 tests
- `src/__tests__/automation.actions.execution.test.ts` — 12 tests
- `docs/phase-8/task-3.md`

### Modified Files

- `prisma/schema.prisma` — added `automationDedupeKey` to InternalNote and Notification
- `src/lib/outbox/types.ts` — added `AUTOMATION_ACTION_EXECUTION`
- `src/lib/queue/handlers/registry.ts` — registered `handleAutomationActionExecution`
- `src/lib/automation/execution-service.ts` — `completeHandoff` now creates the first action's outbox event in the same transaction

## Test Results

```
Test Files  3 passed (3)
Tests       67 passed (67)
```

- 35 schema validation tests
- 20 handler tests (mocked Prisma transaction client)
- 12 execution engine tests (idempotency, finalization, race safety, next-action scheduling, permanent-failure continuation)

## Verification

```bash
npm run lint        # passes, 0 warnings
npm run typecheck   # passes
npm test            # 896 tests pass (67 new + 829 existing)
npm run build       # passes
```

## Migration

Apply the new deduplication columns:

```bash
prisma migrate deploy
```

Or for development:

```bash
prisma migrate dev
```

## Next Steps (Task 4+)

Task 3 completes the action-execution pipeline. Remaining Phase 8 tasks:

- **Task 4: Configurable SLA Policies** — workspace SLA configuration UI/API
- **Task 5: Automation Operations & Audit** — execution history, retry, debugging tools
