# Phase 7 — Task 5: Analytics

**Status:** Implemented
**Branch:** `phase-7/task-5-analytics`
**Spec:** `docs/phase-7/spec.md` (§5.5 Analytics, §7 Architecture, §8 Data Model, §9 Authorization, §10 UI/UX, §11 Testing)

---

## 1. Scope

Task 5 implements the **Analytics** feature area defined in the Phase 7 specification: a focused operational analytics view derived entirely from existing persisted RelayDesk data.

The bounded metric set implemented (per spec §5.5):

1. **Ticket Volume** — count of tickets created within the selected time range.
2. **Status Distribution** — count of tickets grouped by current status.
3. **Priority Distribution** — count of tickets grouped by current priority.
4. **Resolution Count** — count of tickets whose `resolvedAt` falls within the selected time range.
5. **Average Resolution Time** — average duration from `createdAt` to `resolvedAt` for tickets resolved within the selected time range. Unresolved tickets excluded.
6. **Assignment Distribution** — count of currently assigned tickets grouped by assigned agent. **OWNER-ONLY.**
7. **SLA Risk Count** — count of currently open tickets satisfying the existing SLA-at-risk definition at query time.
8. **SLA Breach Count** — count of tickets whose existing SLA deadline has been exceeded.

Out of scope (per spec §5.5 / user constraints): rolling-24-hour/sliding-window analytics, agent-level analytics for non-owners, full BI infrastructure, data warehouse, custom report builder, predictive analytics, ML scoring, external providers, real-time analytics, new SLA policies, new background jobs, new infrastructure, unrelated refactors.

### Deliberately absent

- **No rolling 24-hour analytics.** Only fixed `[start, end)` calendar-day ranges.
- **No persisted analytics counters.** All metrics computed from existing ticket/membership data.
- **No predictive scoring / ML.**
- **No arbitrary BI/report builder.**

---

## 2. Metric Definitions

### Time semantics (spec §5.5)

- Timezone: **UTC**
- Calendar-day boundary: **00:00:00 UTC**
- Range semantics: **`[start, end)`** — inclusive start, exclusive end
- Daily granularity
- Date-only UI values (`YYYY-MM-DD`) are interpreted as UTC calendar dates, constructed via `Date.UTC(year, monthIndex, day)` — never via `new Date("YYYY-MM-DD")` parsing.

### Range metrics (bound to selected `[start, end)`)

| Metric | Definition |
|--------|-----------|
| Ticket Volume | `createdAt >= start AND createdAt < end` |
| Resolution Count | `resolvedAt >= start AND resolvedAt < end`; unresolved excluded |
| Average Resolution Time | Mean `resolvedAt - createdAt` for the same qualifying resolved tickets. A ticket **created before** the period but **resolved inside** it **is included**. |
| Daily series | Tickets created and resolved per UTC calendar day in range, zero-filled. |

### Current snapshot metrics (at query time, range-independent)

| Metric | Definition |
|--------|-----------|
| Status Distribution | All tickets grouped by current `status` |
| Priority Distribution | All tickets grouped by current `priority` |
| SLA Risk Count | Currently **open** tickets where response OR resolution SLA monitoring == `at_risk`. Counted **once** even if both. |
| SLA Breach Count | Tickets where response OR resolution SLA monitoring == `breached`. Counted **once** even if both. |
| Assignment Distribution (OWNER-ONLY) | Currently assigned tickets (`assignedToId NOT NULL`) grouped by assignee. |

### Critical separation

Range metrics and snapshot metrics are computed independently. The selected date range is **NOT** applied to snapshot metrics. This distinction is explicit in both domain types and UI copy.

### Definitions reused from existing domain

- SLA risk/breach: existing `getResponseSlaMonitoringStatus` / `getResolutionSlaMonitoringStatus` from `src/lib/tickets/sla.ts`. The 80% `AT_RISK_THRESHOLD_RATIO`, elapsed-ratio, and breach logic are **not** duplicated.
- Ticket status/priority enums: the existing Prisma enums via `ticketStatusSchema` / `ticketPrioritySchema`.

