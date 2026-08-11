# Phase 4 — Task 8: Activity Timeline
## Architecture & Implementation Review

**Review only — no implementation performed.**

---

# 1. Executive Summary

Task 8 should introduce the smallest viable Activity Timeline foundation that is consistent with the actual repository. After inspecting the schema, service layer, mutations, routes, tests, and existing docs, I recommend introducing a dedicated `TicketActivity` model, atomic ticket+activity writes via Prisma transactions, and server-side timeline reads attached to the ticket detail page. For Task 8 scope, I do **not** recommend adding a public activities API endpoint.

# 2. Current Git State

- Branch: `phase-4/integration-task-1-2-3`
- HEAD: `9864d64 docs(tickets): finalize pagination task coverage`
- Status at review start: untracked `review-phase4-task7-pagination.md`
- This review creates only: `review-phase4-task8-activity-timeline.md`

# 3. Existing Architecture

**Models:**
- `User`, `Workspace`, `Membership`, `Ticket`, `Message`
- Ticket domain state lives in `src/lib/tickets/server.ts`
- Workflow rules live in `src/lib/tickets/workflow.ts`
- SLA math lives in `src/lib/tickets/sla.ts`
- Ticket mutations are exposed via Server Actions (`src/lib/tickets/actions.ts`) and REST (`/api/tickets/[id]/route.ts`, `/api/tickets/[id]/assignment/route.ts`, `/api/tickets/route.ts`, `/api/tickets/search/route.ts`)

**Actor model:**
- Actor = current authenticated user resolved by `getCurrentMembership()` from session headers
- User-facing identity fields exposed when included: `id`, `email`, `name`, `image`

**Mutation flow pattern:**
1. membership/auth gate
2. zod validation
3. service mutation
4. cache revalidation / response JSON

**Existing transaction precedent:**
- `src/lib/workspace/server.ts:84` uses `prisma.$transaction(async (tx) => ...)` only for workspace provisioning; ticket mutations currently do **not** use transactions.

**Test architecture:**
- Vitest + vi.mock/vitest spies on `@/lib/workspace/server`, service functions, or raw `prisma` methods
- Tests live in `src/__tests__`
- No DB-backed test runner setup evident

# 4. Existing Ticket Mutation Map

| Mutation | Location | Actor source | Workspace gate | Validation |
|---------|---------|--------------|---------------|-----------|
| Create | `src/lib/tickets/server.ts:60` + API route `src/app/api/tickets/route.ts` | `membership.userId` | yes | `createTicketSchema` |
| Update (status/priority/title/description) | `src/lib/tickets/server.ts:199` + `src/app/api/tickets/[id]/route.ts` | none in service; derived later from session | yes | `updateTicketSchema` + workflow assertion |
| Close | `src/lib/tickets/server.ts:238` + actions | same as update | yes | workflow assertion |
| Assign | `src/lib/tickets/server.ts:271` + `src/app/api/tickets/[id]/assignment/route.ts` | none in service; derived later from session | yes | `assignTicketSchema` + membership check |
| Unassign | `src/lib/tickets/server.ts:317` + `src/app/api/tickets/[id]/assignment/route.ts` | none in service; derived later from session | yes | none beyond membership |
| Create message | `src/lib/messages/server.ts:38` + messages API route | `membership.userId` | yes | `createMessageSchema` |

**Key implication:** assignment mutations do not currently need or receive an explicit actor in service args; actor comes from request context through Server Actions/middleware indirectly via membership check. For atomic activity recording, services will need an explicit actor parameter or a shared helper to read session consistently.

# 5. Prisma Schema Assessment

Current ticket-related schema facts:
- `Ticket` has `workspaceId`, `createdById`, `assignedToId`, `status`, `priority`, SLA timestamps
- `Membership` is the only workspace membership record
- `User.accounts`, `User.sessions`, `User.memberships` exist; no existing generic JSON/metadata field pattern on core domain models
- Existing FK policies:
  - `Ticket.createdById` → nullable + `onDelete: SetNull`
  - `Ticket.assignedToId` → nullable + `onDelete: SetNull`

