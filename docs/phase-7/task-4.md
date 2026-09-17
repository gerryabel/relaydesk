# Phase 7 — Task 4: Agent Workload

**Status:** Implemented
**Branch:** `phase-7/task-4-agent-workload`
**Spec:** `docs/phase-7/spec.md` (§5.4 Agent Workload, §7 Architecture, §9 Authorization, §10 UI/UX, §11 Testing)

---

## 1. Scope

Task 4 implements the **Agent Workload** feature area defined in the Phase 7 specification. Agent Workload is a read-only workspace-level dashboard view showing how currently assigned ticket work is distributed across workspace members.

In scope:

- Agent workload summary (workspace-level totals)
- Assigned ticket counts per member
- Workload breakdown by ticket state (open, in_progress, waiting_customer, resolved, closed)
- High-priority / urgent workload visibility (active tickets only)
- SLA-at-risk workload visibility using the existing SLA monitoring semantics
- Workspace/team-level workload overview with one entry per member, including zero-work agents

Out of scope (per spec §5.4 / user constraints): automatic assignment, round-robin assignment, skill-based routing, workload balancing, capacity configuration, predictive staffing, ML forecasting, workload scoring, real-time workload updates, new background jobs, new infrastructure, analytics/metrics from Task 5, persisted workload counters, unrelated refactors.

### No arbitrary capacity thresholds

**This implementation deliberately introduces NO arbitrary overloaded/underutilized/capacity thresholds.** The Phase 7 spec defines no such rules (no "overloaded above 10", no "underutilized below 3", no percentage-based scores, no weighted formulas). Instead the view provides transparent workload counts so the workspace can understand distribution without hidden assumptions. Zero-work agents remain visible so the distribution across the whole workspace is understandable.

---

## 2. Explicit Workload Definitions

For each workspace member, computed from the existing ticket status/priority/SLA data:

| Metric | Definition |
|--------|-----------|
| `totalAssigned` | All currently assigned tickets, regardless of status |
| `open` | Assigned tickets with `status = open` |
| `inProgress` | Assigned tickets with `status = in_progress` |
| `waitingCustomer` | Assigned tickets with `status = waiting_customer` |
| `resolved` | Assigned tickets with `status = resolved` |
| `closed` | Assigned tickets with `status = closed` |
| `active` | `open + in_progress + waiting_customer` (the existing `ACTIONABLE_STATUSES` set) |
| `highPriority` | Currently **actionable** assigned tickets with `priority = high` |
| `urgent` | Currently **actionable** assigned tickets with `priority = urgent` |
| `slaAtRisk` | Currently **actionable** assigned tickets where the existing **response** SLA monitoring **OR** **resolution** SLA monitoring returns `at_risk`. A ticket at risk in both counts **once**. |

Definitions reused from existing domain:

- Actionable states: the exact existing `ACTIONABLE_STATUSES` set from `src/lib/tickets/queue.ts` → `{ open, in_progress, waiting_customer }`.
- SLA risk: the existing `getResponseSlaMonitoringStatus` and `getResolutionSlaMonitoringStatus` helpers from `src/lib/tickets/sla.ts` (which internally use the `AT_RISK_THRESHOLD_RATIO = 0.8` rule). The 80% SLA threshold and all SLA business rules are **not** duplicated.

---

## 3. Architecture

Follows the established RelayDesk layered pattern:

```
UI (components/workload/agent-workload.tsx)
  ↓
Server Page (app/dashboard/workload/page.tsx) — server-rendered, direct domain access
  ↓
Domain Service (lib/workload/server.ts)
  ↓
Prisma / existing Ticket + Membership data
  ↓
existing SLA domain helpers (lib/tickets/sla.ts)
```

Authorization boundaries:

```
getCurrentMembership()          ← resolves current user's workspace membership (server-side session)
  ↓
membership.workspaceId          ← workspace id derived server-side, never from client
  ↓
prisma.membership.findMany / prisma.ticket.findMany   ← both scoped to workspaceId
```

