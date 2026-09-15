# Phase 7 — Task 3: Saved Views

**Status:** Implemented
**Branch:** `phase-7/task-3-saved-views`
**Spec:** `docs/phase-7/spec.md` (§5.3 Saved Views, §14 Dependencies)

---

## 1. Scope

Task 3 implements the **Saved Views** feature area defined in the Phase 7 specification, limited to **personal** saved ticket views:

- Personal saved view definitions
- Persist the existing ticket filter model (not a second filtering system)
- Persist the existing ticket sort configuration
- Persist the existing queue/view selection (My Queue views)
- Create / edit / delete saved views
- Apply a saved view to the existing ticket/queue interface
- A saved view belongs to exactly one user within the current workspace
- Only the owner of a saved view may create, read/list, edit, apply, or delete it
- Server-side authorization and workspace isolation
- Validation of serialized saved-view state and safe handling of invalid/outdated data

Out of scope (per spec §5.3): workspace-shared saved views, reporting dashboards, scheduled reports, external sharing, workflow automation, new/duplicated ticket filtering semantics, unrelated refactors.

---

## 2. Architecture

Follows the established RelayDesk layered pattern:

```
UI (components/saved-views/saved-view-list.tsx, saved-view-editor.tsx)
  ↓
Server Actions (lib/saved-views/actions.ts)
  ↓
Domain Services (lib/saved-views/server.ts)
  ↓
API Routes (app/api/saved-views/route.ts, app/api/saved-views/[id]/route.ts)
  ↓
Prisma / Database
```

Client components import validation/sanitize helpers from a dedicated
`lib/saved-views/client.ts` module that deliberately avoids importing
`@/lib/tickets/queue.ts` or any module that transitively pulls in
`@/lib/db/prisma`. This prevents the `pg`/Prisma client from being traced
into the browser bundle (which would otherwise break `next build` with
`Module not found: Can't resolve 'dns'/'fs'/'net'/'tls'`).

Authorization boundaries:

```
getCurrentMembership()          ← resolves current user's workspace membership
  ↓
membership.workspaceId / membership.userId   ← owner identity from session
  ↓
prisma.savedView.findUnique/findMany/create/update/delete  ↓ scoped to workspaceId + userId
```

---

## 3. Files Changed

### New files

| File | Purpose |
|------|---------|
| `prisma/migrations/20260915000000_add_saved_view/migration.sql` | `SavedView` table + enum + indexes + FKs |
| `src/lib/saved-views/schema.ts` | Zod validation schemas, sanitize helpers, `buildSearchParamsFromView` |
| `src/lib/saved-views/server.ts` | Domain service (CRUD) + typed domain errors |
| `src/lib/saved-views/actions.ts` | Server actions wrapping the domain service + `applySavedViewAction` |
| `src/lib/saved-views/client.ts` | Client-safe sanitize helpers + constants (no prisma/queue import) |
| `src/app/api/saved-views/route.ts` | `GET /api/saved-views` list, `POST /api/saved-views` create |
| `src/app/api/saved-views/[id]/route.ts` | `GET` / `PATCH` / `DELETE /api/saved-views/:id` |
| `src/app/dashboard/saved-views/page.tsx` | Saved Views list page |
| `src/app/dashboard/saved-views/[id]/edit/page.tsx` | Edit saved view page |
| `src/components/saved-views/saved-view-list.tsx` | Client list + create form + apply/delete controls |
| `src/components/saved-views/saved-view-editor.tsx` | Client editor (create/edit form) |
| `src/__tests__/saved-views.validation.test.ts` | Zod schema + sanitize + builder unit tests |
| `src/__tests__/saved-views.service.test.ts` | Domain service unit tests (auth, isolation, persistence) |
| `src/__tests__/saved-views.api.test.ts` | API route integration tests |

### Modified files

| File | Change |
|------|--------|
| `prisma/schema.prisma` | Added `SavedView` model, `SavedViewType` enum, `savedViews` relations on `User` and `Workspace` |
| `src/components/dashboard/sidebar.tsx` | Added "Saved Views" navigation link |

---

## 4. Persistence Model

### `SavedView` table

| Column | Type | Notes |
|--------|------|-------|
| `id` | `TEXT @id @default(cuid())` | Primary key |
| `workspaceId` | `TEXT` | FK → `Workspace.id` (ON DELETE CASCADE) |
| `userId` | `TEXT` | FK → `User.id` (ON DELETE CASCADE) |
| `type` | `SavedViewType @default('tickets')` | `'tickets'` \| `'my_queue'` |
| `name` | `TEXT` | Display name |
| `filterState` | `JSONB @default("{}")` | Serialized ticket filter state |
| `sortState` | `JSONB @default("{}")` | Serialized ticket sort state |
| `viewState` | `JSONB @default("{}")` | Serialized queue/view state |
| `createdAt` | `DateTime @default(now())` | |
| `updatedAt` | `DateTime @updatedAt` | |

### Constraints / Indexes

