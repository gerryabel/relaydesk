# Phase 9 — Task 2: Customer Portal

**Status:** Implemented
**Branch:** `phase-9/task-2-customer-portal`

## Overview

Task 2 gives a signed-in customer a working support portal: list their own tickets,
open a new one, and read one in full. It builds entirely on Task 1's passwordless
session and adds **no** schema changes and **no** new authentication path.

The organising principle is that a customer is not a workspace member. Every read and
write is scoped by `(workspaceId, customerId)` resolved from the customer session
inside the database query, and the only objects that leave the service layer are
explicitly constructed DTOs.

## What This Task Delivers

### 1. Customer Ticket Service

`src/lib/customer-portal/server.ts` is a separate module from
`src/lib/tickets/server.ts`, and that separation is load-bearing rather than
cosmetic. Every function in the internal module opens with `getCurrentMembership()`,
so it is unreachable for a customer — a customer session is not a Better Auth
session and must never satisfy a membership check (spec §11). Keeping the two query
paths in separate files means the authorization domains share no call path at all.

Three entry points:

| Function | Purpose |
| --- | --- |
| `listCustomerTickets` | Paginated, searchable list of the customer's own tickets |
| `getCustomerTicket` | One ticket plus its customer-visible conversation |
| `createCustomerTicket` | Atomic create with SLA, activity, outbox and automation |

Invariants enforced by all three:

1. `workspaceSlug` is a **lookup key only**. `requireCustomerInWorkspace()`
   re-resolves the workspace from the database, re-resolves the customer from the
   session row, and asserts `customer.workspaceId === workspace.id` before any ticket
   is touched.
2. `workspaceId` and `customerId` always come from that resolved pair. **No function
   in this module accepts either as an argument.**
3. Ticket reads are scoped in the `where` clause by both ids. A ticket is never
   fetched and authorized afterwards.
4. Only `CustomerTicketDetail` / `CustomerTicketSummary` leave the module. Prisma
   rows never do.

### 2. Ticket List

Scoped in SQL by `workspaceId` **and** `customerId`:

```ts
where: { workspaceId: workspace.id, customerId: customer.customerId, ... }
```

Search matches only `title` and `description`, both customer-owned content.
`createdBy`, `assignedTo` and `customer` are deliberately not searchable on a
customer's behalf, and internal notes are never searched at all.

The list issues **exactly three queries regardless of page size** — one count, one
paginated `findMany`, and one grouped `MAX(Message.createdAt)` restricted to the ids
on the page being rendered. There is no per-ticket follow-up query, so the endpoint
has no N+1 and does not leak row counts through response timing.

### 3. Ticket Detail

One `findFirst` on `(id, workspaceId, customerId)`. Both ownership predicates are in
the query, so a ticket owned by another customer — or by a customer in another
workspace — matches zero rows and is reported as `CustomerTicketNotFoundError`.

The message read is a separate, explicit projection: only messages on an
already-authorized ticket, and only `id`, `createdById`, `body`, `createdAt`.
`InternalNote`, `TicketActivity`, `AutomationExecution`, `Notification`, tags,
assignment and SLA configuration are never selected, so there is nothing to discard
at presentation time.

### 4. Customer-Safe DTOs

`src/lib/customer-portal/dto.ts` is the single boundary between internal
`Ticket`/`Message` rows and anything a customer can observe. Every mapper builds its
object from literals, so a column added to Prisma later cannot leak by accident the
way a spread into `NextResponse.json()` would.

Never present in any DTO: `workspaceId`, `customerId`, `createdById`,
`assignedToId`, `updatedAt`, `firstResponseAt`, `responseSlaDeadline`,
`resolutionSlaDeadline`, internal notes, `TicketActivity`, `AutomationExecution`,
`OutboxEvent`, `Notification`, worker/lease state, tags, workspace membership.

### 5. Last Visible Activity

`src/lib/customer-portal/activity.ts` derives `lastActivityAt` from exactly two
sources: the ticket's own `createdAt`, and the timestamps of its customer-visible
`Message` records. `latestActivity` / `buildLastVisibleActivityMap` are exported so a
future Task 3 change has to go through this one function rather than quietly
redefining the rule.

