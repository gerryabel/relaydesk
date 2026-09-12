# RelayDesk

RelayDesk is a multi-tenant customer support/helpdesk platform under active development.

## Current Implementation Status

This repository currently implements:

* **Phase 0 — Foundation**: Next.js 16 App Router, Tailwind CSS, Zod env validation, Prisma ORM 7 setup, PostgreSQL.
* **Phase 1 — Authentication**: Better Auth with email/password registration, login, logout, protected `/app` area, and server-side session validation.
* **Phase 2 — Internal Helpdesk MVP**: authenticated workspace provisioning, membership-scoped ticket REST API, ticket and message UI under `/dashboard`, authorization enforcement for unauthenticated/no-membership/cross-workspace access, and validation with Vitest coverage.
* **Phase 3 — Productivity & UX**: ticket search by title/description, status and priority filters, sortable ticket lists, offset pagination, loading/error/empty states, accessibility, and responsive improvements for ticket discovery and dashboard pages.
* **Phase 4 — Ticket Workflow & Management**: ticket assignment, explicit workflow with validated transitions, priority and SLA foundation, search across title/description/creator/assignee, assignee filtering, sorting, offset pagination, and activity timeline. Milestone: `v0.3.0-alpha`.
* **Phase 5 — Operational Helpdesk & Agent Productivity**: customer/contact management, customer ticket history and context, internal notes, tags/labels, SLA monitoring, my queue/agent queue, in-app notifications, bulk ticket actions, and message attachments. Milestone: `v0.4.0-alpha`.
* **Phase 6 — Background Processing & Operational Hardening**: Redis/BullMQ infrastructure, transactional outbox, worker dispatch, email delivery, retry and idempotency handling, SLA background evaluation, structured worker/dispatcher logging, correlation IDs, queue and Redis diagnostics, stale outbox recovery reporting, and graceful worker shutdown. **Phase 6 is complete and independently verified on `main`.**

## Stack

* Next.js 16
* React 19
* TypeScript
* Tailwind CSS 4
* Prisma ORM 7
* PostgreSQL
* Redis
* BullMQ
* ioredis
* Better Auth
* Zod
* Vitest
* GitHub Actions
* npm

## Prerequisites

* Node.js 20.9+
* npm
* Git
* PostgreSQL 18 running locally on `localhost:5432`
* Redis running locally on `localhost:6379`

## Local Setup

1. Install dependencies:

   ```bash
   npm install
   ```

2. Copy the environment file:

   ```bash
   cp .env.example .env
   ```

3. Update `.env` with your local values.

4. Ensure PostgreSQL and Redis are running.

5. Start the development server:

   ```bash
   npm run dev
   ```

Open http://localhost:3000.

## Environment Setup

The repository's `.env.example` defines the following variables:

```env
DATABASE_URL=postgresql://relaydesk:password@localhost:5432/relaydesk
DATABASE_URL_TEST=postgresql://relaydesk_test:password@localhost:5432/relaydesk_test

BETTER_AUTH_SECRET=replace-me-with-a-long-random-secret
BETTER_AUTH_URL=http://localhost:3000

REDIS_URL=redis://localhost:6379

EMAIL_PROVIDER=console
EMAIL_FROM=RelayDesk <no-reply@example.com>

# RESEND_API_KEY=re_***
```

### Variables

| Variable             | Purpose                                                                      |
| -------------------- | ---------------------------------------------------------------------------- |
| `DATABASE_URL`       | PostgreSQL connection string for the application                             |
| `DATABASE_URL_TEST`  | PostgreSQL connection string for tests                                       |
| `BETTER_AUTH_SECRET` | Secret used by Better Auth                                                   |
| `BETTER_AUTH_URL`    | Public/base URL used by Better Auth                                          |
| `REDIS_URL`          | Redis connection string used by BullMQ and background processing             |
| `EMAIL_PROVIDER`     | Email provider mode, such as `console` or the configured production provider |
| `EMAIL_FROM`         | Sender identity used for outgoing email                                      |
| `RESEND_API_KEY`     | Optional API key for the Resend email provider                               |

The worker also supports:

```env
DISPATCH_INTERVAL_MS=5000
```

`DISPATCH_INTERVAL_MS` controls the outbox polling interval in milliseconds. The default is `5000`.

Do not commit `.env`.

## Database

Generate Prisma Client:

```bash
npm run db:generate
```

Apply development migrations:

```bash
npm run db:migrate
```

Open Prisma Studio:

```bash
npm run db:studio
```

Check migration status:

```bash
npx prisma migrate status
```

## Development

Start the Next.js application:

```bash
npm run dev
```

Start the background worker in a separate terminal:

```bash
npm run worker
```

The web application and background worker run as separate processes.

## Background Processing

