# Phase 7 — Task 2: Workspace Settings

**Status:** Implemented
**Branch:** `phase-7/task-2-workspace-settings`
**Spec:** `docs/phase-7/spec.md` (§5.2 Workspace Settings, §14 Dependencies)

---

## 1. Scope

Task 2 implements the **Workspace Settings** feature area defined in the Phase 7 specification, limited strictly to the **workspace name** setting:

- Workspace name read (any authenticated workspace member)
- Workspace name update (OWNER-ONLY)
- Server-side Zod validation
- Replacement of the existing settings-page placeholder

Out of scope (per spec §5.2): operational preferences, default ticket behavior, display preferences, notification settings, SLA settings, business-hour/holiday policy, automation rules, OAuth, integrations, email provider administration, invitations, workspace deletion/transfer.

---

## 2. Architecture

Follows the established RelayDesk layered pattern:

```
UI (components/workspace/workspace-name-form.tsx)
  ↓
Server Actions (lib/workspace/actions.ts)
  ↓
Domain Services (lib/workspace/settings.ts)
  ↓
API Routes (app/api/workspace-settings/route.ts)
  ↓
Prisma / Database
```

Authorization boundaries:

```
assertWorkspaceOwner()            ← reusable owner-auth helper (lib/workspace/server.ts, from Task 1)
  ↓
getCurrentMembership()            ← resolves current user's workspace membership
  ↓
prisma.workspace.findUnique/update  ← scoped to membership.workspaceId
```

Hard dependency: reuses `assertWorkspaceOwner()` introduced in Task 1 (spec §14.1).

---

## 3. Files Changed

### New files

| File | Purpose |
|------|---------|
| `src/lib/workspace/settings.ts` | Workspace domain service: `getWorkspaceSettings()`, `updateWorkspaceName()`, `workspaceNameSchema`, `MAX_WORKSPACE_NAME_LENGTH` |
| `src/lib/workspace/actions.ts` | Server actions wrapping the domain service |
| `src/app/api/workspace-settings/route.ts` | `GET /api/workspace-settings` read, `PATCH /api/workspace-settings` update |
| `src/components/workspace/workspace-name-form.tsx` | Client form: editable input (owner), success/error/validation feedback, accessible labels |
| `src/__tests__/workspace-settings.validation.test.ts` | Zod schema unit tests |
| `src/__tests__/workspace-settings.service.test.ts` | Domain service unit tests (auth, validation, persistence, isolation) |
| `src/__tests__/workspace-settings.api.test.ts` | API route integration tests |

### Modified files

| File | Change |
|------|--------|
| `src/app/dashboard/settings/page.tsx` | Replaced placeholder with real settings UI (resolves role, renders `WorkspaceNameForm`, auth error states) |

### Unchanged

- `prisma/schema.prisma` — no migration required. All needed data (`Workspace.id`, `Workspace.name`) already exists.
- `src/lib/members/*` — Team Management behavior untouched.

---

## 4. Workspace-Name Validation Rules

Implemented in `src/lib/workspace/settings.ts` via Zod (`workspaceNameSchema`):

| Rule | Behavior |
|------|----------|
| Must be a string | Non-string input rejected with `"Workspace name is required"` |
| Trim | Leading/trailing whitespace trimmed via `.trim()` in the schema and pre-validate |
| Not empty after trim | Rejected with `"Workspace name cannot be empty"` |
| Max 100 characters | Rejected with `"Workspace name cannot exceed 100 characters"` |
| Persisted value | The trimmed value is what gets persisted |

`MAX_WORKSPACE_NAME_LENGTH = 100` matches the existing workspace provisioning boundary used in `computeWorkspaceName()` (lib/workspace/server.ts).

Validation runs server-side before the persistence mutation. The client form performs convenience validation, but server-side validation is authoritative.

---

## 5. Authorization Behavior

| Actor | Read | Update |
|-------|------|--------|
| Unauthenticated | HTTP 401 | HTTP 401 |
| Authenticated member (non-owner) | HTTP 200 (sees current name) | HTTP 403 |
| Workspace owner | HTTP 200 | HTTP 200 |

- Reads use `getCurrentMembership()` — the workspace is resolved server-side from the session.
- Writes use `assertWorkspaceOwner()` (from `lib/workspace/server.ts`) — rejects non-owner with `ForbiddenError` (HTTP 403) before any mutation.
- Client-side button visibility is not the security boundary: a direct `PATCH` from a non-owner still fails server-side.
- Cross-workspace targeting is impossible: the workspace id comes from `assertWorkspaceOwner().workspaceId`, never from the client.

---

## 6. Persistence / Migration Decision

**No migration was created.**

Rationale:
- `Workspace.name` (String, non-null) already exists in the schema.
- The setting mutates an existing column; no new model (`WorkspaceSettings`), no duplicate state, no schema change required.

