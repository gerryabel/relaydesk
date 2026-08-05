# Phase 3 Task 3 — Sorting

## Overview

This task introduces deterministic sorting for ticket lists. After search and filters are available, sorting lets users control how matched tickets are ordered—for example, by newest first, priority, or status. The implementation stays within the existing ticket query boundary and reuses the workspace and authorization patterns established in earlier tasks.

## Objectives

- Add validated sort input handling for ticket list queries.
- Extend the ticket query layer to compose search, filters, and sort safely.
- Keep sort behavior centralized in the service or helper layer.
- Preserve existing auth and workspace isolation guarantees.
- Expose sort behavior through the ticket list API route.
- Integrate sort controls into the ticket list UI without changing the overall layout.

## Scope

### In Scope

- Sort field validation and normalization.
- Workspace-scoped ticket sorting for ticket list queries.
- Combined search, filter, and sort query composition.
- API route support for sorted requests.
- Sort controls added to the ticket list page.
- Loading and empty state behavior when sort is applied.

### Out of Scope

- Multi-column sort.
- Custom or user-defined sort rules.
- Cross-workspace sort behavior.
- Persistent sort preferences.
- URL-synchronized sort state.
- Performance indexing work or database-level migration changes.
- Real-time sort updates.

## Architecture Decisions

### Single Default Sort With Explicit Alternatives

The default sort remains stable and predictable, while explicit sort options are limited to a small set of allowed fields and directions. This avoids ambiguous ordering and keeps query behavior easy to test.

### Service Layer Sort Mapping

Sort input is translated into allowed query ordering inside the service or helper layer. Page and API consumers only pass normalized sort values; raw UI values never reach query construction directly.

### Combined Query Composition

Sort is applied after search and filters so all three behaviors can coexist without duplicating query logic. This keeps ticket list behavior consistent across API and page paths.

### Controlled UI Controls

Sort controls are added to the existing ticket list toolbar or header area using existing UI primitives. No new layout patterns are introduced in this task.

### API Consistency

API route handlers support the same sort input as the page. This prevents behavior drift between browser and API consumers.

## Verification

- `npm run lint` — passes.
- `npm run typecheck` — passes.
- `npm run build` — passes.
- `npm run test` — passes.

## Files Added

- `src/lib/tickets/sort.ts`
- `src/components/tickets/ticket-sort-control.tsx`
- `docs/phase-3-task-3.md`

## Files Modified

- `src/lib/tickets/search.ts`
- `src/app/api/tickets/search/route.ts`
- `src/app/dashboard/tickets/page.tsx`

## Lessons Learned

- Allowing only explicit sort fields reduces both security and UX risk compared to dynamic ordering from arbitrary input.
- Composing search, filters, and sort in one query path is simpler to reason about than separate endpoints per behavior.
- Reusing the same service layer for API and page queries prevents duplicated authorization logic.

## Next Task

Phase 3 Task 4 — Pagination