# 6. Proposed Activity Data Model

**FACT:** No existing activity/audit/history/timeline abstraction is present.

**RECOMMENDATION:** Introduce `TicketActivity` as a first-class model.

```prisma
model TicketActivity {
  id          String            @id @default(cuid())
  ticketId    String
  workspaceId String
  actorId     String?
  type        TicketActivityType
  metadata    Json?
  createdAt   DateTime          @default(now())

  ticket    Ticket     @relation(fields: [ticketId], references: [id], onDelete: Cascade)
  actor     User?      @relation("TicketActivityActor", fields: [actorId], references: [id], onDelete: SetNull)
  workspace Workspace  @relation(fields: [workspaceId], references: [id], onDelete: Cascade)

  @@index([ticketId, createdAt])
  @@index([workspaceId])
  @@index([createdAt])
}
```

```prisma
enum TicketActivityType {
  TICKET_CREATED
  TICKET_ASSIGNED
  TICKET_UNASSIGNED
  STATUS_CHANGED
  PRIORITY_CHANGED
}
```

# 7. Event Type Recommendation

**RECOMMENDATION:** Use these event types:
- `TICKET_CREATED`
- `TICKET_ASSIGNED`
- `TICKET_UNASSIGNED`
- `STATUS_CHANGED`
- `PRIORITY_CHANGED`

**OPEN DECISION:** Whether `MESSAGE_ADDED` belongs in Task 8 or later. Current docs for Task 8 mention activity timeline only around ticket mutations; message activity is not required by the stated objective and should be deferred.

# 8. Actor Strategy

**FACT:** Repo resolves actor from session via `getCurrentMembership()`.

**RECOMMENDATION:**
- `actorId` must be stored explicitly at mutation time
- In services, add optional `actorId?: string` to mutation functions
- Default behavior: derive from `membership.userId`
- If actor is deleted later, preserve history with `onDelete: SetNull` and render `Unknown`

**OBSERVATION:** This matches repo deletion conventions used by `createdById`/`assignedToId`.

# 9. Metadata Strategy

**RECOMMENDATION:** Use minimal typed JSON metadata, not a separate schema.

Suggested shapes:
- `TICKET_CREATED`: `{}`
- `TICKET_ASSIGNED`: `{ "assigneeId": string, "assigneeName"?: string }`
- `TICKET_UNASSIGNED`: `{ "assigneeId": string, "assigneeName"?: string }`
- `STATUS_CHANGED`: `{ "from": string, "to": string }`
- `PRIORITY_CHANGED`: `{ "from": string, "to": string }`

**OBSERVATION:** Avoid normalizing metadata into extra tables/columns at this stage. Keep the event type enum as the structural anchor, use metadata only for diff fields.

# 10. Transaction Strategy

**FACT:** Only one repo transaction exists: workspace provisioning.
Ticket mutations are currently non-transactional.

**RECOMMENDATION:** Wrap every ticket mutation + activity creation in `prisma.$transaction(async (tx) => ...)` inside the ticket service layer.

Example boundary:
- `createTicket()` → `tx.ticket.create(...)` then `tx.ticketActivity.create(...)`
- `updateTicket()` → `tx.ticket.update(...)` then `tx.ticketActivity.create(...)`
- `closeTicket()` → `tx.ticket.update(...)` then `tx.ticketActivity.create(...)`
- `assignTicket()` → `tx.ticket.update(...)` then `tx.ticketActivity.create(...)`
- `unassignTicket()` → `tx.ticket.update(...)` then `tx.ticketActivity.create(...)`

This ensures:
- success => ticket and activity both exist
- failure => neither half-written artifact persists

# 11. Mutation Integration Map

Each mutation needs:
- current service location
- where activity creation occurs
- transaction change requirement
- test impact summary