---

## 3. Date Range Defaults and Validation

- **Default range:** the most recent **30 UTC calendar days** including today (UTC). `from = today - 29 days`, `to = today`, both inclusive. `start` = UTC midnight of `from`; `end` = UTC midnight of `to + 1 day`.
- **Maximum range:** 365 days (query safety).
- **Validation:** server-side via `dateRangeQuerySchema` (Zod). Invalid/malformed dates, invalid calendar dates (e.g. `2026-02-30`, month 13), inverted ranges (`from > to`), and ranges exceeding the cap all **fall back to the default range** rather than throwing — the analytics page always renders.
- **URL parameters:** `from=YYYY-MM-DD` & `to=YYYY-MM-DD` (both inclusive calendar dates). Bookmarkable, refresh-safe, server-readable.
- **`[start, end)` boundaries:** `start = Date.UTC(y, m-1, d)`, `end = start_of(to) + 1 day`. Queries use `>= start AND < end` — **never** `23:59:59.999`.

---

## 4. Architecture

Follows the established RelayDesk layered pattern:

```
UI (components/analytics/analytics-view.tsx)
  ↓
Server Page (app/dashboard/analytics/page.tsx) — server-rendered
  ↓
Validation (lib/analytics/schema.ts) — Zod date-range schema
  ↓
Domain Service (lib/analytics/server.ts) — getAnalytics / computeAnalytics
  ↓
Prisma / existing Ticket + Membership data
  ↓
existing SLA helpers (lib/tickets/sla.ts)
```

Authorization boundaries:

```
getCurrentMembership()          ← resolves current workspace membership (server-side session)
  ↓
membership.workspaceId          ← workspace id derived server-side, never from client
  ↓
prisma.ticket.findMany({ where: { workspaceId } })   ← single workspace-scoped query
  ↓
assertWorkspaceOwner() semantics via membership.role === 'owner'  ← assignment distribution
```

Domain types live in `lib/analytics/types.ts`; validation in `lib/analytics/schema.ts`; business rules in `lib/analytics/server.ts`. The React page/component contains no metric computation or date-boundary logic. `computeAnalytics` is exported separately for unit-testability without Prisma mocking.

Because this is a read-only dashboard feature, the server page uses direct server-side domain access (consistent with prior Phase 7 pages) — no API route or server action was added merely for symmetry.

---

## 5. Files Changed

### New files

| File | Purpose |
|------|---------|
| `src/lib/analytics/types.ts` | Domain types: `DateRange`, distributions, `DailyPoint`, `AssignmentAgent`, `AverageResolutionTime`, `AnalyticsResult` |
| `src/lib/analytics/schema.ts` | Zod date-range validation + UTC boundary construction + `formatDuration` |
| `src/lib/analytics/server.ts` | Domain service (`getAnalytics`, exported `computeAnalytics`) |
| `src/app/dashboard/analytics/page.tsx` | Analytics server page with URL search params + auth handling |
| `src/components/analytics/analytics-view.tsx` | Client view: date-range selector, period metrics, distributions, daily activity, owner-only assignment |
| `src/__tests__/analytics.schema.test.ts` | Date validation + schema tests (23 tests) |
| `src/__tests__/analytics.server.test.ts` | Domain service tests (37 tests covering metrics, SLA, auth, isolation) |

### Modified files

| File | Change |
|------|--------|
| `src/components/dashboard/sidebar.tsx` | Added "Analytics" navigation link between Workload and Settings |

No new database migration: analytics computed from existing `Ticket` and `Membership` data. No new persistence, counters, enums, or relations.

---

## 6. Authorization / Workspace Isolation

