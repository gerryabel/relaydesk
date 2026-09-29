# Phase 8 — Task 5: Automation Operations & Audit

**Status:** Implemented
**Branch:** `phase-8/task-5-automation-operations-audit`

## 1. Objective

Build the operational and audit surface for RelayDesk Automations.

This task exposes durable automation execution history, execution-level debugging information, action-level outcomes, and safe manual retry of failed actions.

The implementation must reuse the existing Automation Execution, Automation Action Execution, transactional outbox, BullMQ, authorization, and workspace-isolation architecture.

This task must **not** create a second automation execution system or a separate audit subsystem.

## 2. Existing Functionality

The following already exists and must be reused:

### Automation Execution

`AutomationExecution` stores:

* `workspaceId`
* nullable `ruleId`
* `ruleNameSnapshot`
* `sourceEventType`
* `sourceEventId`
* `sourceAggregateId`
* optional `ticketId`
* execution status
* lease information
* condition evaluation state
* skip reason
* error
* timestamps

Execution statuses:

```text
pending
evaluating
awaiting_actions
executing
completed
partial_failure
failed
skipped
```

### Action Execution

`AutomationActionExecution` stores:

* `executionId`
* `actionIndex`
* `actionType`
* `actionConfig`
* status
* error
* timestamps

Action statuses:

```text
pending
completed
failed
skipped
```

### Existing Outbox Pipeline

Manual retry must reuse:

```text
AutomationActionExecution
        ↓
AUTOMATION_ACTION_EXECUTION
        ↓
existing outbox dispatcher
        ↓
BullMQ
        ↓
existing automation action worker
```

Do not introduce:

* a second automation queue
* a second worker
* a polling loop
* a separate retry queue
* a new audit table

### Rule History Preservation

`AutomationExecution.ruleId` is nullable and uses `onDelete: SetNull`.

`ruleNameSnapshot` preserves the rule name at execution time.

Execution history must therefore remain readable after the source automation rule is deleted.

## 3. Scope

Task 5 consists of:

1. Execution history list
2. Execution detail/debugging view
3. Action-level result inspection
4. Safe manual retry of a failed action
5. Workspace/member authorization
6. Server-side filtering and pagination
7. Automated tests
8. Documentation

## 4. Execution History

Create:

```text
/dashboard/automations/executions
```

The page displays executions belonging only to the current workspace.

Default ordering:

```text
createdAt DESC
id DESC
```

Each row/card should expose:

* execution timestamp
* rule name
* trigger/event type
* ticket reference when available
* execution status
* duration when completed
* number of actions
* failed action count when applicable

For deleted rules:

```text
ruleId = null
```

the UI must continue displaying:

```text
ruleNameSnapshot
```

No execution may disappear merely because its rule was deleted.

## 5. History Filters

The history endpoint/service must support:

* execution status
* rule
* trigger/event type
* ticket
* date range

Date range semantics:

```text
[start, end)
```

Use UTC boundaries consistently.

Supported pagination:

```text
page
limit
```

Recommended defaults:

```text
page = 1
limit = 20
max limit = 100
```

Pagination metadata:

```text
page
limit
total
totalPages
hasPreviousPage
hasNextPage
```

Requested pages beyond the last page should resolve to the last valid page, matching the existing repository pagination behavior.

## 6. Execution Detail

Create:

```text
/dashboard/automations/executions/[id]
```

The detail page must show:

### Execution metadata

* execution ID
* rule name
* current rule status when the rule still exists
* trigger/event type
* source event ID
* source aggregate ID
* ticket
* execution status
* started time
* completed time
* duration
* condition evaluation status
* skip reason
* execution error

### Rule deletion behavior

When the rule no longer exists:

```text
rule = null
```

display the historical:

```text
ruleNameSnapshot
```

and indicate that the originating rule is no longer present.

Do not fail the entire detail page because the rule relation is null.

## 7. Source Event Debugging

`AutomationExecution.sourceEventId` references the originating outbox event ID.

