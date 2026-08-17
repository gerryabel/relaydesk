# Phase 5 — Task 2: Customer Context & History

## Status

Complete

## Objective

Add customer context to tickets and provide customer ticket history in Phase 5.
This task builds on the Customer/Contact foundation from Task 1 by introducing
explicit Customer ↔ Ticket linking, workspace validation, audit logging, and
a dedicated customer ticket history API.

## Implemented Scope

- Customer ↔ Ticket linking, replacement, and unlinking.
- Workspace consistency check when assigning a customer to a ticket.
- Customer ticket history endpoint scoped to the current workspace.
- Ticket detail can load the related customer relation.
- Activity logging for customer assignment changes:
  - `CUSTOMER_LINKED`
  - `CUSTOMER_UNLINKED`
- Migration ordering correction for ticket assignee history.

## Database Changes

### Ticket Customer Relation

`Ticket` now has a nullable customer link:

```prisma
model Ticket {
  // ...
  customerId  String?
  customer    Customer? @relation(fields: [customerId], references: [id], onDelete: SetNull)

  @@index([customerId])
}
```

Deletion behavior:
- Deleting a `Customer` does not delete tickets.
- `Ticket.customerId` is set to `NULL` when the linked customer is deleted.

### TicketActivityType Extension

`TicketActivityType` now includes:

```text
CUSTOMER_LINKED
CUSTOMER_UNLINKED
```

### Migration

Activity enum extension: `prisma/migrations/20260813220000_add_customer_linked_activity/migration.sql`

## Domain / Service

Service module: `src/lib/customers/server.ts`

### Customer Ticket History

Function: `getCustomerTickets(customerId)`

Behavior:
- Returns tickets linked to the given customer.
- Access is scoped to the current workspace membership.
- Throws `CustomerNotFoundError` if the customer does not exist or belongs to another workspace.
- Returns an empty list when the customer has no tickets.
- Returned tickets include ticket fields plus `createdBy` and `assignedTo` context.

### Workspace Validation

Helper: `assertCustomerInWorkspace(customerId, workspaceId)`

Behavior:
- Loads the customer by `id`.
- Rejects access if the customer does not exist.
- Rejects access if the customer's workspace does not match `workspaceId`.
- Throws `CustomerNotInWorkspaceError` on mismatch.

Error class: `CustomerNotInWorkspaceError` from `src/lib/customers/server.ts`

## API

Base path: `/api/customers`

### Customer Ticket History

`GET /api/customers/[id]/tickets`
- Returns tickets for the customer within the current workspace.
- `404` when the customer does not exist or is outside the workspace.
- `401` for unauthenticated requests.
- `403` when workspace membership is missing.
- `500` on unexpected server failures.

### Ticket Customer Update

Endpoint: `PATCH /api/tickets/[id]`

The ticket update path accepts `customerId`:
- Link a customer by sending `customerId`.
- Replace an existing customer by sending a different `customerId`.
- Unlink a customer by sending `customerId: null`.

Responses:
- `200` with updated ticket on success.
- `400` when the supplied customer is not in the ticket's workspace.
- `400` when `customerId` is not a valid string or `null`.
- `401` for unauthenticated requests.
- `403` when workspace membership is missing.
- `404` when the ticket does not exist in the current workspace.
- `409` for invalid ticket transitions when status updates are also supplied.
- `500` on unexpected failures.

## Customer ↔ Ticket Linking

Behavior implemented in `updateTicket(...)` in `src/lib/tickets/server.ts`:
- Tickets without a customer can be linked.
- An existing customer can be replaced with another customer.
- `customerId: null` unlinks the customer.
- When a non-null `customerId` changes, `assertCustomerInWorkspace(...)` is enforced.
- Cross-workspace customer assignment is rejected with `CustomerNotInWorkspaceError`.
- Unlink does not require customer workspace validation because the link is removed.

The mutation wraps ticket updates and activity creation in `prisma.$transaction(...)`
when any of the following change together: status, priority, or customer linkage.

