# RelayDesk

RelayDesk is a multi-tenant customer support/helpdesk platform under active development.

## Current Implementation Status

This repository currently implements:

- **Phase 0 — Foundation**: Next.js 16 App Router, Tailwind CSS, Zod env validation, Prisma ORM 7 setup, PostgreSQL.
- **Phase 1 — Authentication**: Better Auth with email/password registration, login, logout, protected `/app` area, and server-side session validation.
- **Phase 2 — Internal Helpdesk MVP**: authenticated workspace provisioning, membership-scoped ticket REST API, ticket and message UI under `/dashboard`, authorization enforcement for unauthenticated/no-membership/cross-workspace access, and validation with Vitest coverage.

## Stack

- Next.js 16 + React 19 + TypeScript
- Tailwind CSS 4
- Prisma ORM 7 with PostgreSQL driver adapter
- Better Auth
- Zod
- GitHub Actions
- npm

## Prerequisites

- Node.js 20.9+
- npm
- PostgreSQL 18 running locally on `localhost:5432`
- Git

## Local Setup

1. Install dependencies:
   ```bash
   npm install
   ```

2. Copy environment file:
   ```bash
   cp .env.example .env
   ```

3. Update `.env` with your values. Ensure `BETTER_AUTH_SECRET` is at least 32 characters.

## Environment Setup

Required variables in `.env`:

- `DATABASE_URL` — PostgreSQL connection string
- `BETTER_AUTH_SECRET` — Long random secret for Better Auth
- `BETTER_AUTH_URL` — Public URL of the app, e.g. `http://localhost:3000`

## Database Migration

Generate Prisma Client:

```bash
npm run db:generate
```

Apply migrations:

```bash
npm run db:migrate
```

Open Prisma Studio:

```bash
npm run db:studio
```

## Development

```bash
npm run dev
```

Open [http://localhost:3000](http://localhost:3000).

## Quality Commands

```bash
npm run lint
npm run typecheck
npm run build
```

Run all quality checks:

```bash
npm run self-check
```

## Infrastructure Check

Verify local PostgreSQL connectivity:

```bash
npm run infra:check
```

## CI

GitHub Actions workflow runs `npm ci`, `npm run lint`, `npm run typecheck`, and `npm run build` on pushes to `main` and pull requests.

## Notes

- Do not commit `.env`.
- Auth uses Better Auth email/password only. No OAuth, 2FA, or magic links in Phase 1.
- Phase 2 adds internal workspace provisioning, tickets, ticket messages, and API auth behavior aligned with `docs/phase-2-spec.md`.
- Redis is deferred until background jobs are introduced in a later phase.