The detail service may load the corresponding `OutboxEvent` after the execution has been authorized for the current workspace.

Expose useful debugging information:

* event type
* aggregate type
* aggregate ID
* creation time
* payload

The source event is optional debugging context.

If the source outbox event is unavailable, execution history/detail must still work.

Do not expose arbitrary outbox records independently of an authorized execution.

## 8. Action Detail

Display actions in deterministic `actionIndex` order.

For each action show:

```text
index
action type
status
startedAt
completedAt
duration
error
action configuration
```

Action configuration is the historical configuration stored in `AutomationActionExecution.actionConfig`.

Do not reconstruct action configuration from the current automation rule.

This ensures the detail view represents what the execution actually attempted.

## 9. Manual Retry

Manual retry is supported only for the **failed final action** of an execution.

This restriction is intentional.

Retrying an earlier failed action after later actions have executed could violate the original sequential action ordering and cause later actions to observe or overwrite state unexpectedly.

Therefore:

```text
retryable =
  action.status === failed
  AND action.actionIndex === last action index
  AND execution.status IN (failed, partial_failure)
```

All other failed actions are display-only.

Examples:

```text
Action 0 failed
Action 1 completed
Action 0 -> NOT manually retryable
```

```text
Action 0 completed
Action 1 failed
Action 1 -> manually retryable
```

## 10. Retry Transaction

Manual retry must be atomic.

Within one Prisma transaction:

1. Verify the execution still belongs to the requested workspace.
2. Verify the action belongs to the execution.
3. Verify the execution is terminal and retryable.
4. Verify the action is the final action.
5. Verify action status is `failed`.
6. Reset the action:

```text
status       -> pending
error        -> null
startedAt    -> null
completedAt  -> null
```

7. Reopen execution:

```text
status      -> awaiting_actions
error       -> null
completedAt -> null
leasedBy    -> null
leasedAt    -> null
```

8. Create the `AUTOMATION_ACTION_EXECUTION` outbox event for the failed final action.

All changes must commit or roll back together.

The retry request must never leave:

```text
pending action
+
no outbox event
```

or:

```text
outbox event
+
failed action
```

## 11. Retry Concurrency

Retry must be race-safe.

Two simultaneous retry requests must not both enqueue a retry.

Use a conditional database update or equivalent transaction guard so only one request can transition:

```text
failed → pending
```

If another request already performed the retry, return a conflict response rather than creating another outbox event.

Suggested HTTP response:

```text
409 Conflict
```

## 12. Retry After Rule Deletion

A deleted rule must not prevent retrying an existing execution.

The execution already contains:

* historical rule name
* historical action configuration
* workspace
* ticket
* nullable rule ID

The retry pipeline must therefore support:

```text
ruleId = null
```

and continue using the existing worker-safe automation context.

No rule recreation is required.

## 13. Authorization

### Execution history

Any authenticated workspace member may read:

```text
GET execution list
GET execution detail
```

### Manual retry

Manual retry is:

```text
workspace owner only
```

Use the existing:

```text
assertWorkspaceOwner()
```

pattern.

Never trust a client-supplied workspace ID.

Workspace identity must always come from the authenticated server-side membership.

## 14. Proposed Domain Service

Create a focused service, likely:

```text
src/lib/automation/executions.ts
```

Responsibilities:

```text
listAutomationExecutions()
getAutomationExecutionById()
retryFailedFinalAction()
```

The service should:

* resolve workspace from `getCurrentMembership()`
* enforce workspace isolation
* map Prisma records to stable response types
* centralize pagination/filter validation
* contain retry transaction logic

Do not add generic abstractions unless an existing repository utility already fits.

## 15. Proposed API

### List

```http
GET /api/automation-executions
```

Query parameters:

```text
page
limit
status
ruleId
triggerType
ticketId
from
to
```

Response:

```json
{
  "data": [],
  "page": 1,
  "limit": 20,
  "total": 0,
  "totalPages": 0,
  "hasPreviousPage": false,
  "hasNextPage": false
}
```