## Customer Ticket History

Service: `getCustomerTickets(...)`

Behavior:
- Returns tickets that belong to the given customer.
- Workspace isolation is enforced through current membership checks.
- Customers from other workspaces are not accessible.
- Returns an empty list for customers without tickets.
- Response includes relevant ticket context such as:
  - `id`
  - `title`
  - `status`
  - `priority`
  - `createdAt`
  - `updatedAt`
  - `createdBy`
  - `assignedTo`

Endpoint: `GET /api/customers/[id]/tickets`

Errors:
- `404 Customer not found` when the customer is missing or outside the workspace.
- `401 Unauthorized` for unauthenticated requests.
- `403 Forbidden` when membership is missing.
- `500 Failed to load customer tickets` on unexpected failures.

## Activity / Audit

Task 2 adds the following activity events:
- `CUSTOMER_LINKED`
- `CUSTOMER_UNLINKED`

Trigger behavior:
- Assigning a customer to a ticket logs `CUSTOMER_LINKED`.
- Replacing an existing customer logs `CUSTOMER_LINKED`.
- Unlinking a customer logs `CUSTOMER_UNLINKED`.

Activity metadata records:
- `from` customer id or `null`
- `to` customer id or `null`

Mutations that change customer linkage use transaction-based atomic updates.

Migration: `prisma/migrations/20260813220000_add_customer_linked_activity/migration.sql`

This migration adds `CUSTOMER_LINKED` and `CUSTOMER_UNLINKED` to the
`TicketActivityType` enum.

## Workspace Isolation / Authorization

- All customer ticket history access is bound to the current workspace membership.
- Cross-workspace customer access is rejected as `404 Customer not found`.
- Cross-workspace customer assignment to a ticket is rejected as `400 Customer is not in this workspace`.
- Ticket mutations remain workspace-scoped through `getCurrentMembership()`.

## Tests

Relevant test files:
- `src/__tests__/customer-ticket-linking.test.ts`
- `src/__tests__/customers.api.auth.test.ts`
- `src/__tests__/customers.service.test.ts`
- `src/__tests__/customer.validation.test.ts`
- `src/__tests__/tickets.service.test.ts`
- `src/__tests__/tickets.list-states.test.ts`

Customer ticket linking tests cover:
- assign customer to ticket without customer
- change customer on ticket
- unlink customer from ticket
- reject cross-workspace customer assignment
- customer ticket history
- empty ticket history
- reject customer from another workspace

## Verification

- `git status` — working tree clean
- `prisma migrate status` — Database schema is up to date!
- `npm run lint` — passed, 0 errors
- `npm run typecheck` — passed
- `npm run test` — 228 tests passed
- `npm run build` — passed

## Git

Branch: `phase-5/task-2-customer-context-history`

Commits:
- `c86057a` — `feat(customers): add ticket context and history`
- `03cfa07` — `fix(customers): correct ticket customer activity and persistence`
- `a0607fa` — `fix(migrations): reorder ticket assignee migration history`

Push status:
- pushed to `origin/phase-5/task-2-customer-context-history`
- remote tracking branch: `origin/phase-5/task-2-customer-context-history`

## Migration Ordering Correction

Task 2 also includes a migration history correction.

Migration file before:
- `prisma/migrations/20250807203000_add_ticket_assignee/migration.sql`

Migration file after:
- `prisma/migrations/20260810000000_add_ticket_assignee/migration.sql`

The SQL content did not change. This rename was performed to maintain a
consistent migration ordering history.

Final commit for this correction:
- `a0607fa` — `fix(migrations): reorder ticket assignee migration history`

## Definition of Done

- [x] Customer ↔ Ticket linking implemented
- [x] Customer ticket history implemented
- [x] Workspace validation enforced
- [x] Activity logging for customer changes implemented
- [x] API endpoints documented and verified
- [x] Tests added and passing
- [x] Lint passed
- [x] Typecheck passed
- [x] Build passed
- [x] Migration ordering corrected
- [x] Independent verification passed
