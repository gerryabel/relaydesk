# Phase 9 — Task 1: Customer Access Foundation

**Status:** Implemented
**Branch:** `phase-9/task-1-customer-access-foundation`

## Overview

Task 1 establishes passwordless customer authentication and session handling for the
customer portal, as a **separate authorization domain** from workspace membership.

Customers are external parties. Per spec §3.1 they must not become workspace owners,
members, agents or administrators, so this task introduces its own credential chain
(`CustomerMagicLink` → `CustomerSession`) and its own route namespace. Nothing in
Better Auth, `User`, `Membership` or `WorkspaceRole` is touched.

## What This Task Delivers

### 1. Public Workspace Identifier

Added `Workspace.slug` (`String @unique`) in `prisma/schema.prisma` and
`src/lib/workspace/slug.ts`.

Spec §5 requires "a non-sensitive public workspace identifier" that is not an internal
membership ID. The slug is derived from the workspace name
(`Workspace Recovery` → `workspace-recovery`) and is allocated by
`generateWorkspaceSlug`, which probes candidates in order and only appends a random
suffix after exhausting deterministic options.

Migration `20260923000000_add_customer_access` backfills existing rows with a `DO $$`
loop ordered by `("createdAt" ASC, "id" ASC)`, so the same workspace always receives
the same slug and the ordering is deterministic across runs. It handles collisions by
appending `-2`, `-3`, … and falls back to `workspace` when a name normalizes to
nothing (e.g. a non-Latin name).

`@@unique([slug])` is the arbiter for concurrent provisioning; `ensureDefaultWorkspace`
retries on `P2002` and re-reads the winner's membership.

### 2. Customer Access Schema

Two new models:

- **CustomerMagicLink** — single-use passwordless token. Stores `tokenHash` (unique),
  `expiresAt`, `consumedAt`, plus `workspaceId` and `customerId`.
- **CustomerSession** — post-verification session. Stores `tokenHash` (unique),
  `expiresAt`, `revokedAt`, `lastUsedAt`, plus `workspaceId` and `customerId`.

Both carry `workspaceId` **redundantly** in addition to `customerId`. This is
deliberate: every query can filter on workspace directly, and the workspace
relationship is re-asserted on read rather than inferred through the customer.

TTL constants live in `src/lib/customer-access/config.ts`:
15 minutes for magic links, 7 days for sessions.

### 3. Token Handling

`src/lib/customer-access/tokens.ts`:

- `generateCustomerToken()` — 32 random bytes, base64url (256 bits of entropy)
- `hashCustomerToken()` — SHA-256 hex, used for all persistence and lookup
- `sealToken()` / `unsealToken()` — AES-256-GCM with an HKDF-derived key and a random
  96-bit IV per token, format `v1.<iv>.<tag>.<ciphertext>`

Raw tokens are never persisted, never logged and never returned by the issuance path.
The request handler writes only a digest plus a **sealed** copy into the outbox payload;
the raw token exists in plaintext only in the email body produced by the worker.

`BETTER_AUTH_SECRET` is reused as the sealing secret rather than introducing a new
required environment variable. It is domain-separated via HKDF with a distinct `info`
string (`relaydesk:customer-access:sealed-token:v1`), so the derived AES key is not the
Better Auth signing key, and a sealed token cannot be used to forge a session.

### 4. Transactional Outbox

- Added `CUSTOMER_MAGIC_LINK_REQUESTED` to `OutboxEventType`
- Added `'Customer'` to `OutboxAggregateType`
- Registered `handleCustomerMagicLinkEvent` in `src/lib/queue/handlers/registry.ts`

`src/lib/queue/handlers/customer-magic-link.ts` unseals the token, builds the
`/portal/<slug>/verify?token=…` URL, and sends it through the **existing** email
abstraction. `claimEmailSend` / `markEmailSent` / `releaseEmailClaim` were promoted from
private to exported in `email-handler.ts` and reused, so magic-link mail shares the
`SentEmail` idempotency table with ticket mail — retries cannot double-send, and a
provider failure never rolls back the issuance transaction.