### Detail

```http
GET /api/automation-executions/:id
```

Response contains:

```text
execution
actions
sourceEvent
```

Source event may be null if unavailable.

### Retry

```http
POST /api/automation-executions/:executionId/actions/:actionIndex/retry
```

Success:

```text
200
```

Conflict / invalid retry state:

```text
409
```

Unauthorized:

```text
401
```

Not workspace member / not owner:

```text
403
```

Execution or action not found within workspace:

```text
404
```

Unexpected server failure:

```text
500
```

Never return Prisma/internal stack traces.

## 16. UI Integration

The existing Automations page should expose a navigation path to execution history.

Reuse existing automation/dashboard styling and components.

Do not introduce a separate visual system.

Likely files:

```text
src/app/dashboard/automations/executions/page.tsx
src/app/dashboard/automations/executions/[id]/page.tsx

src/components/automations/execution-list.tsx
src/components/automations/execution-detail.tsx
```

A client component should only be introduced where interaction requires it, especially manual retry and interactive filtering.

Reuse existing:

* `Badge`
* dashboard error states
* workspace authorization patterns
* existing pagination conventions
* existing automation typography/layout

## 17. Validation

Query parameters must be validated server-side.

Examples:

```text
page > 0
1 <= limit <= 100
status ∈ AutomationExecutionStatus
ruleId is a non-empty identifier when present
ticketId is a non-empty identifier when present
from/to are valid timestamps
```

Invalid filters return:

```text
400 Bad Request
```

Date handling must be deterministic and timezone-safe.

## 18. Tests

### Execution service

Cover:

* workspace isolation
* list pagination
* page clamping
* status filter
* rule filter
* trigger filter
* ticket filter
* date filtering
* deleted rule handling
* stable ordering
* execution detail
* source event present
* source event missing

### Retry

Cover:

* owner can retry failed final action
* member gets forbidden
* unauthenticated gets unauthorized
* wrong workspace returns not found/forbidden according to repository convention
* completed action cannot retry
* pending action cannot retry
* non-final failed action cannot retry
* non-terminal execution cannot retry
* retry resets action state
* retry resets execution state
* retry creates exactly one outbox event
* concurrent retry results in only one successful transition
* deleted rule execution can retry
* retry preserves historical action configuration

### API

Cover:

```text
401
403
404
400
409
200
```

for relevant endpoints and invalid states.

### Regression

Existing automation, outbox, action execution, SLA, and workspace-isolation tests must remain passing.

## 19. Database Changes

Expected:

```text
No new tables
No new enum
No new dependency
```

Do not add a migration unless implementation proves an existing index is insufficient.

Existing indexes should be evaluated before adding any new one.

## 20. Security Requirements

* derive workspace from authenticated membership
* never accept client `workspaceId` as authority
* verify execution belongs to workspace before loading related records
* owner-only retry
* do not expose internal Prisma errors
* do not expose unrelated workspace outbox events
* do not trust client-supplied execution/action relationships
* maintain existing tenant isolation guarantees

## 21. Documentation

Create/update:

```text
docs/phase-8/task-5.md
```

Documentation must describe:

* architecture
* APIs
* filters
* pagination
* execution detail
* retry semantics
* why only the final failed action is retryable
* authorization
* test/verification results

## 22. Verification

Required:

```bash
npm run lint
npm run typecheck
npm test
npm run build
```

Also verify database/infrastructure behavior where relevant using the existing project commands.

## 23. Git

Feature branch:

```text
phase-8/task-5-automation-operations-audit
```

Commit message:

```text
feat(automation): add operations and audit tooling
```

Do not push unless explicitly requested.

## 24. Definition of Done

Task 5 is complete when:

* execution history is available from the dashboard
* history is workspace isolated
* pagination works correctly
* filters work correctly
* deleted rules remain readable
* execution detail exposes action history
* source-event debugging is available
* failed final actions can be manually retried
* manual retry is atomic and concurrency-safe
* manual retry reuses the existing outbox/BullMQ pipeline
* non-final failed actions are not retryable
* owner-only retry authorization works
* automated tests cover the critical cases
* lint passes
* typecheck passes
* tests pass
* build passes
* documentation is updated
* commit is created
* working tree is clean