### Create
- Location: `src/lib/tickets/server.ts:60`
- Actor: `membership.userId`
- Activity: after ticket creation in same transaction
- Test impact: extend `src/__tests__/tickets.service.test.ts`

### Update status/priority/title/description
- Location: `src/lib/tickets/server.ts:199`
- Actor: new required param `actorId`
- Activity: only if provided fields actually change
- Transaction: wrap update + activity
- Test impact: extend service + API tests

### Close
- Location: `src/lib/tickets/server.ts:238`
- Actor: new required param `actorId`
- Activity: only if status changes to `closed`
- Transaction: wrap
- Test impact: extend workflow/action tests

### Assign
- Location: `src/lib/tickets/server.ts:271`
- Actor: new required param `actorId`
- Activity: only if `assignedToId` actually changes
- Transaction: wrap
- Test impact: extend `src/__tests__/ticket-assignment.service.test.ts`

### Unassign
- Location: `src/lib/tickets/server.ts:317`
- Actor: new required param `actorId`
- Activity: only if `assignedToId` was not already null
- Transaction: wrap
- Test impact: extend assignment service tests

# 12. No-op Behavior

**FACT:** Workflow already blocks `current === next` status updates. But assignment/unassignment do not currently short-circuit same-state requests.

**RECOMMENDATION:** Explicitly guard no-op mutations in service:
- status change same value → return existing ticket without activity
- priority same value → return without activity
- assignee same value → return without activity
- unassign when already null → return without activity

This is especially important because assignment mutations currently allow re-writing the same assignee.

# 13. Activity Query Architecture

**RECOMMENDATION:** Add a single service helper in `src/lib/tickets/activity.ts`:

```ts
export async function getTicketActivities(ticketId: string): Promise<TicketActivityWithActor[]>
```

Behavior:
- validate ticket exists in current workspace
- query `TicketActivity` scoped by `ticketId` and `workspaceId`
- order by `createdAt` ascending
- include actor fields needed for UI

**OBSERVATION:** No pagination needed for Task 8. Timeline volume per ticket is expected to be low and bounded to ticket lifecycle events.

# 14. API Architecture Recommendation

**RECOMMENDATION:** No new public API endpoint for Task 8.

Justification:
- Ticket detail page is already server-rendered and can call `getTicketActivities()` directly in `src/app/dashboard/tickets/[id]/page.tsx`
- Existing messages pattern already reads data server-side on the detail page
- Adds no REST surface area for a read-only timeline in this phase

If later an external consumer needs activities, add `/api/tickets/[id]/activities` then.

# 15. UI Architecture Recommendation

**FACT:** Detail page already groups related read-only sections.

**RECOMMENDATION:** Add a single `ActivityTimeline` component under `src/components/tickets/activity-timeline.tsx` and render it on `src/app/dashboard/tickets/[id]/page.tsx`.

Render contract per activity:
- relative/local timestamp
- actor name or `Unknown`
- human-readable action text
- old/new values when relevant

**OBSERVATION:** Message list pattern is a good reusable model for timeline items. Use same visual card/row rhythm and dark-mode classes.

# 16. Workspace Isolation Strategy

**RECOMMENDATION:** Enforce isolation at both service and query boundaries.

- `getTicketActivities()` must filter by `workspaceId`
- `createTicketActivity()` helper must require `workspaceId`
- All activity creation should use ticket membership validation already present in mutations

Invariant: a user must never read or write activity for a ticket outside their workspace.

# 17. Indexing Recommendation

Recommended indexes only if a new `TicketActivity` model is introduced:
- `@@index([ticketId, createdAt])` — primary read path
- `@@index([workspaceId])` — supports membership scoping
- `@@index([createdAt])` — supports future time-boxed queries/debugging

Do not add speculative multi-column indexes.

# 18. Test Strategy

