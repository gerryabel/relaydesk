# Phase 2 Task 5 — Ticket Services

## Overview

This task introduces the Ticket Service layer for RelayDesk. It provides a single, authoritative entry point for all ticket-related database operations, keeping pages and future Server Actions from accessing Prisma directly. The layer centralizes validation, authorization, workspace isolation, and error handling so the rest of the application can rely on consistent behavior.

## Objectives

- Create reusable ticket service functions: create, read, update, and close.
- Add Zod-based validation schemas for ticket inputs.
- Enforce authentication, workspace membership, and workspace isolation on every operation.
- Provide typed errors for authorization and not-found cases.
- Add unit tests covering happy paths, authorization, cross-workspace protection, and validation.
- Keep Prisma access centralized in the ticket service.

## Features Implemented

### Ticket Service Layer
- `createTicket(...)`: validates input, verifies the authenticated user and workspace membership, creates the ticket, assigns the creator, and returns the created record.
- `getTickets(status?, priority?)`: returns tickets scoped to the current workspace, ordered newest first, with optional status and priority filters.
- `getTicketById(id)`: returns a single ticket only if it belongs to the current workspace; otherwise throws a typed not-found error.
- `updateTicket(id, input)`: updates allowed fields only after verifying workspace ownership and validating input.
- `closeTicket(id)`: closes a ticket using the same authorization and ownership checks as the update path.

### Validation
- `createTicketSchema`: requires `title`, optional `description`, default `priority`.
- `updateTicketSchema`: optional `title`, `description`, `priority`, and `status`.
- Shared enums for `TicketStatus` and `TicketPriority` keep validation consistent across services.

### Authorization
- Every service requires an authenticated session via `getCurrentMembership()`.
- Every service requires workspace membership.
- Cross-workspace access is prevented by scoping all queries to `membership.workspaceId`.

### Error Handling
- `TicketNotFoundError`: used when a ticket does not exist or is not accessible in the current workspace.
- Reused typed errors from `src/lib/workspace/server.ts`: `UnauthorizedError` and `ForbiddenError`.
- Validation errors are surfaced directly by Zod before any database access.

### Test Coverage
- Unit tests for all service functions.
- Authorization behavior via mocked workspace membership.
- Cross-workspace isolation tests.
- Validation rejection tests.
- Added missing coverage for membership-missing and invalid-input paths.

## Architecture Decisions

### Centralized Prisma Access
All Prisma queries for tickets live in `src/lib/tickets/server.ts`. Pages and future Server Actions call these service functions instead of constructing Prisma queries themselves. This reduces duplication, prevents unauthorized query shapes, and makes future data-layer changes local to one file.

### Validation Outside the UI
Zod schemas are defined in `src/lib/tickets/schema.ts`, not in page components or API handlers. This keeps validation logic reusable and prevents invalid data from ever reaching the service layer.

### Workspace Isolation
The service layer enforces workspace isolation at the database query level:
- create/update/close operations verify membership first and derive `workspaceId` and `createdById` from the session.
- read operations always include `workspaceId` in their `where` clause.
This prevents spoofing and removes reliance on caller-supplied ownership fields.

### Reusable Service Functions
Functions are kept small and composable. `closeTicket()` does not duplicate business logic; it reuses the same authorization and ownership pattern as `updateTicket()` and applies a single field update.

### Error Handling Strategy
Errors are typed and explicit:
- Validation errors from Zod.
- Authorization errors from workspace helpers.
- Domain not-found errors from the ticket service itself.
This gives callers a predictable contract and avoids silent failures or generic catch-all blocks.

## Verification

- `npm run lint` ✅
- `npm run typecheck` ✅
- `npm run build` ✅
- `npm run test` ✅ 14/14 passed

### Test Breakdown
- `src/__tests__/smoke.test.ts`: 1 test passed
- `src/__tests__/db/url.test.ts`: 2 tests passed
- `src/__tests__/tickets.service.test.ts`: 9 tests passed
- `src/__tests__/provisioning.test.ts`: 2 tests passed

## Files Added

- `src/lib/tickets/schema.ts`
- `src/lib/tickets/server.ts`
- `src/__tests__/tickets.service.test.ts`

## Files Modified

- `src/__tests__/provisioning.test.ts`

## Lessons Learned

- Mocking `getCurrentMembership()` is necessary for ticket service tests because it depends on Next.js request-scoped `headers()`. Without mocking, tests fail outside a real request context.
- Reusing workspace helpers preserves authorization behavior but requires careful mocking in unit tests.
- Centralizing Prisma access in the service layer makes it easier to reason about security boundaries.
- Keeping schemas and services in separate files supports future expansion without mixing concerns.

## Next Task

Phase 2 Task 6 — Ticket UI
