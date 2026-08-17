# Phase 5 — Task 8: Bulk Ticket Actions

## Purpose

Bulk Ticket Actions lets agents select multiple tickets visible on the ticket list and run one operational action against all of them. It is intentionally synchronous, explicit-selection based, and reuse-only: it does not add a new domain entity, background queue, or new ticket schema.

## Supported Actions

- `assign` — target user ID
- `status` — target ticket status
- `priority` — target ticket priority
- `add_tag` — target tag ID
- `remove_tag` — target tag ID

## Endpoint

`POST /api/tickets/bulk`

Payload shape:

```json
{
  "ticketIds": ["ticket-1", "ticket-2"],
  "action": "status",
  "value": "in_progress"
}
```

## Max Selection

`MAX_BULK_TICKETS = 100`

Requests with `0` IDs or more than `100` IDs are rejected before any database reads. Duplicate IDs are also rejected.

## Selection Semantics

Selection is limited to the currently visible ticket IDs. There is no cross-page or cross-filter persistence. Selection is reset when pagination, search, filters, or sort changes. The server re-authorizes every submitted ID; client-side visibility does not grant access.

## Atomicity

Bulk operations are all-or-nothing. The implementation validates the full request before any mutation:

1. resolve membership
2. validate payload
3. validate selection size / uniqueness
4. load all selected tickets
5. verify workspace ownership
6. validate action target
7. validate every ticket against action-specific rules
8. run mutations inside one transaction

If any validation or mutation fails, no tickets, activities, or notifications are changed.

## Authorization

- workspace scope: current membership workspace only
- ticket scope: all submitted tickets must belong to the current workspace; otherwise the request is rejected
- assignee scope: target assignee must be a member of the current workspace
- tag scope: target tag must belong to the current workspace
- client-provided `workspaceId` is not trusted

## No-Op Semantics

A no-op is valid per ticket and does not create activity, notification, or unnecessary database writes:

- same assignee during assignment
- same status during status change
- same priority during priority change
- tag already present during `add_tag`
- tag absent during `remove_tag`

## Activity Semantics

Activities remain per-ticket. No bulk-specific activity types are introduced.

| Action | Activity Type | Metadata |
| --- | --- | --- |
| assign | `TICKET_ASSIGNED` | `{ from, to }` |
| status | `STATUS_CHANGED` | `{ from, to }` |
| priority | `PRIORITY_CHANGED` | `{ from, to }` |
| add_tag | `TAG_ADDED` | `{ tagId }` |
| remove_tag | `TAG_REMOVED` | `{ tagId }` |

Actor is always the current membership user ID.

## Notification Semantics

Only existing notification types are used:

- `TICKET_ASSIGNED` for assignment changes when `actor !== new assignee`
- `TICKET_STATUS_CHANGED` for status changes when the ticket has an assignee and `actor !== assignee`

Self-notification is suppressed. Priority and tag changes do not create notifications. Notification creation participates in the same transaction as ticket and activity writes.

## UI Behavior

Bulk selection is integrated into `/dashboard/tickets`:

- each ticket card exposes a semantic checkbox
- a select-all checkbox selects only the current page
- a bulk action toolbar appears when `selectedIds.length > 0`
- assignment and status changes show a confirmation dialog before submit
- priority and tag actions may execute directly
- errors explicitly state that no tickets were changed when the operation fails

## Stale Data

The server validates against current database state. If a ticket's current state makes the requested action invalid, the entire bulk operation is rejected.

## Migration

No migration. The operation is synchronous and transaction-based. No `BulkOperation`, `BulkJob`, `BulkAction`, or `BulkQueue` models are added.

## Non-goals

- bulk delete
- bulk messages
- bulk internal notes
- bulk attachments
- bulk SLA changes
- bulk customer mutation
- bulk notification management
- cross-page or cross-workspace selection
- partial bulk updates

## Test Coverage

- domain service tests
- API response tests
- limit and authorization tests
- atomicity regression tests
- stale-state validation tests
