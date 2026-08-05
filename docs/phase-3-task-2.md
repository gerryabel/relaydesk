# Phase 3 Task 2 — Ticket Filters

## Overview

This task adds ticket list filtering on top of the search infrastructure created in Task 1. Users gain the ability to narrow results by status, priority, or other ticket fields relevant to their workflow. The filter behavior stays scoped to the current workspace, preserves existing auth and service boundaries, and avoids changing the ticket model or adding collaboration features.

## Objectives

- Define reusable filter input validation for ticket list queries.
- Extend the ticket query layer to compose search and filters safely.
- Keep filter behavior centralized and testable in the service or helper layer.
- Provide API route support for filtered ticket list requests.
- Integrate filter controls into the ticket list UI.
- Maintain predictable behavior when filters and search are combined.

## Scope

### In Scope

- Filter input validation and normalization.
- Workspace-scoped ticket filtering by status and priority.
- Combined search and filter query composition.
- API route support for filtered requests.
- Filter controls added to the ticket list page.
- Empty state and loading behavior for filtered lists.

### Out of Scope

- Saved or remembered filter presets.
- Advanced operator-based filtering.
- Cross-workspace filter behavior.
- Realtime filter updates.
- URL-synchronized filters.
- Server-side caching for filter results.
- Ticket assignment or SLA fields.

## Architecture Decisions

### Composable Query Building

Filtering is built as an additive layer on top of search rather than a separate query path. This keeps the ticket list query behavior consistent and reduces the chance of divergent auth or pagination handling later.

### Service Layer Filter Mapping

Filters are translated into safe query constraints inside the service or helper layer. This prevents UI components from constructing Prisma queries directly and keeps schema changes local to one area.

### Validation Before Querying

Filter values are validated before they affect database queries. This avoids invalid enum values leaking through and keeps API behavior stable.

### Controlled Client Controls

Filter controls use the existing UI component primitives introduced in Phase 2. New form state stays lightweight and client-side only for control interaction; state mutations are still driven by server responses.

### API-First Extension

Filtered ticket lists are supported through API route handlers as well as direct page usage. This keeps mobile or embedded future clients from needing duplicate filtering logic.

## Verification

- `npm run lint` — passes.
- `npm run typecheck` — passes.
- `npm run build` — passes.
- `npm run test` — passes.

## Files Added

- `src/lib/tickets/filters.ts`
- `src/components/tickets/ticket-filters.tsx`
- `docs/phase-3-task-2.md`

## Files Modified

- `src/lib/tickets/search.ts`
- `src/app/api/tickets/search/route.ts`
- `src/app/dashboard/tickets/page.tsx`

## Lessons Learned

- Building filters on the same query surface as search reduces duplication across API and UI paths.
- Normalizing filter values in one place prevents inconsistent behavior between the page and API consumers.
- Small client-side filter controls can evolve into richer faceted filters without rewriting the underlying query contract.

## Next Task

Phase 3 Task 3 — Sorting