`Ticket.updatedAt` is **not** used. It is `@updatedAt`, so it moves on assignment,
priority changes, tag add/remove, customer link/unlink and any write at all. A
customer watching it would see their ticket "change" every time an agent touched
something invisible to them, which leaks the fact that internal work is happening.
`TicketActivity` is also not used: it records the actor id and, for some types, the
before/after values of internal fields.

The integration suite asserts this directly: an `updatedAt` bumped a day into the
future does not move `lastActivityAt`, while a real message does.

### 6. Ticket Create

Atomic by construction. SLA policy lookup, ticket insert, `TicketActivity`,
`TICKET_CREATED` outbox event and the `ticket.created` automation evaluation all run
in one `prisma.$transaction`. A failure in any of them — a missing SLA policy, an
outbox write error — rolls the whole thing back, so a customer never sees a ticket
without its deadlines, and the internal pipeline never sees a ticket whose creation
event was lost.

**Customer-controlled input is exactly two fields.** The schema is
`z.strictObject`, not `z.object`: an attempt to supply `customerId`, `workspaceId`,
`priority`, `status`, `assignedToId` or `createdById` is **rejected with a 400**
rather than silently dropped, so a caller is told their value was ignored instead of
being left to believe it took effect.

Defaults and derived values:

| Field | Value | Why |
| --- | --- | --- |
| `workspaceId` | resolved workspace | session |
| `customerId` | resolved customer | session |
| `status` | `open` | the only status a customer can produce |
| `priority` | `medium` | matches the column default and `createTicketSchema` |
| `createdById` | `null` | a customer is not a `User`; nothing is fabricated |
| `assignedToId` | `null` | set explicitly so a customer can never land on an agent's queue by accident |
| `responseSlaDeadline` / `resolutionSlaDeadline` | workspace SLA policy | loaded inside the transaction |

**Actor semantics.** Nothing is fabricated for the customer. `TicketActivity.actorId`
stays `null`, the outbox payload carries `actorId: null` and identifies the actor
through `customerId`, and automation evaluates with
`createAutomationContext({ actorId: null })` — a shape the existing
`AutomationContext` type already permits — rather than attributing the ticket to an
agent who never touched it.

### 7. Ticket Reference

`Ticket` has no dedicated public number, and adding one would mean a global,
concurrency-sensitive sequence plus a migration — outside Task 2 and a real source of
duplicate-key bugs. The portal derives a short, stable reference from the existing
opaque ticket id instead (`src/lib/customer-portal/reference.ts`):

- **Deterministic and stable** — the same ticket renders the same reference in the
  portal, in the API, and in any future customer email. A reference printed today
  still resolves to the same ticket tomorrow.
- **Non-sequential** — no ordering leaks, so a customer cannot infer how many tickets
  a workspace has processed.
- **Fixed width and charset** — exactly 8 characters from `0-9A-Z`, safe to read
  aloud, paste into a support conversation, and put in an email subject.
- **One-way** — the reference cannot be reversed into a ticket id, so it is not an
  additional lookup credential.

The ticket id remains the route resource key
(`/portal/{slug}/tickets/{ticketId}`); only the *presentation* is the reference.

### 8. HTTP API

| Route | Success | Notes |
| --- | --- | --- |
| `GET /api/portal/{slug}/tickets` | `200` | `q`, `status`, `page`, `limit` only |
| `POST /api/portal/{slug}/tickets` | `201` | `title` and `description` only |
| `GET /api/portal/{slug}/tickets/{ticketId}` | `200` | ownership in the query |

Error mapping (`src/lib/customer-portal/http.ts`):

| Condition | Status |
| --- | --- |
| No valid customer session | `401` |
| Session bound to a different workspace | `403` |
| Unknown workspace slug | `404` |
| Ticket absent, or owned by someone else | `404` |
| Input failed validation | `400` |
| Anything else | `500`, generic message |