---

# Implementation

## Overview

Task 5 was implemented entirely on top of the existing execution, outbox, and
BullMQ architecture. No new table, enum, queue, worker, polling loop, retry
queue, or audit subsystem was added, and no Prisma migration was required.

The existing `AutomationExecution` indexes already cover the supported query
shapes (`workspaceId` + `createdAt`, `workspaceId` + `status` + `createdAt`,
`ruleId` + `createdAt`, `ticketId`), and `AutomationActionExecution` already
stores the historical `actionConfig` snapshot, so no schema change was needed.

```text
/dashboard/automations/executions
        ↓
listAutomationExecutions()          (workspace-scoped, server-side filters)
        ↓
AutomationExecution + AutomationActionExecution

/dashboard/automations/executions/[id]
        ↓
getAutomationExecutionById()        (metadata + timeline + optional source event)

Retry button
        ↓
POST /api/automation-executions/:executionId/actions/:actionIndex/retry
        ↓
retryFailedFinalAction()            (one transaction)
        ↓
AutomationActionExecution: failed → pending
AutomationExecution: terminal → awaiting_actions
OutboxEvent: AUTOMATION_ACTION_EXECUTION
        ↓
existing outbox dispatcher → BullMQ → existing automation action worker
```

## Files

### New Files

- `src/lib/automation/executions.ts` — `listAutomationExecutions()`,
  `getAutomationExecutionById()`, `retryFailedFinalAction()`, response types,
  and the `ActionNotFoundError` / `ExecutionNotRetryableError` /
  `ExecutionRetryConflictError` domain errors
- `src/lib/automation/executions-schema.ts` — query/param validation shared by
  the API (strict) and the dashboard page (lenient)
- `src/app/api/automation-executions/route.ts` — `GET` list
- `src/app/api/automation-executions/[id]/route.ts` — `GET` detail
- `src/app/api/automation-executions/[executionId]/actions/[actionIndex]/retry/route.ts` — `POST` retry
- `src/app/dashboard/automations/executions/page.tsx` — history page
- `src/app/dashboard/automations/executions/loading.tsx`
- `src/app/dashboard/automations/executions/error.tsx`
- `src/app/dashboard/automations/executions/[id]/page.tsx` — detail page
- `src/app/dashboard/automations/executions/[id]/not-found.tsx`
- `src/components/automations/execution-list.tsx`
- `src/components/automations/execution-detail.tsx`
- `src/components/automations/execution-status.tsx`
- `src/components/automations/json-block.tsx`
- `src/components/automations/retry-action-button.tsx` — the only client
  component introduced, because retry is the only interaction that needs
  client state
- `src/__tests__/automation.executions.integration.test.ts` — 53 tests
- `src/__tests__/automation.executions.api.test.ts` — 42 tests
- `src/__tests__/automation.executions-schema.test.ts` — 21 tests

### Modified Files

- `src/app/dashboard/automations/client-page.tsx` — added the
  "View execution history" navigation link

## Architecture

### Domain service

`src/lib/automation/executions.ts` is the only place that talks to Prisma for
this feature. It resolves workspace identity from `getCurrentMembership()` /
`assertWorkspaceOwner()` and never accepts a workspace ID from the caller.

Pagination reuses `normalizeTicketPagination()` from
`src/lib/tickets/pagination.ts` rather than introducing a second convention, so
defaults (`page = 1`, `limit = 20`), the `limit <= 100` ceiling, and the
`TicketPaginationResult` shape are identical to ticket lists. A page beyond the
last page resolves to the last valid page rather than erroring.

### Validation

`src/lib/automation/executions-schema.ts` holds one set of field schemas with
two entry points:

| Entry point | Used by | Invalid input |
| --- | --- | --- |
| `readExecutionListQuery()` | API routes | `400 Bad Request` |
| `parseExecutionHistorySearchParams()` | dashboard page | dropped, defaults used |

This matches the existing convention: `src/lib/tickets/search.ts` validates
strictly for the API while `src/app/dashboard/tickets/page.tsx` degrades
gracefully, and it keeps the two surfaces from drifting apart.

### Date handling

Dates are half-open UTC intervals:

```text
createdAt >= from
createdAt <  to
```

The API accepts full ISO-8601 instants with an explicit zone (`Z` or an
offset). The dashboard inputs are `datetime-local` fields labelled "UTC" and
are converted with `utcInputToInstant()`, so a filter never shifts with the
viewer's browser timezone. The page labels the bounds "From (UTC, inclusive)"
and "To (UTC, exclusive)" so the interval semantics are visible in the UI.

## Execution Detail

The detail response is:

```text
execution   — metadata, current rule (or null), lease info, duration
actions     — full timeline, ordered by actionIndex ascending
sourceEvent — optional outbox debugging context, or null
canRetry    — server-derived, true only for workspace owners
```

`canRetry` is computed server-side rather than inferred by the client, so a
member can read the detail page but never sees an actionable retry control.

`actionConfig` is always read from `AutomationActionExecution` and never
reconstructed from the current rule, so the view shows what the execution
actually attempted even after the rule was edited or deleted. A test asserts
this explicitly by mutating the rule's live `actions` after seeding an
execution and confirming the timeline still reports the original config.

### Source event

`sourceEventId` resolves against `OutboxEvent` only *after* the execution has
been authorized for the caller's workspace, and `OutboxEvent` has no
independent listing endpoint, so unrelated outbox records are not reachable
through this path. A missing event is normal (retention, cleanup) and yields
`sourceEvent: null` rather than a failed page.

## Retry Semantics

### Why only the final failed action

An execution is a sequential action chain. If action 0 fails and action 1 has
already run, replaying action 0 would re-apply its side effects *after* action
1 observed the intermediate state, so action 1's effects could be silently
overwritten. The pipeline also stops scheduling after a permanent failure, so
there is no later action to re-drive. Therefore:

```text
retryable =
  action.status === failed
  AND action.actionIndex === highest actionIndex
  AND execution.status IN (failed, partial_failure)
```

Earlier failed actions remain visible in the timeline with their error, but are
display-only. This matches the spec examples:

```text
Action 0 failed, action 1 completed → action 0 NOT retryable
Action 0 completed, action 1 failed → action 1 retryable
```

### Transaction

`retryFailedFinalAction()` runs entirely inside one
`prisma.$transaction()`:

1. Load the execution with `where: { id, workspaceId }` — an execution in
   another workspace is indistinguishable from a missing one.
2. Confirm the action exists for that execution.
3. Confirm the requested `actionIndex` is the highest index.
4. Confirm the execution status is `failed` or `partial_failure`.
5. Confirm the action status is `failed`.
6. Confirm a ticket exists, since automation actions are ticket-scoped and the
   outbox event requires a non-empty `aggregateId`.
7. `updateMany` the action `failed → pending`, clearing `error`, `startedAt`,
   and `completedAt`.
8. `updateMany` the execution out of a retryable terminal state into
   `awaiting_actions`, clearing `error`, `completedAt`, `leasedBy`, and
   `leasedAt`.
9. Create exactly one `AUTOMATION_ACTION_EXECUTION` outbox event via the
   existing `queueAutomationActionExecution()` helper.

Because steps 7–9 share a transaction, a pending action can never be left
without a durable way to drive it, and an outbox event can never exist for an
action that is still marked failed. A test forces the outbox insert to throw
and asserts both rows roll back to their original state.

The event is created with `automationContext.actorId` set to the owner who
triggered the retry, so downstream automations can distinguish a human retry
from an automation-caused one.

### Race safety

Both transitions use conditional `updateMany` guards with an explicit
`count === 1` check:

```text
AutomationActionExecution: where status = 'failed'
AutomationExecution:       where status IN ('failed', 'partial_failure')
```

Under PostgreSQL READ COMMITTED a competing request blocks on the row lock and
re-evaluates its predicate against the committed row, so it observes
`count === 0` and never enqueues a second event. A test fires two concurrent
retries and asserts exactly one success, one rejection, and exactly one outbox
event.

### Conflict reporting: concurrent and serialized are the same

A second retry must report the same reason whether it lost the conditional
race or arrived after the winner committed. The reopened state a retry produces
is:

```text
action.status     = pending
execution.status  = awaiting_actions
```

That pair is recognised by `isReopenedByRetry()` and mapped to
`ExecutionRetryConflictError` → `409` with code `ExecutionRetryConflictError` on
both paths:

| Request | Rejected at | Error | HTTP |
| --- | --- | --- | --- |
| B, racing A (loses `failed → pending`) | conditional-update miss, state re-read | `ExecutionRetryConflictError` | 409 |
| B, arriving after A committed | explicit already-retried check, before the terminal-state test | `ExecutionRetryConflictError` | 409 |
| any other invalid state | terminal-state / failed-action / final-action / ticket checks | `ExecutionNotRetryableError` | 409 |

A `count === 0` conditional miss re-reads the live statuses through
`readRetryStateSnapshot()` before deciding, so unrelated bad states are never
laundered into conflicts — for example a `completed` execution whose final
action is `failed`, a `failed` execution whose final action already
`completed`, and a `failed` execution whose final action is still `pending` all
remain `ExecutionNotRetryableError`.

One ambiguity is accepted and documented: an execution that was handed off but
whose first action has not been picked up yet is also `awaiting_actions` +
`pending`. Row data alone cannot separate the two, and both mean the action is
not in a retryable `failed` state and must not be re-enqueued, so both are
reported as a conflict. The retry control is never offered for a non-failed
action, so the UI cannot produce that state.

### Retry after rule deletion

Retry works on deleted rules. The action's historical `actionConfig` and the
execution's `ruleNameSnapshot` are authoritative, `ruleId` is threaded through
as `null` in the outbox payload, and no rule recreation is needed. `AutomationRule`
uses `onDelete: SetNull`, so the execution row survives the rule.

## Authorization

| Surface | Requirement | Implementation |
| --- | --- | --- |
| List / detail read | any workspace member | `getCurrentMembership()` + `workspaceId` in every `where` clause |
| Retry | workspace owner only | `assertWorkspaceOwner()` |

`canRetry` in the detail payload is derived from `membership.role`, so the
client cannot unlock the action by tampering with the DOM. The retry endpoint
ignores the request body entirely: execution and action identity come from the
URL path, and workspace identity comes from the session.

## API

### `GET /api/automation-executions`

| Param | Type | Notes |
| --- | --- | --- |
| `page` | int > 0, max 10000 | default `1` |
| `limit` | 1–100 | default `20` |
| `status` | `AutomationExecutionStatus` | |
| `ruleId` | non-empty string ≤ 64 | |
| `triggerType` | non-empty string ≤ 100 | maps to `sourceEventType` |
| `ticketId` | non-empty string ≤ 64 | |
| `from` / `to` | ISO-8601 instant | half-open `[from, to)` |

Unknown parameters are ignored. Invalid known parameters return `400`.
`triggerType` is the outbox event type that produced the execution (e.g.
`TICKET_CREATED`), which is what `AutomationExecution.sourceEventType`
stores.

### `GET /api/automation-executions/:id`

```text
200 { execution, actions, sourceEvent, canRetry }
400 (not used)
401 Unauthorized
403 Forbidden
404 not found — identical for "missing" and "another workspace"
500 generic message
```

### `POST /api/automation-executions/:executionId/actions/:actionIndex/retry`

```text
200 { executionId, actionIndex, actionStatus: 'pending', executionStatus: 'awaiting_actions' }
400 invalid path parameters
401 Unauthorized
403 Forbidden — workspace member
404 ExecutionNotFoundError | ActionNotFoundError
409 ExecutionNotRetryableError | ExecutionRetryConflictError
500 generic message
```