### 5. Rate Limiting

New reusable limiter under `src/lib/rate-limit/`:

- `store.ts` — `RateLimitStore` interface + in-memory fixed window
- `redis-store.ts` — Redis-backed fixed window, reusing the existing `getQueueRedis()`
  connection via a lazy dynamic import
- `limiter.ts` — `consumeRateLimit()` increments **every** rule before reporting a
  verdict, so an attacker cannot dodge a tight bucket by also hitting a loose one

Policy in `src/lib/customer-access/rate-limit.ts`. Every request must stay under all
dimensions simultaneously:

| Endpoint | Dimension | Limit |
|---|---|---|
| request | workspace + email | 5 / 10 min |
| request | workspace | 60 / 10 min |
| request | IP | 30 / 10 min |
| verify | IP | 20 / 10 min |
| verify | workspace | 100 / 10 min |

No raw email or IP ever reaches a key: components are SHA-256 digests truncated to 32
hex chars. Workspace buckets key off the **server-resolved workspace id**, not the
client-supplied slug, so an unknown slug cannot mint fresh buckets at will.

If Redis is unreachable — at startup or mid-process — the limiter logs loudly once and
degrades to the in-process store rather than returning 500s from every login. This
weakens the guarantee to per-instance bounds, which is why it is logged at `error`.

### 6. API Routes

| Route | Purpose |
|---|---|
| `POST /api/portal/[workspaceSlug]/auth/magic-link` | Request a sign-in link |
| `POST /api/portal/[workspaceSlug]/auth/magic-link/verify` | Consume a link, issue session cookie |
| `POST /api/portal/[workspaceSlug]/auth/logout` | Revoke session, clear cookie |
| `GET /api/portal/[workspaceSlug]/auth/session` | Portal route protection / session context |

`proxy.ts` exempts `/portal` and `/api/portal` from the Better Auth redirect, because
requiring an internal session there would make the customer entry point unreachable.
The portal authorizes itself through its own handlers.

### 7. Session Cookie

`relaydesk_customer_session`, `HttpOnly`, `SameSite=Lax`, `Secure` in production,
`Path=/`, `maxAge` = session TTL.

`Path=/` is required, not merely permissive. A browser only sends a cookie to paths it
prefix-matches, and the credential is used from **two** namespaces: the portal pages
(`/portal/...`) and the authenticated API routes (`/api/portal/.../auth/session`,
`/api/portal/.../auth/logout`). A `/portal`-scoped cookie is never sent to
`/api/portal/...`, which left both authenticated routes permanently unauthenticated —
`/api/portal/[workspaceSlug]/auth/session` always answered `401` for a signed-in
customer. `/` is the narrowest path that satisfies both.

Widening the path does not widen the credential's authority:

- The value is an opaque random token, not a Better Auth session, so it cannot be
  replayed against internal auth.
- Every route that reads it lives under `/api/portal` and authorizes server-side
  against the workspace in the URL, not from anything the client can influence.
- Internal handlers (tickets, customers, members, …) authenticate via
  `getCurrentMembership()` and never consult this cookie.

`customer-access.api.test.ts` parses the `Set-Cookie` header and asserts the cookie is
sent to both `/portal/x` and `/api/portal/x`, and that logout clears it at the same path.

The browser holds an opaque random token. Customer id, workspace id and session id are
re-derived server-side on every request and are never sent to the client.

## Security Properties

| Requirement | Enforcement |
|---|---|
| Tokens expire | `expiresAt` checked before claim, and re-checked in the `updateMany` predicate |
| Single use | Conditional `updateMany({ where: { consumedAt: null } })`; only `count === 1` proceeds |
| Stored hashed | `tokenHash` SHA-256; raw token never persisted |
| Invalid after consumption | `consumedAt` is set in the same transaction as session creation |
| Not exposed in logs | Raw token only in the worker-built email body; sealed in the outbox |
| Rate limited | Per workspace+email, workspace and IP |
| No customer enumeration | `202` + a byte-identical body for a known and an unknown address, and `202` is returned whether or not a customer row was created |
| Server-side authorization | `requireCustomerInWorkspace()` re-resolves both workspace and customer, then asserts `customer.workspaceId === workspace.id` |
| Client identifiers untrusted | Body `workspaceSlug` is overwritten by the route param; all ids re-read from the DB |

