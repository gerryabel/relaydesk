# Phase 5 — Task 5: My Queue / Agent Queue

## Status

Completed

## Objective

Provide a focused personal queue on top of the existing ticket infrastructure so agents can answer: "Tiket apa yang perlu aku kerjakan sekarang?"

My Queue is a view layer, not a new persistence model. It reuses `getAllTicketsForMember()`, `TicketCard`, and the Task 4 SLA helpers.

## Queue Architecture

### Route

* `/dashboard/my-queue` — primary page.
* Optional REST surface: `GET /api/my-queue` returns the queue payload for integration tests and future client hydration.

### Domain helpers

`src/lib/tickets/queue.ts` owns the queue semantics. It does not introduce a second query engine.

Helpers:

* `resolveQueueView()` — maps raw view input to a known queue preset; unknown values fall back to `my-open`.
* `getMyQueueCounts()` — derives counts for all queue views from the same scoped ticket set.

All queue data flows through `getAllTicketsForMember()` in `src/lib/tickets/server.ts`, preserving the existing workspace boundary, search, tag filters, sort, and pagination validation.

## Current-User Enforcement

Authorization uses the existing workspace membership layer:

* `getCurrentMembership()` returns the current user's workspace and user ID.
* `getMyQueueTickets()` and `getMyQueueCounts()` both pass `assignee: membership.userId` to `getAllTicketsForMember()`.
* URL-supplied `assignee` parameters are never trusted for authorization. If a caller provides `?assignee=other-user`, the queue implementation ignores that value and continues to scope to `membership.userId`.

This ensures a user cannot see another agent's queue through URL manipulation.

## Queue Views

| View | Filter |
| --- | --- |
| My Open | assigned to current user; `status` is `open` or `in_progress` |
| Waiting | assigned to current user; `status` is `waiting_customer` |
| High Priority | assigned to current user; `priority` is `high` or `urgent`; excludes `resolved` and `closed` |
| SLA At Risk | assigned to current user; uses Task 4 SLA monitoring helpers; includes tickets whose response or resolution SLA is `at_risk` |

Default view is `my-open`.

## Counts

Counts are derived, not stored.

Implementation computes counts from the current-user ticket set returned by `getTickets()`. Counts are per view, scoped to the same search, status, priority, and tag filters applied to the queue.

## URL State

Queue navigation uses query parameters:

* `view=my-open|waiting|high-priority|sla-risk`
* Existing filters `search`, `status`, `priority`, `tagId`, `sort`
* Pagination `page`, `limit`

Invalid or missing `view` falls back safely to `my-open`. Pagination links preserve the current view and filters.

## SLA At Risk Handling

Task 4 introduced derived SLA monitoring state in `src/lib/tickets/sla.ts`:

* `getResponseSlaMonitoringStatus()`
* `getResolutionSlaMonitoringStatus()`

My Queue reuses these helpers directly. A ticket qualifies for SLA At Risk when either SLA is `at_risk`. No duplicate threshold, no database-level SLA filter, and no new SLA state enum are introduced.

Because SLA state is derived and depends on current time, SLA-based view classification happens in application memory after fetching the scoped ticket set. For Phase 5 scope, correctness is prioritized over database-level SLA pagination.

## Pagination Decision

Queue pagination is applied after view classification.

* Non-SLA views can safely paginate after classification because the underlying database query already honors filters, assignee scope, workspace scope, search, tagIds, and sort.
* SLA At Risk pagination is also applied after in-memory classification to preserve the semantic correctness of the view.
* The queue fetches a bounded scoped ticket set from `getTickets()` (limit 100) before classification to avoid loading unbounded data.

## Reused Components

* `TicketCard` — reused directly from `/dashboard/tickets`. No `QueueTicketCard` is introduced.
* `TicketFilterControls` — reused for search, status, priority, and tag filters.
* `TicketSortControls` — reused for sort state.
* `EmptyState` — reused for empty queue states.
* Existing sidebar and dashboard layout are reused.

## Authorization Model

* Reuses `getCurrentMembership()` and the existing workspace boundary enforced by `getTickets()`.
* No second authorization mechanism is introduced.
* `/dashboard/my-queue` inherits the dashboard layout requirement; unauthorized users are redirected by existing workspace logic.

## Accessibility and UX

* Queue views are presented as linked buttons with clear selected state.
* Counts are visible in each view button.
* Pagination uses accessible disabled states.
* Empty states are view-specific to avoid implying a broken queue.
* Mobile behavior matches the existing ticket filters layout.

## Non-Goals

This task does not implement:

* automatic assignment
* round robin assignment
* skill-based routing
* team workload balancing
* team queues
* drag-and-drop
* Kanban board
* workflow automation
* background jobs
* Redis/cache layer
* queue persistence
* notification system
* bulk operations
* new ticket search engine
* SLA policy engine

## Testing

### Domain tests

Covered in `src/__tests__/tickets.queue.test.ts`:

* unknown view fallback
* current-user scope enforcement
* My Open includes `open`, `in_progress`; excludes `waiting_customer`, `resolved`, `closed`
* Waiting includes `waiting_customer` only
* High Priority includes `high`, `urgent`; excludes resolved/closed
* SLA At Risk uses Task 4 monitoring status
* conflicting `assignee` query input does not escape current-user scope
* counts agree with view membership

### Regression

All existing tests must continue passing after the branch is merged.

## Migration

No migration is introduced. No new Prisma models are added.
