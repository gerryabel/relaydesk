# RelayDesk Phase 2 Specification

## 1. Summary
Phase 2 delivers an internal workspace ticketing MVP. An authenticated user owns exactly one default workspace and can create, view, and discuss tickets inside that workspace. Customer-facing ticket submission, invitations, multi-workspace selection, assignee workflows, and external requesters are out of scope.

## 2. Current implementation basis
- Phase 0: Next.js 16 App Router, Tailwind CSS 4, Prisma 7, PostgreSQL, Zod env validation, `proxy.ts` for route protection.
- Phase 1: Better Auth `1.6.25` with email/password. Prisma schema includes `User`, `Account`, `Session`, `Verification`. Session validation uses `getServerAuthSession()`. No helpdesk data model exists.
- Package scripts available: `dev`, `build`, `start`, `lint`, `typecheck`, `db:generate`, `db:migrate`, `db:studio`, `self-check`, `infra:check`.
- No test framework is currently present.
- Generated Prisma output at `src/generated` is not tracked in Git.

## 3. Approved decisions
- Preserve ticket/message authorship records when a `User` is deleted via `onDelete: SetNull` for `createdById`.
- Add Vitest as the test framework with scripts `test` and `test:watch`.
- Save the canonical specification at `docs/phase-2-spec.md`.

## 4. Prisma data contract

### 4.1 Enums
```prisma
enum WorkspaceRole {
  owner
  member
}

enum TicketStatus {
  open
  in_progress
  resolved
  closed
}

enum TicketPriority {
  low
  medium
  high
  urgent
}
```

### 4.2 Existing model
Do not alter existing Better Auth scalar fields or existing authentication relations. Only add the new reverse relation fields required by the approved helpdesk models.

### 4.3 Model Workspace
| Field | Type | Required | Default | Notes |
|-------|------|----------|---------|-------|
| `id` | `String` | Yes | `cuid()` | PK |
| `name` | `String` | Yes | — | Workspace name |
| `createdAt` | `DateTime` | Yes | `now()` | — |
| `updatedAt` | `DateTime` | Yes | `@updatedAt` | — |

Relations:
- `members` -> `Membership[]`
- `tickets` -> `Ticket[]`

Unique:
- none beyond PK

Indexes:
- none beyond PK

onDelete:
- `Membership.workspaceId`: `Cascade`
- `Ticket.workspaceId`: `Cascade`

### 4.4 Model Membership
| Field | Type | Required | Default | Notes |
|-------|------|----------|---------|-------|
| `id` | `String` | Yes | `cuid()` | PK |
| `userId` | `String` | Yes | — | FK -> `User.id` |
| `workspaceId` | `String` | Yes | — | FK -> `Workspace.id` |
| `role` | `WorkspaceRole` | Yes | none | explicitly set at creation |
| `createdAt` | `DateTime` | Yes | `now()` | — |
| `updatedAt` | `DateTime` | Yes | `@updatedAt` | — |

Relations:
- `user` -> `User`
- `workspace` -> `Workspace`

Unique:
- `[userId]`

Indexes:
- `workspaceId`

onDelete:
- `Membership.userId` -> `User`: `Cascade`
- `Membership.workspaceId` -> `Workspace`: `Cascade`

Behavior:
- Exactly one membership per user is enforced at the database level.

### 4.5 Model Ticket
| Field | Type | Required | Default | Notes |
|-------|------|----------|---------|-------|
| `id` | `String` | Yes | `cuid()` | PK |
| `workspaceId` | `String` | Yes | — | FK -> `Workspace.id` |
| `createdById` | `String` | No | — | FK -> `User.id` |
| `title` | `String` | Yes | — | Validated application-side |
| `description` | `String` | No | — | Nullable after blank normalization |
| `status` | `TicketStatus` | Yes | `open` | — |
| `priority` | `TicketPriority` | Yes | `medium` | — |
| `createdAt` | `DateTime` | Yes | `now()` | — |
| `updatedAt` | `DateTime` | Yes | `@updatedAt` | — |

Relations:
- `workspace` -> `Workspace`
- `createdBy` -> `User?` @relation("TicketCreator", fields: [createdById], references: [id], onDelete: SetNull)
- `messages` -> `Message[]`

Unique:
- none beyond PK

Indexes:
- `workspaceId`
- `createdById`

onDelete:
- `Ticket.workspaceId` -> `Workspace`: `Cascade`
- `Ticket.createdById` -> `User`: `SetNull`