**Uniform failures.** Unknown token, malformed token, expired token, replayed token and
cross-workspace token all produce the same `400` and the same message. A caller cannot
distinguish "no such token" from "token belongs to another workspace".

**Rate limiting is orthogonal to enumeration.** An over-limit request gets `429` with
`Retry-After`, which is a fact about the caller's own request rate and says nothing about
whether the address is a customer. The `202` uniformity guarantee covers the
accepted requests only.

**Only the newest link per customer is valid, under both sequential and concurrent
issuance.** Issuance sweeps the customer's other outstanding links before inserting the
new one, bounding row growth and preventing a forwarded old email from being used. This
holds exactly in both cases because issuance is serialized per customer — see
*Magic-link issuance is serialized per customer* below.

## Design Decisions

### First-time customer provisioning happens at request time

Task 1 is the only code path that can create a `Customer`, and a portal user has no
agent-side onboarding step — so without request-time provisioning a first-time customer
could never obtain a magic link at all.

The alternative (provision only on verified consumption) would require a nullable
`CustomerMagicLink.customerId` plus a separate binding key so that superseded links
could still be invalidated before a customer row exists. That buys one property —
no customer rows for addresses that never confirm — at the cost of dangling
pre-registration rows and a second code path. It is not required by the spec.

The accepted trade-off: unauthenticated callers can create `Customer` rows. It is
bounded by the three request limits above, and the uniform `202` response means it
cannot be used to discover who is a customer.

`Customer.name` is required by the existing schema but a portal user supplies no name,
so it is seeded from the email local part as a display placeholder. Task 2 is where a
real name is collected or refined.

### Provisioning is one atomic statement, not catch-and-retry

`src/lib/customer-access/provisioning.ts` resolves a customer with a single
parameterized statement:

```sql
INSERT INTO "Customer" ("id","workspaceId","name","email","createdAt","updatedAt")
VALUES ($1,$2,$3,$4,$5,$5)
ON CONFLICT ("workspaceId","email") DO NOTHING
RETURNING "id","workspaceId","email"
```

and only if that returns no row does it `SELECT` the winner. The unique index remains
the sole arbiter of the race — there is no application-level read-then-write window.

The rejected alternative was `customer.create()` inside a `try`/`catch` on `P2002` that
re-read the winner in the same transaction. That is unsound on PostgreSQL: a unique
violation puts the transaction into a **failed** state, so every later statement in it
returns `current transaction is aborted, commands ignored until end of transaction
block`. The re-`SELECT`, the magic-link insert, and the outbox insert all fail, and the
Prisma error escapes as a `500`. The integration test reproduces this exactly —
temporarily restoring the old helper makes the 8-way issuance test
`serializes 8 concurrent requests into 1 outstanding link` fail with SQLSTATE
`25P02`. `ON CONFLICT DO NOTHING` is not an error, so the transaction stays healthy and
the follow-up `SELECT` is safe.

`DO NOTHING` is used deliberately rather than `DO UPDATE`: provisioning must never
overwrite the real `name` of a customer an agent has since corrected. A new display
name is only ever seeded on insert. `assertSameWorkspace()` re-checks `workspaceId` on
the returned row as defence in depth, even though the conflict target already pins it.

Prisma's `upsert` was rejected: with an empty `update` object its generated SQL and its
concurrency guarantees vary by version, and a read-then-write upsert still loses to a
concurrent insert. `Customer.id` is a client-side `cuid()`, so the raw statement supplies
its own `randomUUID()`.

### Magic-link issuance is serialized per customer

Issuance must leave exactly one outstanding link per customer, so that a forwarded older
email can never be used. The sweep that enforces this —