- The workspace is resolved **server-side** from the authenticated session via `getCurrentMembership()`. No client-supplied workspace identifier is trusted.
- Ticket query: single `prisma.ticket.findMany({ where: { workspaceId } })` scoped to the current workspace.
- Unauthenticated access follows existing auth error behavior (`UnauthorizedError` → "Please sign in"; `ForbiddenError` → "You need a workspace").
- **Assignment distribution is owner-only.** The membership's `role` is checked server-side: only when `role === 'owner'` are the `membership.findMany` + `ticket.groupBy` queries executed and the `owner.assignmentDistribution` field populated. Non-owner responses **omit** the `owner` field entirely — it is not hidden in React, it is **absent from the server response**.
- Workspace-level aggregate analytics remain accessible to authorized workspace members.

---

## 7. Query Strategy

1. Resolve `workspaceId` from the session.
2. Single workspace-scoped ticket query (`prisma.ticket.findMany` selecting only the columns needed for all metrics).
3. In-memory aggregation in `computeAnalytics`: one pass over tickets computes range metrics (ticket volume, resolution count/time, daily buckets) and snapshot metrics (status/priority distributions, SLA risk/breach) simultaneously.
4. Owner-only: two additional workspace-scoped queries (`membership.findMany` + `ticket.groupBy`) only when the caller is the owner.

No N+1: one ticket query for all metrics; at most two more for owner assignment distribution. Unresolved tickets are excluded from resolution time by the `if (ticket.resolvedAt)` guard. The daily series is zero-filled by pre-generating all UTC day buckets in range.

---

## 8. UI Behavior