### 4.6 Model Message
| Field | Type | Required | Default | Notes |
|-------|------|----------|---------|-------|
| `id` | `String` | Yes | `cuid()` | PK |
| `ticketId` | `String` | Yes | — | FK -> `Ticket.id` |
| `createdById` | `String` | No | — | FK -> `User.id` |
| `body` | `String` | Yes | — | Validated application-side |
| `createdAt` | `DateTime` | Yes | `now()` | — |
| `updatedAt` | `DateTime` | Yes | `@updatedAt` | — |

Relations:
- `ticket` -> `Ticket`
- `createdBy` -> `User?` @relation("MessageCreator", fields: [createdById], references: [id], onDelete: SetNull)

Unique:
- none beyond PK

Indexes:
- `ticketId`
- `createdById`

onDelete:
- `Message.ticketId` -> `Ticket`: `Cascade`
- `Message.createdById` -> `User`: `SetNull`

Removed:
- `Message.workspaceId` is not present.

### 4.7 User reverse relation fields
Add the following reverse relation fields to `User`:
```
memberships Membership[]
createdTickets Ticket[] @relation("TicketCreator")
createdMessages Message[] @relation("MessageCreator")
```

### 4.8 Validation requirements
- Ticket title: required; reject empty/whitespace after trim; max 140 characters.
- Ticket description: optional; if present, trim; normalize blank input to `null`; max 5000 characters.
- Message body: required; reject empty/whitespace after trim; max 4000 characters.
- Ticket author: authenticated user resolved from server session.
- Message author: authenticated user resolved from server session.

## 5. Workspace provisioning flow
Goal: provide exactly one workspace per authenticated user without implicit layout side effects.

Flow:
1. `/app` resolves workspace membership from authenticated session.
2. If membership exists, render authenticated app.
3. If no membership, redirect to `/app/setup`.
4. `/app/setup` renders an authenticated form with a single “Create workspace” action.
5. Form submission invokes `createDefaultWorkspace()` server action.
6. Server action calls `ensureDefaultWorkspace(userId)`.
7. `ensureDefaultWorkspace` creates a `Workspace` and an owner `Membership` atomically in a Prisma transaction, with default workspace name computed as:
   - `baseName = user.name?.trim() || "My"`
   - `workspaceName = \`${baseName.slice(0, 90)} Workspace\``
   - final result is at most 100 characters; fallback is exactly "My Workspace"
8. Unique conflicts from concurrent requests are handled by fetching the existing membership by `userId` and returning it.
9. On success, redirect to `/app`.
10. On failure, return a generic 500 error page and log server-side details; do not expose internal errors to the client.

Constraints:
- No database mutation in layout rendering.
- No `POST /api/internal/workspace/provision` unless the setup route proves insufficient.

## 6. Authorization behavior
- Unauthenticated UI page: redirect to `/login`.
- Unauthenticated API request: return `401` JSON.
- Authenticated user with no workspace membership: return `403`.
- Cross-workspace ticket/message lookup: return `404`.
- List and create operations must derive `workspaceId` from authenticated membership, never from client input alone.
- A lookup by `ticketId` alone is insufficient; resolve the ticket through membership-scoped lookup first.
- Ticket and message creation allowed for authenticated members in the resolved workspace.

## 7. Task sequence

### Task 1 — Test foundation
Outcome: minimum automated verification environment for Phase 2.

Expected files/areas:
- package.json
- vitest configuration file, e.g., `vitest.config.ts` if required
- `src/__tests__/smoke.test.ts`
- test environment setup for database tests

Non-goals:
- coverage reporting
- browser/E2E tests

Acceptance criteria:
- Vitest installed as a dev dependency
- `npm run test` and `npm run test:watch` execute successfully
- `DATABASE_URL_TEST` is validated and DB tests refuse to run without it
- an initial smoke test proves the Vitest configuration and scripts work
- local development database is never mutated by tests

Verification:
```bash
npm run test
```

Database impact:
- none

Auth/authz impact:
- none

Dependencies:
- none

### Task 2 — Exact Prisma schema and migration
Outcome: add `Workspace`, `Membership`, `Ticket`, `Message`, and related enums with exact fields, relations, constraints, and indexes.

Expected files/areas:
- `prisma/schema.prisma`
- `prisma/migrations/`
- `src/generated/prisma` via `npm run db:generate`

