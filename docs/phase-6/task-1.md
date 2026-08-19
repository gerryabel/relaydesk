# Phase 6 — Task 1: Redis & BullMQ Infrastructure

## Objective

Introduce the minimum viable queue infrastructure — Redis connection, BullMQ configuration, and a separately executable worker entrypoint — so the rest of Phase 6 has a concrete transport layer to build on.

This task does **not** implement outbox logic, email jobs, SLA scheduling, or any higher-level workflow. It only makes the infrastructure runnable and observable locally and in CI.

## Context

Phase 6 adds asynchronous processing to RelayDesk. Phase 5 committed important mutations (ticket assignment, status changes, notifications) inside single PostgreSQL transactions, but any follow-up work that requires external systems (email, SLA evaluation) has no execution path.

The architecture decision (see `docs/phase-6/spec.md`) is **Transactional Outbox** backed by BullMQ/Redis. This task lays the groundwork: Redis connectivity, BullMQ Queue/Worker setup, environment validation, and a worker script that can be started, stopped, and inspected independently of the Next.js web process.

The codebase currently has:

- Next.js 16 web process (`npm run dev` / `npm start`)
- Prisma 7 + PostgreSQL (`@prisma/adapter-pg`)
- Vitest test runner with `src/__tests__/setup.ts` injecting test env
- `scripts/infra-check.mjs` for PostgreSQL connectivity checks
- Environment validation in `src/lib/env.ts` (DATABASE_URL, BETTER_AUTH_SECRET, BETTER_AUTH_URL)

There is **no** Redis or BullMQ dependency yet. There is **no** worker process yet. There is **no** docker-compose.

## Dependencies

None. This is the first Phase 6 task.

## Scope

- Add Redis and BullMQ runtime dependencies.
- Add environment variables for Redis connection with validation.
- Create a shared Redis connection module used by both the web process (producer) and the worker process.
- Define queue naming conventions in a single shared location.
- Create a minimal BullMQ `Queue` producer module that other tasks can import.
- Create a minimal worker entrypoint that connects to Redis, starts a BullMQ `Worker`, and logs lifecycle events.
- Add a `worker` npm script and an `infra:check` extension for Redis.
- Document local Redis requirements for development and CI.

## Non-Goals

- Redis caching / session store / general-purpose Redis usage beyond BullMQ transport.
- Pub/sub application bus.
- Multiple Redis clusters or logical databases.
- Generic queue management UI or admin dashboard.
- Kafka or alternative queue technology.
- Transactional outbox persistence or dispatching (Task 2 / Task 3).
- Email jobs (Task 4), retry policy (Task 5), SLA scheduling (Task 6).
- Workflow orchestration engine.

## Current Codebase Integration

The integration surface is intentionally small:

- `package.json` — new dependencies (`bullmq`, `ioredis`) and a new script (`worker`).
- `src/lib/env.ts` — extend `EnvSchema` with Redis variables.
- New directory `src/lib/queue/` for shared connection, queue config, and producer code.
- New file `scripts/worker.mjs` (or `.ts` via `tsx` if the project adds it) as the worker entrypoint.
- `scripts/infra-check.mjs` — add a Redis connectivity check block.

The existing service layer (`src/lib/tickets/server.ts`, `src/lib/notifications/server.ts`) is **not** modified in this task.

## Architecture

### Process model

```
┌─────────────────┐       ┌─────────────────┐
│  Next.js web    │       │  Worker process │
│  (producer)     │       │  (consumer)     │
└────────┬────────┘       └────────┬────────┘
         │                         │
         └──────────┬──────────────┘
                    ▼
            ┌───────────────┐
            │    Redis      │
            │   (BullMQ)    │
            └───────────────┘
```

The web process owns HTTP request handling. The worker process owns background execution. They share **only** Redis and the queue-name configuration.

### Connection handling

- A shared module (`src/lib/queue/connection.ts`) exports a lazy `Redis` connection configured with BullMQ-compatible options (`maxRetriesPerRequest: null`).
- The web process creates a connection when it first enqueues a job and reuses it across requests (mirroring the existing Prisma `global.prisma` pattern).
- The worker process creates its own connection and tears it down on shutdown.
- Connections are **not** shared between the web and worker processes at the module level — each process constructs its own.

### Queue naming

A single primary queue is introduced:

```
relaydesk:primary
```

defined as a constant in `src/lib/queue/config.ts`. Multiple queues are not introduced unless a concrete operational need appears in later tasks.

### Worker entrypoint

`scripts/worker.mjs` (or equivalent):

1. Loads environment (`dotenv`).
2. Validates required env vars.
3. Opens a Redis connection.
4. Starts a `Worker` on the primary queue with a minimal placeholder handler that logs the job and returns.
5. Registers signal handlers (`SIGINT`, `SIGTERM`) for graceful shutdown.
6. Logs startup, shutdown, and connection errors with enough context to diagnose local or CI failures.