A dedicated `src/lib/workload/server.ts` service holds all workload business rules; the React page/component contains none of the counting/SLA logic. Because this is a read-only dashboard feature, the server page uses direct server-side domain access (consistent with Members, Saved Views, and Settings pages) — no API route or server action was added merely for symmetry.

---

## 4. Files Changed

### New files

| File | Purpose |
|------|---------|
| `src/lib/workload/server.ts` | Workload domain service (`getWorkload`) + typed `AgentWorkload`, `WorkloadSummary`, `WorkloadResult` types |
| `src/app/dashboard/workload/page.tsx` | Agent Workload server page (`/dashboard/workload`) with auth handling |
| `src/components/workload/agent-workload.tsx` | Client view: summary cards + per-member workload cards (responsive) |
| `src/__tests__/workload.service.test.ts` | Domain service unit tests (19 tests covering calculations, isolation, auth) |

### Modified files

| File | Change |
|------|--------|
| `src/components/dashboard/sidebar.tsx` | Added "Workload" navigation link between Saved Views and Settings |

No new database migration: workload is computed from existing `Ticket` and `Membership` data. No new persistence, counters, enums, or relations.

---

## 5. Authorization / Workspace Isolation

- The workspace is resolved **server-side** from the authenticated session via `getCurrentMembership()`. No client-supplied workspace identifier is trusted.
- Members query: `prisma.membership.findMany({ where: { workspaceId } })`.
- Tickets query: `prisma.ticket.findMany({ where: { workspaceId, assignedToId: { not: null } } })` — single workspace-scoped query, only assigned tickets.
- Both queries are scoped to the **current** workspace only. A ticket assigned in Workspace A never enters Workspace B's workload computation because the ticket query filters on `workspaceId`.
- Tickets assigned to a user that is not a current workspace member are skipped (defensive; preserves member-scoping).
- Agent Workload is available to **any authenticated member** of the current workspace (uses existing workspace authorization boundaries via `getCurrentMembership()`). The OWNER-ONLY agent-level restriction in the spec applies specifically to the **Analytics** feature (§5.5), not to Agent Workload. The page handles `UnauthorizedError` → "Please sign in" and `ForbiddenError` → "You need a workspace" consistent with Members/Saved Views/Settings.

---

## 6. Query Strategy

1. Resolve `workspaceId` from the session (single call to `getCurrentMembership`).
2. Run two parallel workspace-scoped queries via `Promise.all`:
   - All workspace members (`membership.findMany` with user select, ordered by name).
   - All assigned tickets in the workspace (`ticket.findMany` selecting only the columns needed for counting/SLA).
3. Aggregate counts in-memory: one pass over tickets, one map lookup per ticket to the member workload bucket.
4. Evaluate SLA risk with the existing helper functions.

This avoids N+1: two workspace-scoped queries total, then O(members + tickets) in-memory aggregation. No premature caching or materialized counters. No API route is needed because the page is server-rendered.

---

## 7. UI Behavior

- **Page** `/dashboard/workload`: header ("Agent Workload") + explanation that metrics are based on currently assigned tickets in the current workspace.
- **Workspace summary** card with five aggregated totals: Total assigned, Active, High priority, Urgent, SLA at risk.
- **Agent workload** section: one card per workspace member showing name, email, joined date, role badge, and a definition list of all workload dimensions (total, active, open, in progress, waiting, high priority, urgent, SLA at risk, resolved, closed).
- **Empty states**: distinct messaging for "no workspace members" vs "no assigned tickets" (clearly communicates there are currently no assigned tickets rather than looking broken). Zero-work members still render with all-zero counts.
- **Responsive**: card/grid layout that stacks on narrow widths; the per-member workload uses a `dl` grid that collapses to fewer columns on small screens. No horizontal-scroll table on mobile.
- **Accessible**: semantic `<dl>/<dt>/<dd>` for workload figures, `aria-label` on the list and per-member regions, accessible `<nav aria-label="Dashboard">` in the sidebar, proper heading hierarchy, tabular numerals for alignment.
- **Loading/error**: server-rendered page uses the same pattern as existing dashboard pages (`DashboardErrorState` for auth errors; no separate loading skeleton needed since data is fetched server-side).
- No charts or charting dependencies introduced — counts/tables are sufficient.