---

## 7. Workspace Isolation

- `getWorkspaceSettings()` resolves the workspace via `getCurrentMembership().workspaceId` and queries with `where: { id: membership.workspaceId }`.
- `updateWorkspaceName()` calls `assertWorkspaceOwner()` and updates with `where: { id: membership.workspaceId }`.
- No client-supplied `workspaceId` is ever trusted as the security boundary.

---

## 8. Accessibility

The form (`workspace-name-form.tsx`) follows existing RelayDesk conventions:
- Semantic `<form>` with `<Label htmlFor>`/`<Input id>` association.
- `aria-invalid` and `aria-describedby` link field errors to the input.
- `role="alert"` for field errors, `role="status"` for form messages.
- Disabled state while saving / when not owner; accessible button label ("Save changes", "Saving…").
- `<p id="workspace-name-hint">` describes the editing policy for the owner.

---

## 9. Responsive Behavior

The settings page uses the existing dashboard layout (`max-w-5xl mx-auto px-4`) and `Card`/`Input`/`Button` components already proven responsive elsewhere (Members, Tickets). No separate mobile architecture was introduced.

---

## 10. Tests

### Validation tests (`src/__tests__/workspace-settings.validation.test.ts`)

- valid workspace name accepted
- leading/trailing whitespace trimmed
- internal spaces preserved
- whitespace-only rejected
- empty rejected
- over-100-character rejected
- exactly 100 characters accepted
- non-string rejected
- missing name rejected

### Service tests (`src/__tests__/workspace-settings.service.test.ts`)

- `getWorkspaceSettings` returns workspace scoped to membership
- `getWorkspaceSettings` never reads a client id
- `getWorkspaceSettings` propagates `UnauthorizedError`
- `getWorkspaceSettings` propagates `ForbiddenError`
- `updateWorkspaceName` rejects unauthenticated (no mutation)
- `updateWorkspaceName` rejects non-owner (no mutation)
- `updateWorkspaceName` allows owner mutation
- `updateWorkspaceName` mutates the authenticated user's workspace, not a client id
- `updateWorkspaceName` persists the trimmed value
- `updateWorkspaceName` rejects whitespace-only / empty / non-string / over-max
- `updateWorkspaceName` accepts exactly max-length
- `updateWorkspaceName` validates before invoking authorization

### API tests (`src/__tests__/workspace-settings.api.test.ts`)

- GET 401 unauthenticated / 403 no membership / 200 authorized
- PATCH 400 empty / 400 whitespace-only / 400 over-max / 400 malformed JSON
- PATCH 401 unauthenticated / 403 non-owner / 200 valid
- PATCH trims name via Zod transform before delegating to service

### Regression

- `src/__tests__/members.service.test.ts`, `src/__tests__/members.api.test.ts`: 31/31 passed.

---

## 11. Verification Results

| Check | Result |
|-------|--------|
| `npm run lint` | **PASS** — 0 errors, 0 warnings |
| `npm run typecheck` | **PASS** — 0 errors |
| Workspace settings tests (3 files) | **PASS** — 35/35 |
| Members regression tests | **PASS** — 31/31 |
| Full `npm run test` | **625 passed, 10 skipped, 2 failed** (635 total) |
| `npm run build` | **PASS** — exit 0 |

### Full-suite failures (both pre-existing, outside Task 2 scope)

| Suite | Error |
|-------|-------|
| `src/__tests__/outbox.atomicity.integration.test.ts` | Requires provisioned `DATABASE_URL_TEST` database/role |
| `src/__tests__/sla.integration.test.ts` | Requires provisioned `DATABASE_URL_TEST` database/role |

Both failures are integration suites that create real database rows and require the integration database/role provisioned in `.env`. They were pre-existing in `main` and are documented in `docs/phase-7/task-1.md` §12. Unrelated to Task 2.

### Build warning (pre-existing, outside Task 2 scope)

`npm run build` emits one unrelated Turbopack NFT tracing warning (`./next.config.ts`). Pre-existing in `main`; not introduced by Task 2.

---

## 12. Out of Scope (NOT implemented)

Per spec §5.2 / user constraints:

- `WorkspaceSettings` model
- Workspace preferences / notification settings / SLA settings / ticket defaults
- Integrations / OAuth / email provider administration
- Invitations / workspace deletion / workspace transfer
- New role/permission system
- New migrations
- Modifications to Team Management behavior

---

## 13. Deviations from Requested Scope

- Inlined `MAX_WORKSPACE_NAME_LENGTH = 100` as a constant in the client form component rather than importing it from `lib/workspace/settings.ts`. Importing the shared module would pull `@/lib/db/prisma` into the browser bundle, breaking the build. The value stays consistent (matches the domain module) and no speculative abstraction was introduced.

No functional deviations from the specification.