The `404` for "someone else's ticket" is byte-identical to the `404` for "no such
ticket". A difference would turn the endpoint into an oracle for guessing ticket ids.
Unexpected failures are logged server-side and answered with a fixed literal, so a
driver message, table name or connection string never reaches a customer.

Only the four documented list parameters are forwarded to the service. Anything else
— including a `customerId` a caller adds to try to steer ownership, or Next.js
bookkeeping such as `_rsc` — is dropped by `normalizeCustomerTicketListParams` before
the service is reached. The service's own schema stays strict, so a caller that
hand-builds a params object still cannot smuggle a key past it.

### 9. Portal UI

Routes under `src/app/portal/[workspaceSlug]/`:

| Route | Purpose |
| --- | --- |
| `page.tsx` | Entry point: signed in → tickets, otherwise → login |
| `login/page.tsx` | Magic-link request form |
| `verify/page.tsx` | Magic-link verification |
| `tickets/page.tsx` | The list, with search and pagination |
| `tickets/new/page.tsx` | The create form |
| `tickets/[ticketId]/page.tsx` | Detail and conversation |
| `layout.tsx` | Workspace resolution and header auth state |
| `not-found.tsx` | Shared 404 for the whole segment |
| `tickets/loading.tsx` | List skeleton |
| `tickets/error.tsx` | Route-segment error boundary |

The layout is deliberately **not** the internal dashboard layout: a single centred
column, no sidebar, no internal navigation. A sidebar would promise more to click and
most of it would be internal.

**Server-side protection.** Client-side restriction is not security. Every protected
page resolves its session on the server before rendering, and the service behind it
authorizes independently — a caller who skips the page still gets a `401`. Pages use
one of two helpers from `src/lib/customer-portal/guards.ts`:

- `requirePortalSession(slug)` for pages that need the resolved workspace or
  customer to render;
- `withPortalSession(slug, operation)` for pages whose main work is a service call
  that authorizes on its own.

The second exists for a concrete reason, not for tidiness: resolving the session twice
per render is not merely wasteful, it also writes two `lastUsedAt` updates. A page
that renders during a navigation and again during a prefetch turns that into a write
storm.

A session bound to a different workspace is treated exactly like no session and
redirects to that workspace's own login page. It is deliberately **not** a `403` —
answering "forbidden" would confirm to a stranger that the slug they guessed names a
real workspace.

**Verify page.** The token is handed straight to a client component that POSTs it to
the Task 1 verification endpoint. It is never rendered, echoed into the page, or
logged. The page does *not* call the verification service from the server component,
because a server render may happen speculatively — on a prefetch, on a client
navigation, on a strict-mode double render — which would consume the single-use token
before the customer's real request arrives. The session token is never touched here:
the endpoint returns it only as an `HttpOnly` cookie, so "signed in" is a server fact
rather than something the page can read or hand around.

**Login form** renders only the endpoint's generic response, and performs no local
pre-check of the email address — any such check would reintroduce the enumeration the
endpoint is built to avoid.

**Search** is a real GET form over the customer's own list, so a result page is a
bookmarkable, shareable URL rather than client-only state.

**Pagination** renders real links carrying the current search term. Disabled edges are
inert `aria-disabled` spans, not focusable links: a focusable element that goes
nowhere is a keyboard trap, and removing it from the tab order entirely would make
the pagination's existence undiscoverable.

**Error states** never render the caught exception. It is reported to the console for
the operator; the customer sees a fixed literal.

**Customer vocabulary** (`src/lib/customer-portal/presentation.ts`) keeps internal
jargon out of the portal per spec §13: `in_progress` renders as "In progress",
`waiting_customer` as "Waiting for you", and `medium` priority as "Normal".
Timestamps are formatted with a fixed `en-US` + UTC locale so a customer and a support
agent quoting a time in email mean the same instant.

**Accessibility.** Semantic landmarks with a skip link, labelled form controls, `role="status"` for in-flight and empty-result announcements, `role="alert"` for errors and validation failures, `aria-busy` on pending buttons, `aria-disabled` on inert pagination, `<time dateTime>` for machine-readable timestamps, and Tailwind responsive layouts that reflow to a single column. Loading skeletons are `aria-hidden` and mirror the real row layout so the list does not jump when data arrives.