- **Page** `/dashboard/analytics`: header ("Analytics") + explanation that metrics are split into period-based and current-snapshot, all UTC.
- **Date-range selector:** accessible `from` / `to` `<Input type="date">` with `<Label>` associations, validation feedback, Apply control, keyboard-accessible. On submit, navigates to `?from=...&to=...` so the range is bookmarkable/refresh-safe.
- **Period summary:** Ticket volume, Resolution count, Average resolution time (with "—" and "no resolved tickets in this period" when count is 0 — never misleading `0 ms`).
- **Current snapshot:** Status distribution + Priority distribution (with zero entries for unused enum values), SLA risk count, SLA breach count. Each distribution rendered with a simple accessible bar list.
- **Daily activity:** accessible table of `date (UTC) · created · resolved` per day with compact bar visualization (no chart dependency).
- **Assignment distribution:** rendered only for owners (`data.owner?.assignmentDistribution`). Includes members with zero assignments. Labeled "Owner-only".
- **Empty/unavailable states:** distinct empty states for "no data", "no resolved tickets", "no members". Zero ticket volume is valid zero. Owner-only data not rendered for non-owners (it's absent from the response).
- **Responsive / accessible:** semantic headings, accessible date labels, keyboard controls, `aria-label` on sections, usable on narrow viewports via stacked cards. The daily table uses `overflow-x-auto` for horizontal scroll on very small screens.

---

## 9. Testing

### Schema tests (`src/__tests__/analytics.schema.test.ts`) — 23 tests

Date range:
- Valid UTC date range → UTC midnight boundaries
- `[start, end)` boundary with end = day after `to`
- Exact end-day exclusion
- Default range (most recent 30 days including today UTC)
- Default range when params missing
- Malformed date fallback to default
- Invalid calendar date rejection/fallback (Feb 30, month 13, non-leap Feb 29)
- `from > to` fallback to default
- Correct daily bucket generation (consecutive UTC days)
- UTC boundary around midnight (23:59:59 belongs to that day)

### Service tests (`src/__tests__/analytics.server.test.ts`) — 37 tests

Ticket volume:
- Excludes before range; includes at start; excludes at exact end
- Multiple days bucketed correctly

Resolution count:
- Unresolved excluded
- Excludes before range; includes at start; excludes at exact end
- **Ticket created before range but resolved inside range is included**

Average resolution time:
- Mean createdAt → resolvedAt
- Unresolved excluded
- Zero qualifying resolutions handled safely (null average, "—" not `0 ms`)
- Includes ticket created before range but resolved inside range

Status distribution:
- All statuses counted; zero entries for missing enum values
Priority distribution:
- All priorities counted; zero entries for missing enum values

Assignment distribution:
- Only non-null `assignedToId` (via `groupBy`)
- Current snapshot semantics
- Workspace isolation (scoped query)
- Owner receives data; non-owner does NOT receive agent-level data
- Non-owner queries skip assignment queries entirely

SLA risk:
- Currently open ticket at response risk counted
- Currently open ticket at resolution risk counted
- Both risk dimensions → counted once
- on_track excluded
- breached excluded from at-risk count
- **Only currently open tickets** counted (not in_progress/waiting_customer)

SLA breach:
- Response breach; resolution breach; both breaches count once
- Current snapshot semantics (not range-bound)

Authorization / isolation:
- `UnauthorizedError` propagates; `ForbiddenError` propagates
- Workspace queries always use session-derived `workspaceId`
- No client-supplied workspace id trusted

Daily series:
- Zero-filled days
- Resolved tickets bucketed into correct UTC days
- UTC midnight boundary handling

### Regression (Phase 7)
- members + workspace-settings + saved-views + workload + analytics — **210/210 passed**.

---

## 10. Verification Results

| Check | Result |
|-------|--------|
| `npm run lint` | **PASS** — 0 errors, 0 warnings |
| `npm run typecheck` | **PASS** — 0 errors |
| Analytics tests (2 files) | **PASS** — 60/60 |
| Phase 7 regression (all 5 tasks) | **PASS** — 210/210 |
| Full `npm run test` | **769 passed, 10 skipped, 2 failed** (779 total) |
| `npm run build` | **PASS** — exit 0, `/dashboard/analytics` route present |

### Full-suite failures (both pre-existing, outside Task 5 scope)

| Suite | Error |
|-------|-------|
| `src/__tests__/outbox.atomicity.integration.test.ts` | Requires provisioned `DATABASE_URL_TEST` database/role |
| `src/__tests__/sla.integration.test.ts` | Requires provisioned `DATABASE_URL_TEST` database/role |

Both failures are integration suites that create real database rows and require the integration database/role provisioned in `.env`. Pre-existing in `main`; documented in `docs/phase-7/task-1.md`, `task-3.md`, `task-4.md`. Unrelated to Task 5.

### Build warning (pre-existing, outside Task 5 scope)

`npm run build` emits one unrelated Turbopack NFT tracing warning (`./next.config.ts`). Pre-existing in `main`; not introduced by Task 5.

---

## 11. Deviations from Requested Scope

None. No rolling-24-hour analytics, no persisted counters, no predictive scoring, no BI builder were introduced. The implementation follows the exact bounded metric set and UTC `[start, end)` semantics from the spec.

---

## 12. Out of Scope (NOT implemented)

Per spec §5.5 / user constraints:
- Rolling-24-hour / sliding-window analytics
- Agent-level analytics visibility for non-owner members
- Full BI infrastructure / data warehouse / custom report builder
- Predictive analytics / ML scoring / external providers
- Real-time analytics, new SLA policies, new background jobs / infrastructure
- Unrelated dashboard refactors

Existing ticket semantics unchanged.

---

## 13. Known Limitations

- Analytics are computed on each page load from current ticket/assignment data. No caching or background aggregation (intended — matches spec §8 "prefer computed/query-based metrics").
- The daily activity table uses a lightweight character-bar visualization; no charting dependency was added, per the task constraints.
- Assignment distribution is a point-in-time snapshot and will change as tickets are assigned/unassigned; there is no historical assignment tracking.
- The date-range selector submits via full navigation (URL search params) rather than client-side state, to keep the range bookmarkable and server-readable. This matches the spec's explicit request for URL parameters.