Non-goals:
- change Better Auth models
- add npm scripts beyond test scripts in Task 1
- modify `.env` permanently

Acceptance criteria:
- `npm run db:generate` succeeds
- `npm run db:migrate` succeeds
- `npm run typecheck` passes
- No existing auth columns or table names change
- `Membership.userId` unique is present
- `Ticket.createdById` and `Message.createdById` are nullable strings with optional relations using `SetNull`
- `Message.workspaceId` is absent
- `Ticket.description` is nullable
- `User` gains reverse relation fields `memberships`, `createdTickets`, `createdMessages`

Verification:
```bash
npm run db:generate
npm run typecheck
npm run db:migrate
```

Database impact:
- adds enums and four tables

Auth/authz impact:
- none

Dependencies:
- Task 1

### Task 3 — Workspace provisioning
Outcome: one-time setup flow that creates a default workspace and owner membership exactly once per user.

Expected files/areas:
- `src/app/app/setup/page.tsx`
- `src/app/app/setup/actions.ts` or equivalent server action module
- `src/lib/workspace/server.ts`
- `src/__tests__/provisioning.test.ts`

Non-goals:
- multi-workspace UI
- invites
- billing

Acceptance criteria:
- `/app/setup` is only reachable by authenticated users
- If an authenticated user already has a membership and visits `/app/setup`, redirect them directly to `/app` without rendering or submitting the setup form.
- `ensureDefaultWorkspace` creates workspace and owner membership atomically
- concurrent provisioning returns existing membership without duplicate workspace
- successful flow redirects to `/app`
- failures log server-side and show generic error UI

Verification:
- manual register/login -> `/app/setup` -> `/app`
- manual duplicate setup attempts remain idempotent
- `npm run build`
- `npm run typecheck`

Database impact:
- inserts into new tables only

Auth/authz impact:
- depends on Task 2

Dependencies:
- Task 2

### Task 4 — Workspace resolution and authorization helpers
Outcome: server-side helpers to resolve a user's single membership and enforce workspace-scoped access.

Expected files/areas:
- `src/lib/workspace/server.ts`
- `src/__tests__/workspace-scoping.test.ts`

Non-goals:
- active workspace picker
- role-based UI

Acceptance criteria:
- helper returns workspace and membership or throws unauthorized
- API handlers reject non-members with `403`
- cross-workspace lookups return `404`
- all ticket/message queries include resolved `workspaceId`

Verification:
- manual cross-workspace access returns `404`
- manual no-membership access returns `403`
- `npm run typecheck`

Database impact:
- none

Auth/authz impact:
- active

Dependencies:
- Task 2, Task 3

### Task 5 — Domain service and validation
Outcome: centralized validation and service rules for tickets and messages.

Expected files/areas:
- `src/lib/tickets/server.ts`
- `src/lib/messages/server.ts`
- `src/__tests__/validation.test.ts`

Non-goals:
- assignee workflow
- rich editor
- attachments

Acceptance criteria:
- title validation enforces non-whitespace and max length
- description normalization preserves null when blank
- message body validation enforces non-whitespace and max length
- every mutation requires membership-resolved `workspaceId`

Verification:
- Vitest validation tests cover rules
- `npm run typecheck`

Database impact:
- none

Auth/authz impact:
- depends on Task 4

Dependencies:
- Task 2, Task 3, Task 4

### Task 6 — Route handlers
Outcome: HTTP API surface for tickets and messages.

Expected files/areas:
- `src/app/api/tickets/route.ts`
- `src/app/api/tickets/[id]/route.ts`
- `src/app/api/tickets/[id]/messages/route.ts`

Non-goals:
- admin routes
- batch mutations
- complex filters

Acceptance criteria:
- `GET /api/tickets` returns tickets for resolved workspace
- `POST /api/tickets` validates input and creates ticket
- `GET /api/tickets/[id]` validates membership and returns ticket
- `POST /api/tickets/[id]/messages` validates membership and message body

Verification:
- manual API requests for valid, unauthenticated, and cross-workspace cases
- `npm run build`

Database impact:
- none

Auth/authz impact:
- active

Dependencies:
- Task 2, Task 3, Task 4, Task 5

### Task 7 — Authenticated ticket UI
Outcome: UI for ticket listing, ticket detail, creating tickets, and adding messages.

Expected files/areas:
- `src/app/app/tickets/page.tsx`
- `src/app/app/tickets/[id]/page.tsx`