The placeholder handler is intentional — Task 3 replaces it with the real dispatcher. This task only proves the worker can start, connect, and stop cleanly.

## Data Model / Schema Changes

None. This task introduces no database schema changes.

## Runtime / Application Changes

| Area | Change |
|------|--------|
| `package.json` | Add `bullmq`, `ioredis` to dependencies; add `worker` script |
| `src/lib/env.ts` | Extend schema with `REDIS_URL` (or `REDIS_HOST`/`REDIS_PORT`/`REDIS_PASSWORD` if preferred) |
| `src/lib/queue/config.ts` | New — queue names, connection options |
| `src/lib/queue/connection.ts` | New — shared Redis connection factory |
| `src/lib/queue/producer.ts` | New — `Queue` factory and typed enqueue helper (minimal) |
| `scripts/worker.mjs` | New — worker entrypoint with lifecycle logging |
| `scripts/infra-check.mjs` | Extended — Redis connectivity check |

## Error Handling

- Invalid/missing Redis env vars fail fast at module load with a clear message (consistent with existing `src/lib/env.ts` behavior).
- Redis connection errors during worker startup are logged and cause a non-zero exit — the worker must not silently run disconnected.
- The BullMQ `Worker` uses its default connection error handling; no custom retry logic is introduced yet (Task 5 covers retry policy).
- Graceful shutdown: on `SIGINT`/`SIGTERM`, the worker stops accepting new jobs, waits for in-flight jobs to complete up to a bounded timeout, then closes the Redis connection and exits.

## Security / Authorization

- Redis credentials live in `.env`, never in source control.
- No arbitrary Redis commands are exposed — the only access path is BullMQ's `Queue`/`Worker` API.
- The worker entrypoint does not accept inbound connections; it only reads from the queue.

## Testing Strategy

Because this task introduces infrastructure rather than business logic, testing focuses on **configuration and connectivity**:

- Unit tests for env validation: missing Redis URL throws a descriptive error.
- Unit test for queue config: the exported queue name matches the documented constant.
- Infra check (`npm run infra:check`) must pass for both PostgreSQL and Redis in CI.
- No BullMQ job processing tests yet — those belong in Task 3.

Tests **do not** require a developer's personal Redis. CI should provision a local Redis (e.g., `redis:7` container) or use a hosted equivalent.

## Acceptance Criteria

When this task is complete, the following must be observable:

1. `npm install` succeeds and adds `bullmq` and `ioredis` to `package.json` and lockfile.
2. Starting the worker (`npm run worker`) with a reachable Redis instance logs a startup message and a successful connection, then remains running.
3. Stopping the worker (`Ctrl+C` or `SIGTERM`) logs a shutdown message and exits cleanly within a bounded time (default ~30s).
4. Starting the worker **without** a reachable Redis instance logs a connection error and exits with a non-zero code — it does not silently hang.
5. Starting the worker **without** `REDIS_URL` (or equivalent) set fails immediately with a clear env-validation error, before any Redis connection attempt.
6. `npm run infra:check` verifies both PostgreSQL and Redis connectivity and exits non-zero if either is unreachable.
7. The queue name `relaydesk:primary` is defined in exactly one shared module and imported by both producer and worker code.
8. Existing Phase 5 behavior continues to pass: `npm run lint`, `npm run typecheck`, `npm run test`, `npm run build`.

## Definition of Done

- All acceptance criteria above are demonstrably true.
- New dependencies are committed in `package.json` and lockfile.
- Worker entrypoint runs on the local machine against a real Redis instance.
- Redis connectivity check added to `scripts/infra-check.mjs`.
- `README.md` or dedicated doc updated with local Redis setup instructions.
- All existing tests pass; new tests for env/queue config added.
- Branch and commit are clean; no unrelated changes.

## Files / Areas Expected to Change

```
package.json                  (add deps + worker script)
src/lib/env.ts                (extend env schema)
src/lib/queue/config.ts       (new)
src/lib/queue/connection.ts   (new)
src/lib/queue/producer.ts     (new)
scripts/worker.mjs            (new)
scripts/infra-check.mjs       (extend)
README.md or docs/phase-6/    (local Redis instructions)
```

## Implementation Notes

- Use **BullMQ** as the queue library (per the Phase 6 spec) and **ioredis** as the Redis client (BullMQ's required dependency).
- Pin versions consistent with the existing dependency policy — prefer stable releases, avoid bleeding-edge tags unless necessary.
- For the worker entrypoint, decide between `.mjs` (Node native ESM, no build step) and `.ts` (requires a TypeScript runner like `tsx`). Document the choice in the commit and README.
- Keep the Redis connection options BullMQ-compatible: `maxRetriesPerRequest: null` is required by BullMQ; document why in a code comment.
- Do not introduce multiple queues or dead-letter configuration yet — Task 3 and Task 5 will extend the worker with dispatch and retry behavior.