**NEW TESTS:**
- activity service creates expected activity for each mutation
- activity stores correct actor
- activity stores correct metadata
- no-op mutations do not create activity
- activities are returned ordered by `createdAt`
- activities are workspace-scoped
- unauthorized/forbidden does not create activity
- failed ticket mutation does not leave orphan activity
- successful mutation and activity creation are atomic via mocked transaction

**EXISTING TESTS TO EXTEND:**
- `src/__tests__/tickets.service.test.ts`
- `src/__tests__/ticket-assignment.service.test.ts`
- `src/__tests__/tickets.actions.test.ts`
- `src/__tests__/ticket-detail-api.auth.test.ts`
- `src/__tests__/tickets.api.regression.test.ts`

# 19. Documentation Plan

- Update `docs/phase-4/task-8.md` with:
  - data model
  - event types and metadata contract
  - transaction behavior
  - UI placement
  - test plan
- Update `docs/phase-4/spec.md` Task 8 acceptance criteria to reflect:
  - read-only timeline only
  - no API endpoint
  - no pagination for Task 8

# 20. Scope Boundary / Non-Goals

Task 8 must not include:
- realtime/WebSocket
- notifications
- email
- reporting/analytics
- SLA escalation
- activity search/filter/sort
- activity edit/delete
- infinite scroll or speculative pagination
- application-wide audit logging
- message timeline activity unless explicitly re-scoped

# 21. Proposed Files to Change

- `prisma/schema.prisma`
- `src/lib/tickets/activity.ts` (new)
- `src/lib/tickets/server.ts`
- `src/lib/tickets/actions.ts`
- `src/app/dashboard/tickets/[id]/page.tsx`
- `src/components/tickets/activity-timeline.tsx` (new)

# 22. Schema/Migration Impact

- Additive migration only: new `TicketActivity` table, new enum
- No modification to existing ticket/user/membership tables
- Backward compatible

# 23. API Contract Impact

- No public API contract change
- Server Actions signatures may change if explicit `actorId` parameter is added

# 24. UI Impact

- New timeline section on ticket detail
- Responsive and accessible
- Dark-mode consistent with existing cards/badges

# 25. Risks / Trade-offs

- **Risk:** Transaction adoption changes rollback semantics in tests and could surface connection-management assumptions.
- **Risk:** Reusing raw `prisma` `Json` may lose some type safety; compensate with runtime shape checks or a small typed wrapper.
- **Risk:** Actor parameter plumbing can leak into many test mocks; keep mutation signatures small.

# 26. Implementation Plan

1. Add `TicketActivity` model + enum + indexes + migration
2. Add `recordTicketActivity()` helper
3. Add `getTicketActivities()` service
4. Wrap ticket mutations in transactions
5. Integrate UI timeline on ticket detail
6. Add/extend tests
7. Update docs
8. Run lint, typecheck, build, tests

# 27. Acceptance Criteria

- ticket creation records `TICKET_CREATED`
- assignment records `TICKET_ASSIGNED` with assignee metadata
- unassignment records `TICKET_UNASSIGNED`
- valid status change records `STATUS_CHANGED` with from/to
- valid priority change records `PRIORITY_CHANGED` with from/to
- actor is recorded accurately
- timeline renders chronologically on ticket detail
- no-op mutations do not create activities
- workspace isolation is enforced on timeline queries
- successful ticket mutation implies activity exists

# 28. Definition of Done

- `npm run lint` passes
- `npm run typecheck` passes
- `npm run build` passes
- `npm run test` passes
- timeline visible on ticket detail for created tickets and mutations
- activity volume under current limits does not require pagination

# 29. Final Recommendation

Proceed with the smallest dedicated `TicketActivity` model, transaction-backed activity writes in the ticket service layer, and server-rendered timeline on the ticket detail page. Do not add a public activities API in Task 8 unless product requirements explicitly demand cross-page consumption of activity data.

---

# Architecture Clarification — Rune Review

## 1. TicketActivity workspaceId

