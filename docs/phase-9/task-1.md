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
`Path=/portal`, `maxAge` = session TTL.

`Path=/portal` means the cookie is never attached to internal `/api` or `/dashboard`
traffic. **This constrains the verify route:** a cookie scoped to `/portal` is not sent
to `/api/portal/...`, so `/portal/<slug>/verify` is a server-side page that POSTs to the
API route, and the API sets the cookie on its own response. The cookie path was
deliberately *not* widened to `/`, which would attach a customer credential to every
internal request.

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
| No customer enumeration | `202` + identical body for known, unknown and rate-limited-by-workspace requests |
| Server-side authorization | `requireCustomerInWorkspace()` re-resolves both workspace and customer, then asserts `customer.workspaceId === workspace.id` |
| Client identifiers untrusted | Body `workspaceSlug` is overwritten by the route param; all ids re-read from the DB |

**Uniform failures.** Unknown token, malformed token, expired token, replayed token and
cross-workspace token all produce the same `400` and the same message. A caller cannot
distinguish "no such token" from "token belongs to another workspace".

**Only the newest link per customer is valid.** Issuance invalidates any other
outstanding link for the same customer, bounding row growth and preventing a forwarded
old email from being used.

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

```
Test Files  95 passed | 8 failed (103)
Tests      1108 passed | 68 failed | 16 skipped (1192)
```

The 8 failing files are all `*.integration.test.ts` and all fail for the same
pre-existing environmental reason — no PostgreSQL server is reachable at
`127.0.0.1:5432`:

```
PrismaClientKnownRequestError: Can't reach database server at 127.0.0.1:5432
```

Baseline on `main` before this task was **7 failed files / 58 failed tests** with the
same cause. The delta is `customer-access.integration.test.ts`, which is new and
DB-backed. No non-integration test fails, and no previously passing test regressed.

Unit and route coverage added by this task: **60 tests passing** across
`customer-access.unit.test.ts`, `customer-access.api.test.ts` and
`workspace-slug.test.ts`, covering token entropy and separation, hash determinism,
seal round-trip, tamper and wrong-secret rejection, uniform 202/400 responses, cookie
flags, route-param precedence, rate-limit key privacy, multi-rule consumption, window
reset, and slug normalization/candidate generation/validation.

`customer-access.integration.test.ts` covers what mocks cannot prove and will run once
a database is available: 8-way concurrent magic-link claiming (exactly one winner),
replay, expiry, the `P2002` first-time provisioning arbiter, cross-workspace email
independence, session revocation and workspace-delete cascade.

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

The migration has not been applied — no PostgreSQL server is available in this
environment. `prisma migrate deploy` and the integration suite need to be run before
merge.

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