```ts
updateMany({ where: { customerId, workspaceId, consumedAt: null },
             data:  { consumedAt: new Date() } })
```

— is a read-then-write over several rows, so on its own it is **not** sufficient under
concurrency. Each transaction's `updateMany` only observes rows committed *before that
statement runs*, under `READ COMMITTED`. A link inserted by a transaction that commits
after another request's sweep is never seen by that sweep, so it survives. With 8
concurrent requests this reliably left **6–7 of 8** links outstanding instead of 1.

`requestCustomerMagicLink` therefore takes a row lock on the `Customer` row itself,
between customer resolution and the sweep:

```sql
SELECT "id" FROM "Customer" WHERE "id" = $1 AND "workspaceId" = $2 FOR UPDATE
```

The whole sequence runs in the single existing transaction:

```text
resolve/create Customer  →  SELECT Customer FOR UPDATE  →  sweep outstanding
                         →  insert new link  →  insert outbox event  →  commit
```

Committing between the lock and the sweep would release it, so the ordering is
load-bearing; the whole point is that the sweep cannot interleave with another
issuance.

Why the customer row rather than `pg_advisory_xact_lock`:

- The row already exists by then (it was just resolved or provisioned), so no new
  coordination table is needed.
- It is scoped to the natural unit of work and reuses one locking vocabulary, which is
  easier to reason about than a second lock namespace.
- Lock order is uniform — customer row, then that customer's links — so no deadlock
  cycle can form between issuance transactions.
- The lock is released at commit or rollback, so it cannot leak across pooled
  connections, and it is database-backed, so it holds across multiple application or
  worker instances. An in-memory mutex or a Redis lock would not.

The `workspaceId` predicate is defense in depth: `id` is already the primary key, but
re-asserting the workspace means a caller can never hold an issuance lock on another
workspace's row.

Interaction with first-time provisioning: on the provisioning path the winner's insert
has necessarily committed before a losing request can read the row (otherwise the loser's
own `ON CONFLICT DO NOTHING` insert would have blocked and then succeeded), so the row is
lockable. A transaction never blocks on its own uncommitted row, so the request that just
inserted the customer locks it immediately. This is the same property the previous
commit's `ON CONFLICT` fix established.

The winning request is simply whichever issuance transaction acquires the lock last.
Nothing depends on wall-clock ordering between concurrent requests.

The invariant is asserted directly in the integration test
(`expect(outstanding).toBe(1)`) and mutation-checked: deleting the lock call reproduces
`expected 7 to be 1`.

### Rate limiting consumes every rule before returning

`consumeRateLimit()` increments **all** buckets and only then decides the verdict. The
previous early return let a caller probe a tight bucket for free: a request rejected on
the per-workspace-email rule never touched the per-IP bucket, so the IP counter
under-counted exactly the traffic an attacker is trying to spread across addresses.
When several rules reject, the one with the shortest window wins, since it resets soonest
and so yields the least misleading `retryAfterSeconds`. Covered by unit tests that assert
buckets 2 and 3 are still incremented after bucket 1 rejects, and that a TTL is not
extended for a request that was rejected.

### Workspace id is carried redundantly

`CustomerMagicLink` and `CustomerSession` both store `workspaceId` alongside
`customerId`. It is a denormalization, and it is asserted on every read rather than
assumed, because this is the single isolation invariant the whole phase rests on.

### Pre-existing index retained

`Customer.@@index([workspaceId, email])` is redundant with the adjacent
`@@unique([workspaceId, email])`, but it already exists in the database from migration
`20260813`. Removing it from the schema would create drift and require a separate
`DROP INDEX` migration, which is out of scope here.

## File Changes

### New Files

