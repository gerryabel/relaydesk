# Phase 2 Task 4 — Dashboard Foundation

## Overview

This task implements the authenticated application shell that every future feature will use. It establishes the protected `/dashboard` route, reusable dashboard layout, sidebar navigation, workspace resolution helpers, and a dashboard homepage backed by real database statistics.

## Objectives

- Create a protected `/dashboard` route that redirects unauthenticated users to `/login`.
- Provide reusable server helpers for resolving the current workspace membership and workspace.
- Build a reusable dashboard layout with sidebar navigation.
- Implement a dashboard homepage showing workspace statistics from the database.
- Add placeholder routes for future authenticated pages.
- Keep Prisma access centralized and avoid duplicated queries.

## Features Implemented

- **Protected dashboard route**: `/dashboard` and nested authenticated routes redirect unauthenticated users to `/login`.
- **Dashboard layout**: Reusable layout wrapping authenticated pages with sidebar and main content area.
- **Sidebar navigation**: Shared sidebar with links to Dashboard, Tickets, Members, and Settings, plus sign-out action.
- **Workspace helpers**:
  - `getCurrentMembership()` — resolves the authenticated user's membership and workspace.
  - `getCurrentWorkspace()` — returns the current workspace.
  - `UnauthorizedError` / `ForbiddenError` — typed errors for distinct auth failures.
- **Dashboard stats service**: `getDashboardStats()` returns open, inProgress, resolved, and closed ticket counts.
- **Dashboard homepage**: Displays workspace stats cards and an empty state when no tickets exist.
- **Placeholder routes**: `/dashboard/tickets`, `/dashboard/members`, `/dashboard/settings`.

## Architecture Decisions

- **Centralized Prisma queries**: All database access for workspace resolution and dashboard stats lives in server helpers under `src/lib/workspace/server.ts` and `src/lib/dashboard/server.ts`. Page components do not contain direct Prisma calls.
- **Reusable workspace helpers**: Shared helpers prevent duplicated session/membership lookup logic across routes and layouts.
- **Server Components by default**: Dashboard pages and layout are Server Components. Stateful UI like the sidebar uses `'use client'` only where needed.
- **Route protection**: The dashboard layout uses `getCurrentMembership()` and typed errors to distinguish unauthenticated (`/login`) from authenticated-but-workspace-less (`/app/setup`) access.
- **Separation of concerns**: Services, layouts, and pages are split into dedicated modules to keep the codebase modular and maintainable.

## Verification

- ✅ `npm run lint` — passed
- ✅ `npm run typecheck` — passed
- ✅ `npm run build` — passed
- ⚠ `npm run test` — blocked because `DATABASE_URL_TEST` is not configured in this environment. This is not a code regression; Vitest refuses to run database-backed tests without a dedicated test database URL.

## Files Added

- `src/app/dashboard/layout.tsx`
- `src/app/dashboard/page.tsx`
- `src/app/dashboard/tickets/page.tsx`
- `src/app/dashboard/members/page.tsx`
- `src/app/dashboard/settings/page.tsx`
- `src/components/dashboard/sidebar.tsx`
- `src/lib/dashboard/server.ts`
- `docs/phase-2-task-4.md`

## Files Modified

- `src/lib/workspace/server.ts`

## Lessons Learned

- Distinguishing `UnauthorizedError` and `ForbiddenError` enables precise routing for auth edge cases.
- Keeping Prisma queries in dedicated server helpers prevents duplication as the app grows.
- Server Components with minimal client islands keep the dashboard shell fast and simple.

## Next Task

Phase 2 Task 5 — Ticket Services