- `@@unique([workspaceId, userId, name])` — per-user unique name within a workspace.
- `@@index([workspaceId])`, `@@index([userId])`.
- Foreign keys to `Workspace` and `User` with `ON DELETE CASCADE`.

### Design decisions

- **Single `SavedView` model** with explicit `workspaceId` + `userId` ownership. No separate per-type tables.
- **JSONB columns** for the serialized state. The serialized shapes are validated with the existing ticket schemas at the boundary (create/update) and sanitized at read and apply time. No new filtering semantics are introduced.
- **`type` column** distinguishes whether a view applies to the All Tickets page (`tickets`) or My Queue (`my_queue`). This determines the redirect target on apply and whether the queue/view param is emitted.
- **No duplicate state**: the existing `Workspace.name` and ticket filter/sort models remain the source of truth. `SavedView` only stores a snapshot of parameters.

---

## 5. Authorization / Ownership Rules

Owner identity is derived from the authenticated session via `getCurrentMembership()`. It is never taken from a client-supplied field.

| Operation | Rule |
|-----------|------|
| List | Returns only rows where `workspaceId = membership.workspaceId AND userId = membership.userId` |
| Read (single) | Row must exist and match both `workspaceId` and `userId`; otherwise `SavedViewNotFoundError` (not found) or `SavedViewForbiddenError` (forbidden) |
| Create | `workspaceId` and `userId` come from the session. Duplicate name per `(workspaceId, userId)` rejected |
| Update | Ownership verified. Rename that collides with another owned row rejected |
| Delete | Ownership verified |
| Apply | Ownership verified, then redirect to the existing ticket/queue interface |

### Error → HTTP mapping

| Error | HTTP | Scenario |
|-------|------|----------|
| `SavedViewNotFoundError` | 404 | Target id does not exist |
| `SavedViewForbiddenError` | 403 | Target belongs to another user or workspace |
| `DuplicateSavedViewNameError` | 409 | Name collision on create/rename |
| `UnauthorizedError` | 401 | No authenticated session |
| `ForbiddenError` | 403 | No workspace membership |

---

## 6. Workspace Isolation

Every query is scoped to the current workspace **and** the current user:

- `listSavedViews()` — `prisma.savedView.findMany({ where: { workspaceId, userId } })`
- `getSavedView(id)` — after lookup, validates `row.workspaceId === membership.workspaceId && row.userId === membership.userId`
- `createSavedView()` — `workspaceId`/`userId` from session; duplicate-name check scoped to `(workspaceId, userId)`
- `updateSavedView()` / `deleteSavedView()` — ownership verified before mutation

A saved view can never leak across workspaces. Cross-workspace or cross-user access returns 403 (forbidden) to avoid leaking existence.

---

## 7. Validation / Sanitization

### Name

- Must be a string, trimmed, non-empty, max 100 characters (`MAX_SAVED_VIEW_NAME_LENGTH`).
- Unique per `(workspaceId, userId)`.

### Serialized state

The persisted state is validated at the API boundary using the **existing** ticket schemas, and sanitized again at read and apply time so invalid/outdated data never crashes the ticket page.

#### `filterState`

Validated/sanitized with a per-field `.catch(undefined)` schema derived from the existing ticket filter fields:

- `search`: string, trimmed, max 200
- `status`: existing `ticketStatusSchema` enum
- `priority`: existing `ticketPrioritySchema` enum
- `assignee`: string, trimmed, max 64
- `tagId`: string, trimmed, max 64

A present-but-invalid field is silently dropped (not a hard failure), so a saved view that referenced a deleted status/priority/assignee still loads and applies safely. Unknown fields are ignored.

#### `sortState`

Validated/sanitized with the existing `ticketSortSchema` (`field` ∈ `createdAt|updatedAt|title|priority|status`, `direction` ∈ `asc|desc`). Invalid input falls back to `{ field: 'createdAt', direction: 'desc' }`.

#### `viewState`

Validated/sanitized against the existing `QUEUE_VIEW_ORDER` (`my-open|waiting|high-priority|sla-risk`). Invalid input falls back to `my-open`.

### Apply-time behavior

`buildSearchParamsFromView()` re-sanitizes all three states before constructing the URL search params, then redirects to:

- `/dashboard/tickets?...` for `type: 'tickets'`
- `/dashboard/my-queue?...` for `type: 'my_queue'`

The `view` param is only emitted for `my_queue` type when it differs from the default (`my-open`). Sort is always emitted as `field:direction`.

---

## 8. API / UI Behavior

### API

| Method | Path | Behavior |
|--------|------|----------|
| `GET` | `/api/saved-views` | List owned views (401/403/200) |
| `POST` | `/api/saved-views` | Create (400 invalid / 409 duplicate / 201 created) |
| `GET` | `/api/saved-views/:id` | Read one (404 / 403 / 200) |
| `PATCH` | `/api/saved-views/:id` | Update (400 / 404 / 403 / 409 / 200) |
| `DELETE` | `/api/saved-views/:id` | Delete (404 / 403 / 200) |

### UI

