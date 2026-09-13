# Phase 7 — Task 1: Team Management

**Status:** Implemented
**Branch:** `phase-7/task-1-team-management`
**Spec:** `docs/phase-7/spec.md` (§5.1 Team Management, §14 Dependencies)

---

## 1. Scope

Task 1 implements the **Team Management** feature area defined in the Phase 7 specification:

- Workspace member listing
- Member detail information
- Current workspace role visibility
- Basic role management using the existing `WorkspaceRole` model
- Assignment eligibility visibility
- Member-related authorization boundaries
- Replacement of the existing members-page placeholder

Out of scope (per spec §5.1): member online status / availability / presence, invitations, OAuth, identity providers, presence tracking.

---

## 2. Architecture

Follows the established RelayDesk layered pattern:

```
UI (components/members/member-list.tsx)
  ↓
Server Actions (lib/members/actions.ts)
  ↓
Domain Services (lib/members/server.ts)
  ↓
API Routes (app/api/members/route.ts, app/api/members/[id]/route.ts)
  ↓
Prisma / Database
```

Authorization boundaries:

```
assertWorkspaceOwner()          ← reusable owner-auth helper (lib/workspace/server.ts)
  ↓
getCurrentMembership()          ← resolves current user's workspace membership
  ↓
prisma.membership.findMany/findUnique  ← scoped to workspaceId
```

---

## 3. Files Changed

### New files

| File | Purpose |
|------|---------|
| `src/lib/members/server.ts` | Member domain service + typed domain errors |
| `src/lib/members/schema.ts` | Zod validation schemas for member role changes |
| `src/lib/members/actions.ts` | Server actions wrapping the domain service |
| `src/app/api/members/route.ts` | `GET /api/members` — list members (auth-gated) |
| `src/app/api/members/[id]/route.ts` | `GET /api/members/:id` detail, `PATCH /api/members/:id` role update |
| `src/components/members/member-list.tsx` | Client component rendering member list + owner-only role editor |
| `src/__tests__/members.service.test.ts` | Domain service unit tests |
| `src/__tests__/members.api.test.ts` | API route integration tests |

### Modified files

| File | Change |
|------|--------|
| `src/lib/workspace/server.ts` | Added `assertWorkspaceOwner()` helper, `WorkspaceMember` type; extended `getWorkspaceMembers()` return shape |
| `src/app/dashboard/members/page.tsx` | Replaced placeholder with real Members page |
| `src/app/dashboard/tickets/page.tsx` | Added `.map()` to preserve backward compatibility with extended `getWorkspaceMembers()` shape |
| `src/app/dashboard/tickets/[id]/page.tsx` | Added `.map()` to preserve backward compatibility |

### Unchanged

- `prisma/schema.prisma` — no migration required; all needed data already exists.

---

## 4. Migration Decision

**No migration was created.**

Rationale:
- `Membership.role` already carries `owner | member` (existing `WorkspaceRole` enum).
- `Membership.createdAt` already provides the joined-at timestamp.
- `User.name`, `User.email`, `User.image` already exist.
- Assignment eligibility is derived from the existing domain rule (membership existence), not from a new data column.

All Task 1 data requirements are satisfied by existing schema.

---

## 5. Owner Authorization Helper

**Location:** `src/lib/workspace/server.ts` — `assertWorkspaceOwner()`

```ts
export async function assertWorkspaceOwner(): Promise<MembershipInfo> {
  const membership = await getCurrentMembership();

  if (membership.role !== 'owner') {
    throw new ForbiddenError('Only workspace owners can perform this action.');
  }

  return membership;
}
```

Properties:
- **Reusable:** used by `updateMemberRole()` here; available to Workspace Settings (Task 2).
- **Server-side:** depends on `getCurrentMembership()`, which calls `getServerAuthSession()`.
- **Built on existing model:** uses `getCurrentMembership()` + `WorkspaceRole.owner`. No new permission system.

---

## 6. Last-Owner Invariant (Serializable + P2034 retry)

Demoting a member to a non-owner role mutates the workspace's owner count, so the demotion path is protected against concurrent conflicting writes. **A plain transaction alone is NOT sufficient for concurrency safety** under PostgreSQL's default `READ COMMITTED` isolation: two concurrent demotions could each observe the same owner count and both commit, leaving the workspace ownerless. The implementation therefore combines `SERIALIZABLE` isolation with explicit conflict retry.