### 10. Server Action

`createCustomerTicketAction` (`src/lib/customer-portal/actions.ts`) is the one
mutation exposed to the form. It re-derives identity from the session exactly like
the API routes, revalidates the ticket list, and returns a discriminated result —
the form never parses an error body.

## Security Properties

1. **The slug is not a credential.** It selects which workspace is addressed; it
   never says who the caller is.
2. **Ownership is a query predicate, not a post-filter.** Cross-customer and
   cross-workspace ids match zero rows.
3. **Not-found is uniform.** "Not yours" and "does not exist" produce the same
   status and the same body.
4. **The input contract is strict.** Unknown and workflow keys are rejected, not
   dropped.
5. **The DTO allowlist is structural.** Internal columns are never selected, so
   there is nothing to strip later.
6. **Activity is derived from customer-visible sources only.**
7. **No user is fabricated.** A customer-created ticket has no `createdById`, no
   `assignedToId`, no `TicketActivity.actorId`, and a null automation actor.
8. **No secret reaches a page.** The magic-link token is never rendered or logged;
   the session token only ever exists as an `HttpOnly` cookie.
9. **No internal error text reaches a customer.**

## Design Decisions

**Why a separate service module instead of parameterizing the internal one?** The
internal ticket service is membership-gated. Adding an optional customer path to it
would mean two authorization regimes in one function, and every future edit would
have to remember which one it was running under. Two modules means a cross-customer
read is a missing import rather than a missing `if`.

**Why is `availableActions` an empty array rather than absent?** `reply` is Task 3 and
`attach` is Task 4. The field exists so the UI renders from capability data instead of
a hard-coded "no reply box" branch that Task 3 would have to remember to remove.

**Why does the detail page not render a reply box at all?** Because Task 2 must not
ship a control that cannot work. A disabled "Reply" button that silently discards
input is worse than no button. Task 3 adds the box, driven by `availableActions`.

**Why is the message author derived from `createdById` being null?** Task 3
introduces an explicit `Message.authorType`. Under the current model every message
has a non-null `createdById` (`createMessage` is the only writer and always sets the
acting workspace user), so `null` is the only shape that is not an agent reply. No
member identity is exposed either way: the customer learns whether a message came
from the support team or the system, never who sent it.

**Why are reference characters looked up in a table rather than produced by
`Number.prototype.toString(36)`?** The fold needs each digit separately. A `BigInt`
renders in base 10, so converting the remainder directly emits `"35"` as two
characters and quietly produces a variable-width reference. The unit suite asserts
fixed width across 200 ids.

**Why is the verify page a client component rather than a server action?** See §9. A
server render can be speculative; a single-use token must be spent exactly once, by
exactly the request the customer made.

## File Changes

### Added — `src/lib/customer-portal/`

| File | Purpose |
| --- | --- |
| `errors.ts` | Portal error types; re-exports Task 1's for a single import surface |
| `schema.ts` | Strict create schema, list query schema, param normalization |
| `reference.ts` | Deterministic short ticket reference |
| `dto.ts` | Customer-safe DTOs and the allowlist mappers |
| `activity.ts` | The last-visible-activity rule |
| `session.ts` | Thin re-export of Task 1's session primitives |
| `guards.ts` | Page-level auth: `requirePortalSession`, `withPortalSession` |
| `presentation.ts` | Customer-facing labels, tones and UTC date formatting |
| `http.ts` | Error → status/body mapping for the API |
| `server.ts` | The customer ticket service |
| `actions.ts` | The create server action |

### Added — routes and UI