---

## 8. Testing

### Workload service tests (`src/__tests__/workload.service.test.ts`) — 19 tests

Calculation coverage:
- Member with zero assigned tickets
- Assigned tickets across all five statuses (totalAssigned + per-status counts)
- `active` = open + in_progress + waiting_customer
- High priority count counts only active high-priority tickets (resolved/closed high excluded)
- Urgent count counts only active urgent tickets (closed urgent excluded)
- Resolved and closed tickets not included in active workload / not counted as high or urgent
- SLA-at-risk via response SLA (using real `getResponseSlaMonitoringStatus`)
- SLA-at-risk via resolution SLA (using real `getResolutionSlaMonitoringStatus`)
- Ticket at risk in both response and resolution SLA counts **once**
- Non-risk (on_track) ticket excluded from SLA-at-risk
- Unassigned tickets do not appear in any agent's counts

Authorization / isolation coverage:
- `UnauthorizedError` propagates (no session)
- `ForbiddenError` propagates (no workspace membership)
- Queries scoped to current workspace (`where: { workspaceId }`)
- Workspace isolation: ticket query scoped to current workspace only (another workspace's tickets never enter)
- No client-supplied workspace id trusted (workspace resolved server-side from session)
- All current workspace members represented, including zero-work agents
- Aggregated summary totals correct
- Uses the existing SLA helpers directly (no duplicated threshold logic)

### Regression (Phase 7)
- `src/__tests__/members.*.test.ts` — passed
- `src/__tests__/workspace-settings.*.test.ts` — passed
- `src/__tests__/saved-views.*.test.ts` — passed

---

## 9. Verification Results

| Check | Result |
|-------|--------|
| `npm run lint` | **PASS** — 0 errors, 0 warnings |
| `npm run typecheck` | **PASS** — 0 errors |
| Workload service tests | **PASS** — 19/19 |
| Phase 7 regression (members + settings + saved-views) | **PASS** — 150/150 |
| Full `npm run test` | **709 passed, 10 skipped, 2 failed** (719 total) |
| `npm run build` | **PASS** — exit 0, `/dashboard/workload` route present |

### Full-suite failures (both pre-existing, outside Task 4 scope)

| Suite | Error |
|-------|-------|
| `src/__tests__/outbox.atomicity.integration.test.ts` | Requires provisioned `DATABASE_URL_TEST` database/role |
| `src/__tests__/sla.integration.test.ts` | Requires provisioned `DATABASE_URL_TEST` database/role |

Both failures are integration suites that create real database rows and require the integration database/role provisioned in `.env`. They were pre-existing in `main` and are documented in `docs/phase-7/task-1.md` and `docs/phase-7/task-3.md`. Unrelated to Task 4.

### Build warning (pre-existing, outside Task 4 scope)

`npm run build` emits one unrelated Turbopack NFT tracing warning (`./next.config.ts`). Pre-existing in `main`; not introduced by Task 4.

---

## 10. Deviations from Requested Scope

None. No arbitrary overloaded/underutilized/capacity thresholds, workload scores, or weighted formulas were introduced. The workload view shows transparent counts only.

---

## 11. Out of Scope (NOT implemented)

Per spec §5.4 / user constraints:
- Automatic / round-robin / skill-based assignment
- Workload balancing
- Capacity configuration
- Predictive staffing / ML forecasting
- Workload scoring
- Real-time workload updates
- New background jobs / infrastructure
- Analytics/metrics from Task 5
- Persisted workload counters
- Unrelated refactors

Ticket assignment behavior itself is unchanged.

---

## 12. Known Limitations

- Workload is computed on each page load from current ticket/assignment data. There is no caching or background aggregation (intended — matches spec §5.4 / §8 "prefer computed/query-based metrics").
- The per-member workload uses a definition list grid rather than a table; very wide viewports have ample room, and narrow viewports stack the figures. This trades a sortable table for readability across breakpoints without a charting dependency.
- Apply/navigate-to-ticket-from-workload is not implemented; the workload view is a read-only overview, consistent with the spec scope.