```ts
const updated = await executeWithRetry(() =>
  prisma.$transaction(
    async (tx) => {
      if (parsed.role === 'member') {
        const ownerCount = await tx.membership.count({
          where: { workspaceId: target.workspaceId, role: 'owner' },
        });

        if (ownerCount <= 1) {
          throw new CannotDemoteLastOwnerError();
        }
      }

      return tx.membership.update({ /* ... */ });
    },
    { isolationLevel: 'Serializable' },
  ),
);
```

Mechanism:

1. **Serializable isolation.** The demotion runs inside `prisma.$transaction(..., { isolationLevel: 'Serializable' })`. The `count()` read and the `update()` write are part of the same serializable transaction, so PostgreSQL tracks their dependency set.
2. **Conflict detection.** If two concurrent demotions overlap on the same workspace's owner rows, PostgreSQL detects the serialization anomaly and aborts one with error code `P2034` (Prisma `PrismaClientKnownRequestError` with code `P2034`). Only one of the two conflicting transactions can ever commit — the invariant cannot be violated.
3. **Retry on P2034.** A wrapper retries the *entire* transaction (a fresh `SERIALIZABLE` attempt with a new snapshot) when a `P2034` is observed. The retried attempt re-reads the now-committed owner count, so a demotion that would leave the workspace ownerless is correctly rejected on the retry.
4. **Business errors are not retried.** Errors such as `CannotDemoteLastOwnerError`, `MemberNotFoundError`, `MemberNotInWorkspaceError`, and `InvalidRoleChangeError` are thrown immediately and never retried.
5. **Bounded retry.** Retry is capped at `MAX_SERIAL_RETRIES = 3` (1 initial attempt + 3 retries = 4 total transaction attempts). Delays use exponential backoff with jitter: `RETRY_BASE_MS * 2^attempt + random(RETRY_BASE_MS)` (base = 25 ms). Once retries are exhausted, the `P2034` is surfaced.

`CannotDemoteLastOwnerError` maps to HTTP 400. The retry behavior is verified deterministically by the service tests (transaction-option assertion, P2034 retry path, retry-limit exhaustion, and non-conflict error paths).

---

## 7. Workspace Isolation

Every member query is scoped to the current workspace via `getCurrentMembership().workspaceId`:

- `getMembers()` — `prisma.membership.findMany({ where: { workspaceId: membership.workspaceId } })`
- `getMemberById(id)` — after lookup, validates `row.workspaceId === current.workspaceId`; throws `MemberNotInWorkspaceError` otherwise (HTTP 404).
- `updateMemberRole()` — same cross-workspace check.

Cross-workspace access returns 404 (not 403) to avoid leaking existence of memberships in other workspaces.

---

## 8. Typed Domain Errors

| Error | HTTP | Scenario |
|-------|------|----------|
| `MemberNotFoundError` | 404 | Target membership id does not exist |
| `MemberNotInWorkspaceError` | 404 | Target not in current workspace |
| `CannotDemoteLastOwnerError` | 400 | Demoting last owner |
| `InvalidRoleChangeError` | 400 | New role equals current role (no-op) |
| `ForbiddenError` | 403 | Caller is not workspace owner |
| `UnauthorizedError` | 401 | No authenticated session |

---

## 9. Assignment Eligibility

Assignment eligibility is derived from the existing domain rule: **any workspace member is assignable to tickets**. The `isAssignable` flag is `true` for every member. No new availability or presence model was introduced (spec §5.1 explicitly forbids this).

---

## 10. Backward Compatibility

`getWorkspaceMembers()` previously returned `{ id, name, email }`. Task 1 extended this to `{ id, name, email, image, role, joinedAt, isAssignable }`.

Both existing callers (`src/app/dashboard/tickets/page.tsx`, `src/app/dashboard/tickets/[id]/page.tsx`) consume only the `{ id, name, email }` subset. They were updated to destructure explicitly:

```ts
const members = allMembers.map(({ id, name, email }) => ({ id, name, email }));
```

This preserves the existing contract while enabling richer member data for the Members page.

---

## 11. Tests

### Service tests (`src/__tests__/members.service.test.ts`)