Non-goals:
- styling overhaul
- reusable design system beyond current patterns

Acceptance criteria:
- listing page shows workspace-scoped tickets
- detail page shows ticket and messages
- create ticket and add message forms work
- unauthenticated access redirects to `/login`
- unauthorized access shows appropriate error state

Verification:
- end-to-end manual flow
- `npm run lint`
- `npm run typecheck`
- `npm run build`

Database impact:
- none

Auth/authz impact:
- uses Task 4 helpers

Dependencies:
- Task 2, Task 3, Task 4, Task 5, Task 6

### Task 8 — Security, regression, and documentation
Outcome: ensure protections are complete and repo documentation reflects Phase 2.

Expected files/areas:
- `README.md`
- `proxy.ts` only if a proven issue requires it

Non-goals:
- dependency upgrades
- large refactors

Acceptance criteria:
- public routes still function
- private routes still require auth
- API auth behavior matches this spec
- documentation updates are accurate
- no debug code remains

Verification:
```bash
npm run lint
npm run typecheck
npm run build
npm run infra:check
npm run test
```

Database impact:
- none

Auth/authz impact:
- regression review

Dependencies:
- Task 2, Task 3, Task 4, Task 5, Task 6, Task 7

## 8. Test strategy
Isolation strategy:
- Use a dedicated PostgreSQL database supplied through `DATABASE_URL_TEST`.
- Hard guard refuses to run database tests without `DATABASE_URL_TEST`.
- Per-test cleanup uses `deleteMany` in foreign-key-safe order.
- Never use or mutate the development `DATABASE_URL`.

Vitest setup:
- Add `vitest` and any required config file.
- Scripts:
  - `test`: `vitest run`
  - `test:watch`: `vitest`

Test assignments:
- Task 1: `src/__tests__/smoke.test.ts` proves Vitest configuration and scripts work.
- Task 3: `src/__tests__/provisioning.test.ts` covers successful provisioning, repeated calls returning existing membership, and conflict handling producing no duplicate workspace or membership.
- Task 4: `src/__tests__/workspace-scoping.test.ts` covers membership resolution, no-membership behavior, and cross-workspace ticket lookup returning not found.
- Task 5: `src/__tests__/validation.test.ts` covers whitespace-only title rejection, blank description normalization to `null`, empty message rejection, and maximum lengths.

Prisma provisioning idempotency testing:
- call `ensureDefaultWorkspace(userId)` twice in a test
- assert only one membership exists
- simulate conflict by precreating a membership and verify the function returns the existing record

Tradeoff:
- Vitest adds one dev dependency but provides direct, fast verification for authorization and validation rules that are otherwise hard to prove manually.

## 9. Verified repository constraints
- Existing package scripts are the only approved commands unless explicitly proposed.
- `src/generated/prisma` is generated locally for verification but is not an expected Git diff because the directory is untracked.
- `prisma/migration_lock.toml` is not required as a manually changed file in scope.
- No existing test files or test framework are present.

## 10. File inventory for `docs/phase-2-spec.md`
The following file is proposed for creation:
- `docs/phase-2-spec.md`

## 11. Approval checklist
- [ ] Approve Prisma schema contract as specified.
- [ ] Approve `Membership.user` as required and `Ticket.createdById`/`Message.createdById` as nullable with `SetNull`.
- [ ] Approve removal of redundant `[userId, workspaceId]` unique on `Membership`.
- [ ] Approve `User` reverse relation fields and explicit relation names for ticket/message creators.
- [ ] Approve test foundation task with Vitest, `DATABASE_URL_TEST` guard, and per-test `deleteMany` cleanup.
- [ ] Approve workspace setup flow: `/app` -> `/app/setup` -> form -> server action -> atomic provisioning.
- [ ] Approve authorization matrix: unauthenticated UI redirect, unauthenticated API `401`, no-membership `403`, cross-workspace `404`.
- [ ] Approve default workspace naming rule: `${baseName.slice(0,90)} Workspace` with fallback "My Workspace".
- [ ] Approve test assignments by task: smoke in Task 1, provisioning in Task 3, scoping in Task 4, validation in Task 5.
- [ ] Approve `/app/setup` redirect for users who already have membership.
- [ ] Confirm acceptance criteria and task sequence.
- [ ] Confirm `docs/phase-2-spec.md` as the canonical spec path.