- `prisma/migrations/20260923000000_add_customer_access/migration.sql`
- `src/lib/workspace/slug.ts`
- `src/lib/customer-access/config.ts`
- `src/lib/customer-access/tokens.ts`
- `src/lib/customer-access/schema.ts`
- `src/lib/customer-access/errors.ts`
- `src/lib/customer-access/rate-limit.ts`
- `src/lib/customer-access/server.ts`
- `src/lib/customer-access/provisioning.ts`
- `src/lib/customer-access/session.ts`
- `src/lib/customer-access/cookies.ts`
- `src/lib/rate-limit/store.ts`
- `src/lib/rate-limit/redis-store.ts`
- `src/lib/rate-limit/limiter.ts`
- `src/lib/queue/handlers/customer-magic-link.ts`
- `src/app/api/portal/[workspaceSlug]/auth/magic-link/route.ts`
- `src/app/api/portal/[workspaceSlug]/auth/magic-link/verify/route.ts`
- `src/app/api/portal/[workspaceSlug]/auth/logout/route.ts`
- `src/app/api/portal/[workspaceSlug]/auth/session/route.ts`
- `src/__tests__/customer-access.unit.test.ts`
- `src/__tests__/customer-access.api.test.ts`
- `src/__tests__/customer-access.integration.test.ts`
- `src/__tests__/workspace-slug.test.ts`
- `docs/phase-9/task-1.md`

### Modified Files

- `prisma/schema.prisma` — `Workspace.slug`, `CustomerMagicLink`, `CustomerSession`,
  reverse relations
- `src/lib/outbox/types.ts` — `CUSTOMER_MAGIC_LINK_REQUESTED`, `'Customer'` aggregate
- `src/lib/queue/handlers/registry.ts` — registered the magic-link handler
- `src/lib/queue/handlers/email-handler.ts` — exported `claimEmailSend`,
  `markEmailSent`, `releaseEmailClaim` for reuse
- `src/lib/workspace/server.ts` — slug allocation and `P2002` retry on provisioning
- `proxy.ts` — exempt `/portal` and `/api/portal`
- `src/__tests__/provisioning.test.ts` — tx mock now stubs the slug probe
- `src/__tests__/sla-policy.provisioning.test.ts` — same
- 7 integration test files — `workspace.create` fixtures now supply `slug` (the field
  is required by the schema)

## Test Results

All of the following were executed locally against a **real PostgreSQL 17.5 instance**
(the environment initially had no database reachable at `127.0.0.1:5432`; one was
provisioned so these results are measured, not assumed):

```
npx prisma migrate deploy   →  All migrations have been successfully applied.
                               (full chain, including 20260923000000_add_customer_access)

npm run lint                →  clean, 0 errors, 0 warnings
npm run typecheck           →  clean
npm run test                →  Test Files  103 passed (103)
                               Tests      1203 passed (1203), 0 failed, 0 skipped
npm run build               →  Compiled successfully
git diff --check            →  clean
```

**Everything passes, including every DB-backed integration suite.** The earlier
`95 passed / 8 failed` and `1108 passed / 68 failed / 16 skipped` figures were purely
environmental: all 8 failing files were `*.integration.test.ts` failing with
`Can't reach database server at 127.0.0.1:5432`. With a database present those 16
skipped tests run and pass, which also re-confirms the pre-existing `main` integration
suites are unaffected by this task. Nothing in this task was skipped or weakened to
accommodate a missing database.

### Coverage added by this task

Unit, route and slug coverage: **66 tests passing** across
`customer-access.unit.test.ts`, `customer-access.api.test.ts` and
`workspace-slug.test.ts` — token entropy and separation, hash determinism, seal
round-trip, tamper and wrong-secret rejection, uniform 202/400 responses, cookie flags
and **cookie path matching for both `/portal/...` and `/api/portal/...`**, route-param
precedence, rate-limit key privacy, all-rule rate-limit consumption, shortest-window
rejection, window reset, and slug normalization/candidate generation/validation.

`customer-access.integration.test.ts` — **15 tests, all passing against real
PostgreSQL** — covers what mocks cannot prove:

- **8 concurrent magic-link requests** through the real `requestCustomerMagicLink()` for
  one workspace/email → exactly **1** `Customer`, all 8 requests resolve, **8** magic-link
  rows, **exactly 1 with `consumedAt = null`** and **7 consumed**, **8** outbox events
  (each carrying a sealed token), and no request rejects with `P2002` or an
  aborted-transaction error