- `assertWorkspaceOwner` defined and callable
- `getMembers` queries Prisma scoped to current workspace; propagates `UnauthorizedError`
- `getMemberById` returns detail for in-workspace member; throws `MemberNotInWorkspaceError` for cross-workspace
- `updateMemberRole` requires owner authorization; throws `ForbiddenError` for non-owner; throws `MemberNotFoundError` for missing target; throws `InvalidRoleChangeError` for no-op
- `updateMemberRole` runs the demotion path in a transaction with `isolationLevel: 'Serializable'`
- `updateMemberRole` enforces last-owner invariant: rejects demotion when only 1 owner; allows when 2+
- `updateMemberRole` retries on `P2034` transaction conflict and eventually succeeds (after 2 conflicts)
- `updateMemberRole` stops retrying after `MAX_SERIAL_RETRIES` and surfaces the conflict (4 total attempts)
- `updateMemberRole` does not retry non-conflict errors (e.g. `CannotDemoteLastOwnerError`)
- Error class names and messages

### API tests (`src/__tests__/members.api.test.ts`)

- `GET /api/members` — 401/403/200 behaviors
- `GET /api/members/:id` — 404 for cross-workspace; 200 for in-workspace
- `PATCH /api/members/:id` — 400 invalid payload; 403 non-owner; 404 missing; 400 last-owner; 400 no-op; 200 valid update

---

## 12. Verification Results

| Check | Result |
|-------|--------|
| `npm run lint` | **PASS** — 0 errors, 0 warnings |
| `npm run typecheck` | **PASS** — 0 errors |
| Focused tests (`src/__tests__/members.service.test.ts`, `src/__tests__/members.api.test.ts`) | **PASS** — 31/31 |
| Full `npm run test` | **61 passed, 2 failed** (63 total files); **590 passed, 10 skipped** (600 total tests) |
| `npm run build` | **PASS** — exit 0 |

### Full-suite failures (both pre-existing, outside Task 1 scope)

| Suite | Error |
|-------|-------|
| `src/__tests__/outbox.atomicity.integration.test.ts` | `PrismaClientKnownRequestError: User was denied access on the database (not available)` |
| `src/__tests__/sla.integration.test.ts` | `PrismaClientKnownRequestError: User was denied access on the database (not available)` |

Both suites create real database rows in a `beforeAll` hook and require the integration database/user provisioned in `.env`:

```
DATABASE_URL=postgresql://relaydesk@localhost:5432/relaydesk
```

Environment verification:
- PostgreSQL container `postgres18` **is running**; `pg_isready` reports accepting connections; `127.0.0.1:5432` is listening.
- The running `postgres18` container currently exposes only the `postgres` role/database, **not** the `relaydesk` role/database that `.env` targets.

Therefore these failures are **environment/database provisioning failures**: the database server is reachable, but the configured `relaydesk` database/role does not exist in this environment. This is not a Postgres-is-down condition, and it is unrelated to Task 1.

### Build warning (pre-existing, outside Task 1 scope)

`npm run build` emits one unrelated Turbopack NFT tracing warning involving `src/lib/attachments/local-storage.ts`. Not introduced by Task 1; left untouched.

---

## 13. Out of Scope (NOT implemented)

Per spec §5.1 / user constraints:

- Workspace Settings (Task 2)
- Saved Views (Task 3)
- Agent Workload (Task 4)
- Analytics (Task 5)
- Member invitations
- Presence / availability tracking
- New migrations

---

## 14. Phase 7 Dependency Chain

Per spec §14:

> Team Management introduces (or reuses) the owner-authorization helper required by privileged Workspace Settings operations.

`assertWorkspaceOwner()` is now established for reuse by Workspace Settings (Task 2). This is the only hard dependency in Phase 7.

---

## 15. Concurrency-Testing Limitation

No live PostgreSQL concurrency test was run for the last-owner demotion path, because the configured integration database/user (`postgresql://relaydesk@localhost:5432/relaydesk`) is unavailable in this environment — the running `postgres18` container exposes only the `postgres` role/database (see §12).

The concurrency mechanism is covered **deterministically** by the service tests:
- the demotion transaction is asserted to be invoked with `{ isolationLevel: 'Serializable' }`;
- a Prisma `P2034` conflict is injected and the retry-then-success path is verified;
- retry-limit exhaustion (4 total attempts) is verified;
- non-conflict business errors (`CannotDemoteLastOwnerError`) are verified to not trigger retries.

A true live-concurrency test (two parallel connections both attempting to demote the last owner, proving PostgreSQL raises `P2034` on one) requires the provisioned integration database and is deferred to the integration suite.