Error bodies carry a stable `code` (`error.name`) for the 404/409 cases so the
UI can distinguish "already retried" from "not retryable" without parsing
prose. No Prisma error or stack trace is ever returned, and no 404/409 body
echoes the caller-supplied execution id or action index, so a crafted path
cannot turn an error response into a reflected-XSS sink.

### List `isRetryable`

`AutomationExecutionListItem.isRetryable` is a retained part of the list
contract with explicitly documented meaning:

> true means the execution currently has a retryable final failed action, i.e.
> `execution.status IN (failed, partial_failure)` AND the highest-index action
> is `failed`.

It has one real consumer: the "Retry available" badge in
`execution-list.tsx`. It describes execution state, not permission — a member
may see `true`, and the retry control is still withheld server-side via
`canRetry`.

`retryableActionIndex` was deliberately **not** added. No consumer needs to
identify the action from a list row: the retry control lives on the detail
page, which already returns the full ordered action timeline with indices.
Exposing it would add API surface for hypothetical future use.

## UI

| File | Role |
| --- | --- |
| `execution-list.tsx` | server component; rows with status, rule, trigger, ticket link, duration, action/failure counts, skip/error |
| `execution-detail.tsx` | server component; metadata table, rule snapshot vs. current rule, source event, ordered action timeline |
| `execution-status.tsx` | status badge presentations, `id-ID` date and duration formatting |
| `json-block.tsx` | bounded `<pre>` JSON rendering (truncates at 4000 chars) |
| `retry-action-button.tsx` | client component; `POST` + `router.refresh()` |
| `executions/page.tsx` | server component; GET filter form, all filtering server-side |
| `executions/[id]/page.tsx` | server component; maps `ExecutionNotFoundError` to `notFound()` |

Deleted rules render the `ruleNameSnapshot` with a "rule deleted" marker, and
a deleted rule's execution stays fully retryable. The history page links from
the existing Automations page ("View execution history"). An unfiltered
workspace with no executions gets the existing `EmptyState` component.

## Tests

### Execution service — `automation.executions.integration.test.ts` (53)

Real Prisma against the test database; only workspace identity is mocked, so
isolation is genuinely exercised rather than asserted about a stub.

- workspace isolation (list, detail, retry) and member read access
- deterministic `createdAt DESC, id DESC` ordering
- defaults, `limit` ceiling, page clamping, and non-overlapping pages
- status / rule / trigger / ticket / combined filters
- half-open `[from, to)` boundaries, asserting `from` is inclusive and `to` is
  exclusive
- `ruleId = null` rows still returned with their snapshot
- detail metadata, timeline ordering, durations, skip reason, error
- historical `actionConfig` preserved after the rule is edited
- detail readable after the rule is deleted
- `sourceEvent: null` when the outbox event is absent
- action and execution state resets on retry
- exactly one outbox event, with the correct payload and `actorId`
- earlier completed actions untouched
- full completion through the **existing** `executeAction()` pipeline
- member → `ForbiddenError`; cross-workspace → `ExecutionNotFoundError`
- non-final action, non-failed action, non-terminal execution, skipped
  execution, and ticket-less execution all rejected
- deleted-rule retry with `ruleId: null` in the payload
- **serialized second retry → `ExecutionRetryConflictError`**, explicitly
  asserted *not* to be `ExecutionNotRetryableError`, with one outbox event and
  the reopened state left intact
- concurrent and serialized second retries produce the identical error name
- unrelated invalid states stay `ExecutionNotRetryableError` and are not
  laundered into conflicts
- two concurrent retries: exactly one wins, loser is a conflict, one event
- outbox failure rolls back the action and the execution

### List `isRetryable` semantics

A dedicated block pins the documented meaning, including the shape the review
initially described:

- `partial_failure`, action 0 `failed`, action 1 `completed` → `false`
  (the failed action is still counted in `failedActionCount`, but it is
  display-only)