**FACT**
- All current ticket queries enforce workspace isolation by joining through `Ticket.workspaceId` or by pre-validating ticket existence in the current workspace before secondary queries.
- Messages query in `src/app/api/tickets/[id]/messages/route.ts:21` queries `prisma.message.findMany({ where: { ticketId } })` without repeating `workspaceId`; isolation is enforced by the prior ticket existence check at `src/app/api/tickets/[id]/messages/route.ts:12`.
- The proposed `TicketActivity` read path would follow the same pattern: validate ticket membership, then query activities by `ticketId`.

**OBSERVATION**
- Adding `workspaceId` to `TicketActivity` duplicates an invariant already enforced by `Ticket.workspaceId`.
- Without `workspaceId`, activity queries still remain correct as long as they are gated by verified ticket ownership.
- `workspaceId` would only add value for direct, ticket-independent activity queries by workspace, which Task 8 does not require.

**RECOMMENDATION**
Remove `workspaceId` from `TicketActivity`. Derive workspace ownership through `Ticket`. Enforce isolation at the service boundary by validating the ticket exists in the current workspace before querying or writing activities. Keep the index set to:
- `@@index([ticketId, createdAt])`
- `@@index([createdAt])`

This is the smallest safe design and avoids a duplicated invariant.

**OPEN DECISION**
- None.

---

## 2. Assignment metadata

**FACT**
- Current assignment mutations are split: `assignTicket` writes `assignedToId`, `unassignTicket` writes `assignedToId = null`.
- There is no existing assignment history model; a single reassignment currently appears as one atomic update, not a visible transition pair.
- User `name` is mutable in the schema and not a stable identifier; deleted users become `null` via `onDelete: SetNull`.

**OBSERVATION**
- Storing `assigneeName` risks stale display data after user renames.
- Using `from → to` with user IDs gives deterministic history regardless of later user changes.
- `null` cleanly represents unassigned state and matches the existing nullable `assignedToId` semantics.

**RECOMMENDATION**
Use one consistent metadata shape for both assignment and unassignment:

- `TICKET_ASSIGNED`: `{ from: string | null, to: string }`
- `TICKET_UNASSIGNED`: `{ from: string, to: null }`

For reassignment via separate assign/unassign calls, this naturally produces two activities. If later a dedicated reassignment flow is added, the same metadata shape still applies.

**OPEN DECISION**
- None.

---

## 3. Actor strategy

**FACT**
- `createTicket`, `updateTicket`, `closeTicket`, `assignTicket`, and `unassignTicket` in `src/lib/tickets/server.ts` already call `getCurrentMembership()` internally.
- This means every ticket service mutation can deterministically derive `membership.userId` without any caller-provided actor parameter.
- Existing tests mock `getCurrentMembership` at the module boundary, so actor resolution remains testable without changing call-site signatures.

**OBSERVATION**
- Introducing an explicit `actorId` parameter across all ticket mutations would widen the API surface and force more signature churn.
- An optional actor parameter invites non-determinism when a caller forgets to pass it.
- Keeping actor resolution inside the service preserves consistency with how `createTicket` already derives `createdById`.

**RECOMMENDATION**
Resolve the actor inside the ticket service layer from `getCurrentMembership().userId`. Do not add `actorId` parameters to public mutation signatures. This keeps actor deterministic, avoids optional-plumbing risk, and matches existing service conventions.

**OPEN DECISION**
- None.

---

## 4. Transaction strategy

**FACT**
- Existing ticket mutations are linear, single-query writes using `prisma.ticket.create(...)` or `prisma.ticket.update(...)`.
- One existing transaction precedent exists in `src/lib/workspace/server.ts:84`: `prisma.$transaction(async (tx) => { ... })`.
- Existing tests mock individual `prisma` methods, and `src/__tests__/provisioning.test.ts` already demonstrates mocking `prisma.$transaction` by executing the callback with a transaction-client mock.