- `src/app/api/portal/[workspaceSlug]/tickets/route.ts`
- `src/app/api/portal/[workspaceSlug]/tickets/[ticketId]/route.ts`
- `src/app/portal/[workspaceSlug]/{layout,page,not-found}.tsx`
- `src/app/portal/[workspaceSlug]/login/page.tsx`
- `src/app/portal/[workspaceSlug]/verify/page.tsx`
- `src/app/portal/[workspaceSlug]/tickets/{page,loading,error}.tsx`
- `src/app/portal/[workspaceSlug]/tickets/new/page.tsx`
- `src/app/portal/[workspaceSlug]/tickets/[ticketId]/page.tsx`
- `src/components/portal/portal-shell.tsx`
- `src/components/portal/portal-sign-out-button.tsx`
- `src/components/portal/portal-error-state.tsx`
- `src/components/portal/customer-login-form.tsx`
- `src/components/portal/customer-verify-form.tsx`
- `src/components/portal/customer-ticket-search.tsx`
- `src/components/portal/customer-ticket-list.tsx`
- `src/components/portal/customer-ticket-list-skeleton.tsx`
- `src/components/portal/customer-new-ticket-form.tsx`
- `src/components/portal/customer-ticket-detail.tsx`

### Added — tests

- `src/__tests__/customer-portal.unit.test.ts` — reference, activity rule, DTO
  allowlist, strict schemas
- `src/__tests__/customer-portal.service.test.ts` — query shape, scoping,
  pagination, create transaction, actor semantics
- `src/__tests__/customer-portal.api.test.ts` — status codes, bodies, parameter
  filtering, error opacity
- `src/__tests__/customer-portal.ui.test.ts` — guard redirect-vs-404 decisions,
  customer vocabulary, date formatting
- `src/__tests__/customer-portal.integration.test.ts` — real-database ownership
  isolation and activity derivation

### Unchanged

No Prisma schema change, no migration, no change to `proxy.ts`, `Task 1` auth
modules, the internal ticket service, or the UI kit. The portal reuses the existing
`Button`, `Badge`, `Card`, `Input`, `Label`, `Textarea` and `Skeleton` primitives so
it reads as part of RelayDesk.

## Test Results

```
npm run typecheck   # clean
npm run lint        # clean, 0 errors, 0 warnings

customer-portal.unit.test.ts        33 passed
customer-portal.service.test.ts     29 passed
customer-portal.api.test.ts         20 passed
customer-portal.ui.test.ts          15 passed
customer-portal.integration.test.ts requires PostgreSQL
```

The four non-database suites pass. The integration suite needs a reachable
PostgreSQL (`DATABASE_URL_TEST`); it was **not executed** in this environment because
no PostgreSQL server or client binary is installed, and installing one is outside
this task's authority. It is written to run in CI, where the same prerequisite
already gates eight pre-existing integration suites.

The mocked service tests and the real-database tests are complementary, not
redundant. Mocks assert the *shape* of the query — that both ownership predicates are
in the `where` clause, that no column outside the allowlist is selected, that the
create is one transaction with null actors. The integration suite asserts that the
shape behaves correctly against real SQL, including that a cross-customer id and an
unknown id produce byte-identical errors.

Three real defects were found and fixed by the tests while writing this task:

- The reference fold converted a `BigInt` remainder directly to a string, which
  renders in base 10 — a digit above 9 emitted two characters, producing
  variable-width references like `#3152023140128`. Fixed with an explicit alphabet
  lookup; the suite now asserts fixed width across 200 ids.
- The BigInt literal `36n` is a syntax error under this package's ES2017 target.
  Replaced with `BigInt(36)`.
- An absent `description` parsed to `undefined` rather than `null`, splitting one
  concept across two values on the way to the insert. Now defaulted to `null`.

## Out of Scope

Deliberately not part of Task 2:

- Customer-authored `Message` rows, `Message.authorType`, `Message.customerId` — Task 3.
- Replies, reply form, status-change requests — Task 3.
- Email notifications for customer-visible events — Task 3.
- Attachments, upload, download, scanning — Task 4.
- Rate limiting and broad portal hardening beyond the properties listed above — Task 5.
- Any change to the internal ticket, automation or notification services.

## Next Steps (Task 3+)

Task 3 adds customer-authored messages. It will need a migration for
`Message.authorType` and `Message.customerId`, a customer session principal for
`createdById`, `availableActions` driving a real reply form, and a customer-visible
status-change signal that extends `resolveLastVisibleActivity` with a new source
rather than redefining the rule.