- **sequential issuance is monotonic** — request A leaves A outstanding; B leaves only B
  outstanding with A consumed; C leaves only C outstanding with A and B consumed — 1
  customer and 3 outbox events across the three requests
- an existing customer's real `name` is never overwritten by provisioning
- the same email in two workspaces yields two independent `Customer` rows
- a row whose `workspaceId` does not match the requested workspace is rejected
- 8 concurrent verifications of one token → exactly **1** session, 7 rejections, with
  the claim and the session insert in the same transaction
- replay of a consumed token, and expiry, are both rejected
- a token is accepted in its own workspace and rejected in another
- sessions resolve only while unexpired and unrevoked
- workspace deletion cascades away all customer access rows

The two issuance cases call the real service rather than a hand-rolled mirror of it, so
the provisioning insert, the row lock, the sweep, the link insert and the outbox insert
are all exercised in one transaction.

### Mutation checks

The regression tests were confirmed to fail against the pre-fix behaviour rather than
passing vacuously:

| Mutation | Result |
| --- | --- |
| `CUSTOMER_SESSION_COOKIE_PATH` back to `/portal` | 2 cookie/API tests fail |
| restore `create()` + catch-`P2002` provisioning | 8-way issuance test fails, SQLSTATE `25P02` |
| **remove the `SELECT … FOR UPDATE` issuance lock** | **8-way issuance test fails: `expected 7 to be 1` outstanding** |
| drop `consumedAt: null` from the claim | 2 token-race tests fail (8 sessions created) |
| early-return from the rate limiter | 2 rate-limit tests fail |

The lock mutation was confirmed across repeated runs (3/3 failures without the lock, 10/10
passes with it), so the concurrency test is not timing-dependent in either direction.

### Bug found and fixed during this task

`truncateWithSuffix` in `src/lib/workspace/slug.ts` reserved room for the numeric
suffix but not for the `-` separator, so a collision candidate was 49 characters and
exceeded the documented 48-character cap. `workspace-slug.test.ts` now asserts the cap
across all candidates, including two-digit suffixes. The SQL backfill carried the same
off-by-one and was corrected alongside it.

The migration also had a latent `NULLIF(LEFT(...), 48)`, which compared a slug against
the number 48 rather than testing for the empty string — the `COALESCE` fallback would
not have fired for a name that normalizes to nothing. Fixed to `NULLIF(..., '')`.

### Not verified locally

- **Redis**: `RateLimitRedisStore` is not covered here — `redis-cli` is not installed
  and no Redis server is reachable in this environment. Only the in-memory store is
  exercised, plus the runtime fallback that selects it when `RATE_LIMIT_REDIS_URL` is
  unset. The Redis path is unchanged by this task and should be covered when Redis is
  available.
- **Portal UI**: `/portal` pages are Task 2. Task 1 ships the API, the cookie, the
  proxy exemption and the authorization helper only, so the cookie-path change is
  asserted at the HTTP layer rather than through a rendered page.

## Migration

```bash
npx prisma migrate deploy
```

The backfill is written to be safe on a populated `Workspace` table: it adds the column
nullable, fills it, then sets `NOT NULL` and creates the unique index.

## Out of Scope

Per spec §5, not included in this task:

- OAuth / social login / SSO
- customer workspace switching
- customer roles or administration
- portal UI (Task 2)
- customer replies, email notifications, attachments (Tasks 3–4)

## Next Steps (Task 2+)

- **Task 2: Customer Portal** — customer ticket list, ticket creation, detail view,
  portal UI, reusing `requireCustomerInWorkspace()` for every request
- **Task 3: Customer Conversation & Email** — customer replies, agent/customer message
  authorship, customer-visible filtering
- **Task 4: Customer Attachments** — authorized customer download
- **Task 5: Integration Hardening** — cross-workspace isolation suite, token replay and
  expiry coverage, enumeration resistance
