# Phase 8 — Task 4: Configurable SLA Policies

**Status:** Implemented
**Branch:** `phase-8/task-4-configurable-sla-policies`
**Commit:** `10ddcc8` — `feat(sla): add configurable workspace SLA policies`

> This document is a closeout record reconstructed from the authoritative
> `docs/phase-8/spec.md` and from the actual implementation in commit
> `10ddcc81b0f0495125517a8d46d471ff0402367f`. It documents what the code does,
> including the one place where the implementation does not meet the original
> spec — see [Known Notes](#known-notes).

## 1. Objective

Replace hard-coded SLA durations with workspace-owned configuration while
keeping the existing ticket deadline, evaluation, and monitoring architecture
intact.

The phase spec requires (spec §7, §11):

* one active SLA policy per workspace
* response and resolution durations per ticket priority
* wall-clock minutes
* the default policy must preserve current RelayDesk durations
* the policy layer must **feed** the existing SLA deadline calculation rather
  than introduce a second SLA evaluator
* only workspace owners may modify the policy
* all reads and writes workspace-scoped and server-authorized

Task 4 is intentionally independent of the rule-builder work: it touches no
automation evaluation code.

## 2. Scope Delivered

* `WorkspaceSlaPolicy` model, one row per priority per workspace
* migration that creates the table, seeds every existing workspace, and adds the
  unique and workspace indexes
* owner-only settings UI on `/dashboard/settings`
* new-ticket deadline calculation from the active workspace policy
* existing at-risk / breach monitoring continues to work unchanged
* provisioning of default policies for newly created workspaces
* tests

## 3. Architecture

The implementation follows the mandated layering (spec §11):

```text
/dashboard/settings  (SlaPolicyForm — client component)
        ↓
src/lib/workspace/actions.ts   (getWorkspaceSlaPoliciesAction /
                                updateWorkspaceSlaPoliciesAction)
        ↓
zod validation (slaPolicyInputSchema)
        ↓
src/lib/workspace/sla-policy.ts (getWorkspaceSlaPolicies,
                                 updateWorkspaceSlaPolicies,
                                 getWorkspaceSlaPolicy)
        ↓
Prisma
```

`GET`/`PATCH /api/workspace-sla-policies` exposes the same service layer for
non-Server-Action clients.

Ticket creation reaches the policy from the ticket service, not the reverse:

```text
createTicket()  →  getWorkspaceSlaPolicy(tx, workspaceId, priority)
               →  toResponseDeadlineMs() / toResolutionDeadlineMs()
               →  persisted responseSlaDeadline / resolutionSlaDeadline
```

The policy read accepts an injected `PrismaClient | Prisma.TransactionClient`,
so the policy lookup and the ticket insert share **one** transaction. There is
no second SLA evaluator: `src/lib/sla/evaluation.ts` was not modified and
continues to evaluate the already-persisted deadline columns. The one place
where the implementation diverges from the letter of spec §11 is noted in
[Known Notes](#known-notes): it adds policy-row converters rather than feeding
the pre-existing deadline calculators.

## 4. Data Model

```prisma
model WorkspaceSlaPolicy {
  id                String         @id @default(cuid())
  workspaceId       String
  priority          TicketPriority
  responseMinutes   Int
  resolutionMinutes Int
  createdAt         DateTime       @default(now())
  updatedAt         DateTime       @updatedAt

  workspace Workspace @relation(fields: [workspaceId], references: [id], onDelete: Cascade)

  @@unique([workspaceId, priority])
  @@index([workspaceId])
}
```

Design decisions:

* **Normalized, one row per priority.** The spec (§9, SlaPolicy) prefers a
  normalized model. The `(workspaceId, priority)` unique constraint makes
  "one active policy per priority" a database invariant rather than an
  application convention.
* **Minutes are stored, not milliseconds.** The spec (§7.3) requires wall-clock
  minutes. Storing minutes keeps the configuration human-readable and confines
  unit conversion to `minutesToMs()` in `src/lib/tickets/sla.ts`.
* **Cascade delete** removes policies with their workspace; no orphan rows.
* **No analytics counters.** The spec (§9) forbids analytics-specific persisted
  counters. Nothing was added — analytics continues to compute from live ticket
  data.

## 5. Migration

```text
prisma/migrations/20260921120000_add_workspace_sla_policies/migration.sql
```

The migration:

1. creates `WorkspaceSlaPolicy`;
2. adds the unique `(workspaceId, priority)` index and the `workspaceId` index;
3. adds the cascading foreign key to `Workspace`;
4. **backfills** the four canonical default rows for every existing workspace
   using deterministic ids `sla_<workspaceId>_<priority>`.

The SQL comment in the migration records the seeded values and states that they
must match `DEFAULT_SLA_POLICIES_MINUTES` exactly:

| Priority | Response (min) | Resolution (min) |
| --- | --- | --- |
| `low` | 1440 (24h) | 7200 (5d) |
| `medium` | 480 (8h) | 4320 (3d) |
| `high` | 240 (4h) | 1440 (1d) |
| `urgent` | 60 (1h) | 240 (4h) |

Apply with:

```bash
npx prisma migrate deploy   # production/staging
npx prisma migrate dev      # local development
```

The backfill is what preserves existing behavior: pre-Task-4 tickets were
created with exactly these durations, so seeded workspaces continue to issue
identical deadlines.

## 6. SLA Semantics

`src/lib/tickets/sla.ts` was refactored so the canonical default is expressed
once, in minutes:

```ts
export const DEFAULT_SLA_POLICIES_MINUTES: Record<TicketPriority, SlaPolicyMinutes> = { … }
export function minutesToMs(minutes: number): number
export function slaPolicyMinutesToMs(policy: SlaPolicyMinutes): SlaPolicy
export const DEFAULT_SLA_POLICIES = /* derived from the above */
```

The pre-existing `DEFAULT_SLA_POLICIES` (millisecond form) is retained and now
*derived* from the minute definition, so the millisecond constants still exist
in exactly one place. The monitoring helpers — `getResponseSlaMonitoringStatus`,
`getResolutionSlaMonitoringStatus`, `AT_RISK_THRESHOLD_RATIO`, and the
overdue/elapsed helpers — are unchanged and still used by the live evaluation
path.

Two categories of dead export in this file should not be conflated:

* `calculateResponseDeadline` and `calculateResolutionDeadline` **were** live
  before this task — `createTicket` called them — and this task orphaned them by
  routing deadline creation through the policy converters instead. That is a
  consequence of this task.
* `getSlaPolicy`, `getResponseSlaStatus`, and `getResolutionSlaStatus` already
  had no production caller before this task (verified against the pre-Task-4
  commit `a9aab1e`), so their unused status is pre-existing and not attributable
  to Task 4.

Preserved semantics (spec §7.5): UTC timestamps, wall-clock durations, the
existing at-risk threshold, existing breach semantics, the existing background
scheduler, and existing duplicate-notification suppression. Business hours,
holidays, and calendar-based SLA remain out of scope and were not introduced.

### Deadline application

| Scenario | Spec requirement | Implementation |
| --- | --- | --- |
| New ticket | compute from active workspace policy | `createTicket()` reads the policy inside its transaction and persists both deadlines |
| Priority change | recalculate from original `createdAt` without resetting elapsed time | **not implemented** — see [Known Notes](#known-notes) |
| Policy change | apply to new tickets only; existing tickets keep persisted deadlines | satisfied — no retroactive mass mutation exists |

## 7. Authorization

| Surface | Requirement | Mechanism |
| --- | --- | --- |
| Read policies (`getWorkspaceSlaPolicies`) | any workspace member | `getCurrentMembership()`; workspace comes from the session |
| Update policies (`updateWorkspaceSlaPolicies`) | workspace owner only | `assertWorkspaceOwner()` |
| Ticket-creation lookup (`getWorkspaceSlaPolicy`) | internal | takes `workspaceId` from the caller's membership, never from input |

Server-authorized end to end. The `SlaPolicyForm` receives a `canEdit` prop and
disables its inputs and submit button for non-owners, but that is presentation
only — the service layer is the actual boundary, and a member calling the
Server Action or `PATCH` directly is rejected with `403`. No client-supplied
`workspaceId` is trusted anywhere; a test asserts a client `workspaceId` cannot
cross the tenant boundary.

`GET /api/workspace-sla-policies` is member-readable and returns `401`
unauthenticated / `403` without membership. `PATCH` returns `400` for invalid
payloads, `401` / `403` for authorization failures, and `500` otherwise.

## 8. Failure Semantics

The policy layer deliberately **fails loudly instead of defaulting**:

* `getWorkspaceSlaPolicy()` throws `SlaPolicyNotFoundError` when a row is
  missing during ticket creation.
* `getWorkspaceSlaPolicies()` throws `SlaPolicyInvariantError` when the set is
  not exactly one row per priority (missing or extra row).
* Database errors propagate on both read and update.

Rationale: silently falling back to hard-coded defaults would hide a
misconfigured workspace and reintroduce the very magic this task removes. A
missing policy is a configuration error, not a defaulting opportunity. This
behavior is asserted by tests.

`updateWorkspaceSlaPolicies()` updates all four rows inside one
`prisma.$transaction`, so a partial update can never leave a mixed
configuration. It uses `update` (not `upsert`), which means a missing row
surfaces as a database error rather than being silently created.

## 9. Provisioning

`ensureDefaultWorkspace()` in `src/lib/workspace/server.ts` creates the
workspace, the four default policy rows via `buildDefaultSlaPolicyData()`, and
the owner membership inside a single transaction. Workspace creation and SLA
initialization are therefore atomic — if policy seeding fails, the workspace is
not left without policies. A test asserts this rollback.

`buildDefaultSlaPolicyData()` is derived from `DEFAULT_SLA_POLICIES_MINUTES`,
keeping the application-level default the single source of truth shared with the
migration.

## 10. UI

`src/components/workspace/sla-policy-form.tsx` is a client component rendered by
`/dashboard/settings` alongside the existing workspace name form. It presents
eight numeric inputs (response and resolution for each of the four
priorities), shows a human-readable approximation of each duration, submits
through `updateWorkspaceSlaPoliciesAction`, and calls
`revalidatePath('/dashboard/settings')` on success. Non-owners see the
read-only values with editing disabled.

Client-side validation is limited to "must be a positive integer" per field.
The full bounds — the 1-minute minimum and the 365-day `MAX_SLA_MINUTES`
ceiling — are enforced server-side by `slaPolicyInputSchema`, which is the
actual boundary, so browser validation is a convenience rather than a
constraint.

The existing generic `Card`, `Input`, `Label`, and `Button` primitives are
reused; no separate visual system was introduced. That same commit also
flattened the pre-existing workspace-name card into the page, since the settings
page had begun composing its own section layout.

## 11. Files

### New Files

* `prisma/migrations/20260921120000_add_workspace_sla_policies/migration.sql`
* `src/lib/workspace/sla-policy.ts` — service, zod schema, errors, default data
* `src/app/api/workspace-sla-policies/route.ts` — `GET` + `PATCH`
* `src/components/workspace/sla-policy-form.tsx` — owner-only settings form
* `src/__tests__/sla-policy.api.test.ts` — 10 tests
* `src/__tests__/sla-policy.provisioning.test.ts` — 2 tests
* `src/__tests__/sla-policy.schema.test.ts` — 19 tests
* `src/__tests__/sla-policy.service.test.ts` — 17 tests
* `src/__tests__/sla-policy.ticket-creation.test.ts` — 4 tests

### Modified Files

* `prisma/schema.prisma` — `WorkspaceSlaPolicy` model and `Workspace.slaPolicies`
* `src/lib/tickets/sla.ts` — minute-based canonical defaults, `minutesToMs`
* `src/lib/tickets/server.ts` — `createTicket` reads the workspace policy inside
  its transaction
* `src/lib/workspace/server.ts` — provisioning of default policy rows
* `src/lib/workspace/actions.ts` — two Server Actions
* `src/app/dashboard/settings/page.tsx` — loads policies, renders the form
* `src/__tests__/provisioning.test.ts`, `src/__tests__/tickets.service.test.ts`,
  `src/__tests__/tickets.activity.service.test.ts`,
  `src/__tests__/ticket-assignment.service.test.ts` — updated for the new
  transactional policy read

## 12. Testing

52 focused tests across five files:

**Schema (19)** — accepts a complete valid payload; requires exactly four
entries; rejects more, fewer, or empty; rejects duplicate priorities; rejects a
missing priority even when four entries are present; rejects zero, negative,
non-integer, and string-coerced minutes; enforces the upper bound and accepts
values exactly at it; rejects unknown priorities; accepts the 1-minute minimum.

**Service (17)** — member can read; unauthenticated and no-membership reads
rejected; invariant error on missing or extra row (no silent fallback); read
uses the membership workspace, never a client id; unauthenticated and non-owner
updates rejected; owner update allowed; a client `workspaceId` cannot cross the
tenant boundary; all four policies update in one transaction; internal
single-policy lookup returns the row, throws when missing, and uses the supplied
transaction-capable client; database errors propagate on read and update;
`buildDefaultSlaPolicyData` yields four canonical rows.

**Ticket creation (4)** — a new ticket uses workspace-specific response and
resolution values inside one transaction; a missing policy row raises a
configuration error rather than defaulting; workspace A's custom policy is used
instead of silently inheriting canonical defaults; existing ticket deadlines are
unchanged when the policy changes afterward.

**API (10)** — `GET` 401 / 403 / 200; `PATCH` 401, 403 non-owner, 400 invalid
payload, 400 fewer than four entries, 400 malformed JSON, 200 valid, 400
duplicate priorities.

**Provisioning (2)** — a new workspace receives exactly four policy rows
matching canonical defaults; workspace creation and SLA initialization are
atomic and roll back together.

No SLA evaluation, at-risk, breach, or notification test needed modification,
which is the regression evidence that the existing monitoring path is untouched
— only the values it reads are now policy-derived.

## 13. Verification

Verified as part of the Phase 8 closeout on `main`:

```bash
npx vitest run src/__tests__/sla-policy.api.test.ts \
  src/__tests__/sla-policy.provisioning.test.ts \
  src/__tests__/sla-policy.schema.test.ts \
  src/__tests__/sla-policy.service.test.ts \
  src/__tests__/sla-policy.ticket-creation.test.ts
# 5 test files, 52 tests passed
```

Phase 8 results are recorded in `README.md`; this task's contribution is the
52-test focused suite above. The repository-wide suite could not be run in full
during the closeout because no PostgreSQL instance was available, which affects
seven `*.integration.test.ts` files unrelated to this task — see `README.md`
§ *Phase 8*.

The production build emits a pre-existing Next/Turbopack NFT tracing warning
originating from `src/lib/attachments/local-storage.ts` via `next.config.ts`. It
predates Phase 8 and is unrelated to this task.

## 14. Known Notes

**Priority-change recalculation is not implemented.** Spec §7.4 and success
criterion §21.9 require that when ticket priority changes, the response and
resolution deadlines are recalculated from the ticket's original `createdAt`
using the new priority's policy, without resetting elapsed time. The
implementation writes a `PRIORITY_CHANGED` activity row and emits the
`ticket.priority_changed` automation trigger, but does **not** touch
`responseSlaDeadline` or `resolutionSlaDeadline`. `src/lib/tickets/server.ts`
lines 93–94 remain the only site in the repository that computes those
deadlines, and every other reference across the codebase is a read-only
projection used by SLA evaluation, analytics, workload, and the ticket UI.

Consequence: a ticket keeps the deadline it was created with even if its
priority later changes. Behavior is internally consistent and the persisted
deadline remains the source of truth, but it does not match the spec's stated
priority-change semantics. This is a documented gap, not a hidden one.

**The existing deadline calculator functions are now bypassed.** Spec §11
requires that the SLA policy layer "feed the existing SLA deadline calculation
functions instead of creating a second SLA evaluator". `createTicket` does not
call `calculateResponseDeadline` or `calculateResolutionDeadline`; it calls the
new `toResponseDeadlineMs` / `toResolutionDeadlineMs` converters in
`src/lib/workspace/sla-policy.ts`, which derive milliseconds from the policy
row's `responseMinutes` / `resolutionMinutes`. The intent of §11 is honored —
`src/lib/sla/evaluation.ts` is untouched, so there is still exactly one SLA
evaluator — but the pre-existing calculator functions now have no production
caller and survive only as unit-tested exports.

Two consequences follow, both benign but worth recording:

* `src/__tests__/tickets.service.test.ts` still mocks
  `getSlaPolicy`, `calculateResponseDeadline`, and `calculateResolutionDeadline`
  in a `vi.mock('@/lib/tickets/sla')` block. Those mocks are now inert for
  deadline computation. The test itself was correctly updated to stub
  `tx.workspaceSlaPolicy.findUnique`, so its assertions are valid; the SLA
  deadline it produces derives from the stubbed `responseMinutes` /
  `resolutionMinutes`, not from the stubbed `responseDurationMs`. The
  vestigial mock block is misleading and should be pruned.
* The pre-existing SLA unit tests still exercise
  `calculateResponseDeadline` / `calculateResolutionDeadline` directly, so they
  pass and act as regression tests for the default-duration arithmetic, but they
  no longer describe the code path that creates tickets.

Other notes:

* `updateWorkspaceSlaPolicies()` uses `update` rather than `upsert`, so it
  depends on provisioning having created all four rows. This is intentional and
  matches the fail-loud posture, but it means a workspace seeded outside the
  migration/provisioning path cannot be repaired through the settings UI alone.
* The `GET` handler returns `error.message` verbatim for any `Error` instance,
  whereas its sibling `PATCH` handler returns a fixed generic string for the
  same class of failure. Prisma's request errors extend `Error`, so a database
  failure surfaced through `GET` can put a Prisma-generated message such as a
  unique-constraint violation into the response body. No stack traces are
  returned and the route is workspace-scoped, so the practical impact is low,
  but the two handlers are inconsistent with each other and with the automation
  execution routes added in Task 5, which map errors to stable codes.
* The same handler maps `SlaPolicyInvariantError` to `500`. The status code is
  defensible, but a misconfigured workspace is a configuration problem rather
  than a server fault, and it is indistinguishable from a genuine outage.