- **Saved Views page** (`/dashboard/saved-views`): lists owned views with Apply / Edit / Delete controls, plus an inline create form (name + type).
- **Edit page** (`/dashboard/saved-views/:id/edit`): edits name, type, and the raw JSON of filter/sort/view state with validation and a delete action (with confirm).
- **Apply**: server action resolves the view (ownership-checked) and redirects to the existing ticket/queue interface with the saved state restored.
- **Sidebar**: "Saved Views" link added between Members and Settings.

Accessibility: semantic form controls with `<Label htmlFor>`/`<Input id>` association, `aria-invalid`/`aria-describedby` for field errors, `role="alert"` for errors, `role="status"` for success, disabled/loading states, keyboard-accessible controls. Responsive via the existing dashboard `max-w-5xl` layout and `Card`/`Input`/`Button` components.

---

## 9. Testing

### Validation tests (`src/__tests__/saved-views.validation.test.ts`)

- valid payload accepted; name trimmed
- whitespace-only / empty / over-max-length / non-string name rejected
- exactly-max-length name accepted
- defaults applied for optional fields
- partial update accepted; whitespace-only name rejected when provided
- `savedViewTypeSchema` accepts `tickets`/`my_queue`, rejects others
- unknown filter status/priority silently normalized (lenient persistence)
- `sanitizeFilterState` drops invalid fields, handles null/undefined
- `sanitizeSortState` / `sanitizeViewState` fall back to defaults on invalid input
- `buildSearchParamsFromView` builds correct params for tickets and my_queue types
- invalid persisted state is normalized at apply time

### Service tests (`src/__tests__/saved-views.service.test.ts`)

- `listSavedViews` scoped to workspace+user; propagates `UnauthorizedError`
- `getSavedView` returns owned view; 404 for missing; 403 for other user/workspace
- `createSavedView` uses session-derived ids; rejects duplicate name; never trusts client ids
- `updateSavedView` updates owned; 404/403 paths; rejects rename collision; allows same name
- `deleteSavedView` deletes owned; 404/403 paths
- error class names

### API tests (`src/__tests__/saved-views.api.test.ts`)

- `GET /api/saved-views` — 401 / 403 / 200
- `POST /api/saved-views` — 400 invalid / 201 valid / 409 duplicate
- `GET /api/saved-views/:id` — 404 / 403 / 200
- `PATCH /api/saved-views/:id` — 400 / 200 / 404 / 403 / 409
- `DELETE /api/saved-views/:id` — 200 / 404 / 403

### Regression

- `src/__tests__/members.service.test.ts`, `src/__tests__/members.api.test.ts`, `src/__tests__/workspace-settings.*.test.ts` — 66/66 passed.

---

## 10. Verification Results

| Check | Result |
|-------|--------|
| `npm run lint` | **PASS** — 0 errors, 0 warnings |
| `npm run typecheck` | **PASS** — 0 errors |
| Saved Views tests (3 files) | **PASS** — 65/65 |
| Members + Workspace Settings regression | **PASS** — 66/66 |
| Full `npm run test` | **690 passed, 10 skipped, 2 failed** (700 total) |
| `npm run build` | **PASS** — exit 0 |

### Full-suite failures (both pre-existing, outside Task 3 scope)

| Suite | Error |
|-------|-------|
| `src/__tests__/outbox.atomicity.integration.test.ts` | Requires provisioned `DATABASE_URL_TEST` database/role |
| `src/__tests__/sla.integration.test.ts` | Requires provisioned `DATABASE_URL_TEST` database/role |

Both failures are integration suites that create real database rows and require the integration database/role provisioned in `.env`. They were pre-existing in `main` and are documented in `docs/phase-7/task-1.md` §12. Unrelated to Task 3.

### Build warning (pre-existing, outside Task 3 scope)

`npm run build` emits one unrelated Turbopack NFT tracing warning (`./next.config.ts`). Pre-existing in `main`; not introduced by Task 3.

---

## 11. Deviations from Requested Scope

- **Split of sanitize helpers into `lib/saved-views/client.ts`.** Client components import validation/sanitize from a dedicated module that does not transitively import `@/lib/tickets/queue.ts` or `@/lib/db/prisma`. This avoids pulling the `pg`/Prisma client into the browser bundle, which breaks `next build`. The server-side `schema.ts` retains its own copies for server use. No behavioral change; the helpers are identical.

No functional deviations from the specification.

---

## 12. Out of Scope (NOT implemented)

Per spec §5.3 / user constraints:

- Workspace-shared saved views
- Reporting dashboards
- Scheduled reports
- External sharing
- Workflow automation triggered by saved views
- New/duplicated ticket filtering semantics
- Unrelated refactors

---

## 13. Known Limitations

- The edit page exposes raw JSON for filter/sort/view state. This is intentional for an alpha personal-views feature and keeps the implementation minimal; a future iteration could replace the JSON editors with the actual filter/sort controls.
- Apply reconstructs URL search params from persisted state. It does not preserve pagination (always starts at page 1), consistent with applying a fresh filter set.