- `failed`, action 0 `failed`, action 1 `completed` → `false`
- `partial_failure`, final action `failed` → `true`
- `failed`, final action `failed` → `true`
- retryable status with a `pending` or `skipped` final action → `false`
- retryable status with no actions at all → `false`
- flips to `false` once a retry reopens the execution

### API — `automation.executions.api.test.ts` (42)

Route handlers are invoked directly with `NextRequest`; the domain service is
mocked so each case asserts one thing.

- `200` for list, detail, and retry
- query → service filter mapping, including offset normalization and ignored
  unknown params
- `400` for ten distinct invalid-query shapes and four invalid path shapes
- `401`, `403`, `500` on each route
- `404` for unknown execution, cross-workspace execution, and unknown action
- `409` for non-retryable state and concurrent-retry conflict
- the identical `404` body is asserted not to echo the requested id
- a request body is shown to have no effect on the retry
- **404 response safety**: a hostile execution id
  (`<script>alert("xss")</script>`) and action index are shown not to appear in
  the `ExecutionNotFoundError` or `ActionNotFoundError` bodies, nor in a `409`,
  and the 404 bodies are asserted to be exact fixed strings

### Validation — `automation.executions-schema.test.ts` (21)

Status enumeration, strict vs. lenient parsing, `triggerType` mapping,
`datetime-local` ↔ UTC round-trips, dropped-vs-defaulted invalid fields, and
path-parameter coercion.

### Regression

All pre-existing automation, outbox, action-execution, SLA, and
workspace-isolation suites continue to pass.

## Test Results

```text
Test Files  99 passed (99)
Tests       1122 passed (1122)
```

- 53 execution service integration tests
- 42 API route tests
- 21 validation tests
- 1006 pre-existing tests, unchanged

## Verification

```bash
npm run lint        # passes, 0 warnings
npm run typecheck   # passes
npm test            # 99 files, 1122 tests pass (116 new)
npm run build       # passes
```

The single `Turbopack` NFT tracing warning during `next build` comes from
`src/lib/attachments/local-storage.ts` via `next.config.ts` and is pre-existing
and unrelated to this task.

## Security Notes

- Workspace identity always comes from the authenticated membership; no route
  accepts a client-supplied `workspaceId`.
- Every execution query is scoped by `workspaceId`, so "another workspace" and
  "does not exist" produce byte-identical `404` responses.
- The source outbox event is loaded only after the parent execution has been
  authorized, and there is no standalone outbox read endpoint.
- `canRetry` is server-derived; the retry endpoint enforces the owner check
  again and ignores the request body.
- The retry path never returns Prisma or internal error details.

## Notes and Trade-offs

- **Limit handling.** The service delegates to
  `normalizeTicketPagination()`, so a `limit` above 100 raises a `ZodError`
  rather than being silently clamped. Both callers validate or clamp first
  (the API answers `400`, the page falls back to 20), matching the existing
  ticket behavior instead of introducing a second convention.
- **Owner check placement.** `assertWorkspaceOwner()` runs before the
  transaction opens. Workspace ownership is a session property, not a row that
  can change mid-request, while every row-level guard inside the transaction is
  additionally scoped by the resolved `workspaceId`.
- **Already-retried vs. never-run detection.** A retry that has already
  happened and an execution whose first action has not been dispatched yet
  share the `pending` + `awaiting_actions` shape. The two are reported
  identically as a conflict because they are indistinguishable from row data
  and carry the same operational meaning. Distinguishing them would require new
  persisted state, which this task deliberately avoids.
- **Rule filter and deleted rules.** Filtering by rule uses the current
  `ruleId`, so executions whose rule was deleted match only when no rule
  filter is applied. They remain visible in the unfiltered list, which is what
  the "no execution may disappear" requirement covers.
- **No idempotency key.** The conditional guards provide the required
  single-transition guarantee without a client-supplied key; the existing
  dispatcher's idempotent handling covers outbox redelivery.