Phase 6 introduces asynchronous background processing using a transactional outbox and Redis/BullMQ.

The high-level flow is:

```text
Application Transaction
        │
        ▼
Transactional Outbox
        │
        ▼
Outbox Dispatcher
        │
        ▼
Redis / BullMQ
        │
        ▼
Worker
        │
        ├── Email Delivery
        │
        └── SLA Evaluation
```

The transactional outbox persists background events together with the business transaction. The dispatcher claims pending events and publishes them to BullMQ. The worker processes the resulting jobs.

The system supports:

* transactional outbox processing
* BullMQ-based background jobs
* retryable and permanent failures
* exponential retry backoff
* idempotent handlers
* email delivery
* SLA background evaluation
* correlation IDs
* structured worker logging
* graceful shutdown
* operational recovery and diagnostics

## Worker

Start the worker:

```bash
npm run worker
```

The worker:

* loads environment configuration
* verifies Redis availability at startup
* reports infrastructure diagnostics
* checks for stranded outbox events
* registers the recurring SLA evaluation scheduler
* dispatches pending outbox events
* processes BullMQ jobs
* supports structured JSON logging
* handles graceful shutdown

Required worker infrastructure includes PostgreSQL and Redis.

The worker uses:

```text
DATABASE_URL
REDIS_URL
DISPATCH_INTERVAL_MS
```

Default dispatcher interval:

```text
5000 ms
```

Graceful shutdown is supported through `SIGTERM` and `SIGINT`/`Ctrl+C`.

## Infrastructure Check

RelayDesk provides an infrastructure diagnostic command:

```bash
npm run infra:check
```

The check verifies:

* PostgreSQL connectivity
* Redis connectivity and ping latency
* Redis connection state
* Redis server version
* Redis uptime
* Redis client count
* Redis memory usage
* BullMQ queue state
* waiting jobs
* active jobs
* completed jobs
* failed jobs
* delayed jobs

The primary BullMQ queue is:

```text
relaydesk-primary
```

Example:

```text
PostgreSQL: OK
Redis: OK (ping 0.44 ms)
Redis connection: {"status":"ready","host":"localhost","port":6379}
Redis info: version=8.2.7 uptime=30237s clients=0 memory=2.03M
Queue "relaydesk-primary": waiting=0 active=0 completed=9 failed=0 delayed=1
```

## Quality Commands

Run lint:

```bash
npm run lint
```

Run TypeScript checks:

```bash
npm run typecheck
```

Run tests:

```bash
npm test
```

Run the production build:

```bash
npm run build
```

Run the project's combined local self-check:

```bash
npm run self-check
```

`self-check` runs:

```text
npm run lint
npm run typecheck
npm run build
```

For a full pre-merge verification, run:

```bash
npm run lint
npm run typecheck
npm test
npm run build
npx prisma migrate status
npm run infra:check
```

## CI

GitHub Actions currently runs the following checks on pushes to `main` and pull requests targeting `main`:

```text
npm ci
npx prisma generate
npm run lint
npm run typecheck
npm run build
```

The CI workflow does not currently run the full Vitest suite or the Redis infrastructure check.

## Project Structure

The project is organized around the Next.js application, domain logic, persistence, queue infrastructure, and background workers.

Relevant areas include:

```text
src/
├── app/
├── components/
├── lib/
│   ├── outbox/
│   ├── queue/
│   └── ...
└── ...

scripts/
└── worker.mjs

prisma/
└── migrations/

docs/
└── phase-6/
    └── operations.md
```

## Phase 6 Operations

Operational documentation for the background-processing system is available at:

```text
docs/phase-6/operations.md
```

The operations guide covers:

* background-processing architecture
* worker startup and shutdown
* structured logs and correlation IDs
* outbox inspection
* stranded and expired event recovery
* permanently failed events
* Redis diagnostics
* common failure scenarios
* retry behavior
* idempotency behavior

## Testing & Verification

Phase 6 was independently verified on `main`.

Final verification included:

```text
61 test files
569 tests passed

Lint:
0 warnings
0 errors

Typecheck:
passed

Production build:
passed

Prisma migrations:
up to date

PostgreSQL:
OK

Redis:
OK

BullMQ:
operational
```

The final Phase 6 implementation was merged into `main` and pushed to `origin/main`.

## Development Notes

RelayDesk is developed incrementally in phases, with each phase independently verified before being merged into `main`.

The project emphasizes:

* tenant isolation
* explicit domain boundaries
* type safety
* database integrity
* deterministic testing
* background-job reliability
* idempotent processing
* observable infrastructure
* operational recoverability

### Current Package Version

The package version remains:

```text
0.1.0
```

This is the current npm package version and is intentionally kept separate from the historical phase milestone labels such as `v0.3.0-alpha` and `v0.4.0-alpha`.

## License

This project is currently under active development.
