# Phase 3 Task 1 — Search Infrastructure

## Overview

This task lays the foundation for ticket search in RelayDesk. It introduces the search-specific data layer, validation, API surface, and UI entry points needed to let users find tickets by title or description. The work stays within the existing ticket and workspace boundaries defined in the Phase 2 architecture; this task does not change the ticket model, routing structure, or dashboard layout.

## Objectives

- Define reusable search behavior for ticket lists.
- Add server-side search input handling tied to the existing ticket service boundary.
- Expose search through API routes in a way that keeps query validation, auth, and workspace isolation centralized.
- Wire the initial search UI into the tickets list page without introducing new page layouts.
- Preserve existing performance and security patterns from Phase 2.
- Prepare for the filtering, sorting, and pagination tasks that will reuse the same ticket query layer.

## Scope

### In Scope

- Search query validation and normalization.
- Ticket list search behavior scoped to the current workspace.
- API route behavior for search requests.
- Ticket list page integration for search input.
- Error and empty state behavior for search-driven ticket lists.

### Out of Scope

- Filter UI beyond the initial search text input.
- Sorting behavior.
- Pagination behavior.
- Real-time search updates.
- URL-synchronized filters.
- Saved searches.
- Analytics or logging around search usage.

## Architecture Decisions

### Reuse Existing Service Boundaries

Search starts inside the existing ticket service layer rather than creating a separate search module. This keeps authorization, workspace isolation, and Prisma access in one place and makes later filter and sort work additive.

### Validation at the Boundary

Search input is validated before it reaches query construction. This prevents injection risk, controls accepted input shape, and keeps page and API behavior predictable.

### Server-First Loading

Initial ticket search results are obtained through server-side request handling. The ticket list page remains responsible for composition only; it does not construct queries directly.

### Incremental UI Integration

Search is added to the existing ticket list page first. Advanced faceted filter UI is left to later tasks so this task remains focused on the core search data path.

### API Route as a Controlled Surface

A dedicated API route handler is introduced for ticket search so the UI can evolve without duplicating auth or validation logic. This also keeps future client-side behavior aligned with server expectations.

## Verification

- `npm run lint` — passes.
- `npm run typecheck` — passes.
- `npm run build` — passes.
- `npm run test` — passes.

## Files Added

- `src/lib/tickets/search.ts`
- `src/app/api/tickets/search/route.ts`
- `docs/phase-3/task-1.md`

## Files Modified

- `src/app/dashboard/tickets/page.tsx`

## Lessons Learned

- Adding search at the service layer, instead of the page layer, keeps future filters and sorts composable.
- Reusing the existing workspace and membership helpers avoids subtle auth regressions.
- Introducing a dedicated API route early prevents page-level query logic from drifting away from server behavior.

## Next Task

Phase 3 Task 2 — Ticket Filters