**OBSERVATION**
- Wrapping each mutation in `prisma.$transaction` is necessary only when two writes must be atomic: ticket mutation + `TicketActivity` creation.
- For mutations that do not create activity, no transaction wrapper is required.
- Creating a new transaction abstraction would add unnecessary indirection; inline transactions stay close to the data change.

**RECOMMENDATION**
Use inline `prisma.$transaction(async (tx) => { ... })` only in mutations that write both a ticket and an activity. Keep it local to the service function rather than introducing a shared wrapper. Tests can remain maintainable by mocking `prisma.$transaction` and supplying a mocked transaction client, consistent with the existing provisioning test pattern.

**OPEN DECISION**
- None.

---

## 5. Event boundary

**FACT**
- `updateTicketSchema` permits optional `title`, `description`, `status`, and `priority` in one mutation payload.
- Task 8 scope explicitly targets ticket lifecycle events: creation, assignment, unassignment, status change, and priority change.
- Messages are created through a separate module (`src/lib/messages/server.ts`) and are explicitly treated as a distinct domain concern.

**OBSERVATION**
- Emitting activity for `title` or `description` changes would expand scope without evidence that it is required for Task 8.
- Message creation should remain outside Task 8 because the objective focuses on ticket mutations, not conversational history.
- Server Actions / UI interactions should not emit raw activity events directly; they should remain thin wrappers over service mutations so activity creation stays centralized.

**RECOMMENDATION**
Confirmed event boundary:

- `CREATE` → `TICKET_CREATED`
- `ASSIGN` → `TICKET_ASSIGNED`
- `UNASSIGN` → `TICKET_UNASSIGNED`
- `STATUS` → `STATUS_CHANGED`
- `PRIORITY` → `PRIORITY_CHANGED`

Explicitly no activity for:
- `TITLE`
- `DESCRIPTION`
- `MESSAGE`
- raw UI actions

**OPEN DECISION**
- None.

---

## Recommended Final Architecture

### Data model
- New model: `TicketActivity`
- Fields: `id`, `ticketId`, `actorId`, `type`, `metadata`, `createdAt`
- No `workspaceId`; workspace ownership is derived through `Ticket`
- Enums: `TicketActivityType { TICKET_CREATED, TICKET_ASSIGNED, TICKET_UNASSIGNED, STATUS_CHANGED, PRIORITY_CHANGED }`
- Relations:
  - `ticket` → `Ticket` with `onDelete: Cascade`
  - `actor` → `User?` with `onDelete: SetNull`
- Indexes: `[ticketId, createdAt]`, `[createdAt]`

### Event types
- `TICKET_CREATED`
- `TICKET_ASSIGNED`
- `TICKET_UNASSIGNED`
- `STATUS_CHANGED`
- `PRIORITY_CHANGED`

### Metadata
- `TICKET_CREATED`: `{}`
- `TICKET_ASSIGNED`: `{ from: string | null, to: string }`
- `TICKET_UNASSIGNED`: `{ from: string, to: null }`
- `STATUS_CHANGED`: `{ from: string, to: string }`
- `PRIORITY_CHANGED`: `{ from: string, to: string }`

### Actor strategy
- Resolved inside service layer from `getCurrentMembership().userId`
- Stored as non-nullable `actorId` because the service boundary guarantees session-backed mutation execution
- If the actor user is deleted later, keep `onDelete: SetNull` for safety; UI renders `Unknown`

### Transaction strategy
- Use inline `prisma.$transaction(async (tx) => { ... })` inside ticket mutations that also create activity
- No new shared abstraction
- Tests mock `prisma.$transaction` and provide a mocked transaction client, following the existing provisioning test pattern

### Event boundary
- Create → `TICKET_CREATED`
- Assign → `TICKET_ASSIGNED`
- Unassign → `TICKET_UNASSIGNED`
- Status change → `STATUS_CHANGED`
- Priority change → `PRIORITY_CHANGED`
- Title, description, message, and generic UI actions → no activity

---

**Implementation remains halted pending final approval.**
