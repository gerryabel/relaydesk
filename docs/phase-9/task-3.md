# Phase 9 — Task 3: Customer Conversation and Email Notifications

**Status:** Implemented
**Branch:** `phase-9/task-3-customer-conversation-email`

## Overview

Task 3 makes the customer portal a conversation rather than a read-only ticket list,
and adds the two emails a customer should never have to chase for: *the support team
replied* and *your ticket changed status*.

It builds on Task 2's session, scoping and DTO allowlist, and Task 1's magic link. The
organising principle is that **authorship is data, not an inference.** Task 2 derived a
message's author from "does `createdById` happen to be null"; that only worked because
`createMessage` was the sole writer and always set the acting user. Task 3 adds a second
writer — the customer — so that inference would have become a guess. `Message.authorType`
now states authorship explicitly, and PostgreSQL refuses any row whose foreign keys
disagree with it.

The second principle is that **an email payload is a claim, not content.** Events carry
identifiers only; the worker re-reads the ticket, the customer and the message before it
decides whether to send. That is what makes a ticket unlinked mid-queue safe.

## What This Task Delivers

### 1. Durable Authorship

`Message` gains `authorType` (`agent` | `customer` | `system`, defaulting to `system`) and
a nullable `customerId`. The invariant is:

| `authorType` | `createdById` | `customerId` | Constraint |
| --- | --- | --- | --- |
| `agent` | required | `null` | `message_author_agent` |
| `customer` | `null` | required | `message_author_customer` |
| `system` | `null` | `null` | `message_author_system` |

The three rules are enforced in two places, deliberately:

- **PostgreSQL**, by the named `CHECK` constraints in
  `prisma/migrations/20260924000000_add_message_author_type/migration.sql`. Prisma 7.9
  cannot express `@@check`, so they live in SQL and are referenced by name in
  `prisma/schema.prisma`. A future writer — a script, a migration, a new service — cannot
  opt out of them the way it can opt out of a TypeScript helper. The integration suite
  asserts each constraint rejects its own invalid shape.
- **The application**, by `src/lib/messages/authorship.ts`. `assertMessageAuthor` turns a
  bad write shape into a named `MessageAuthorshipError` (`missing_agent_author`,
  `unexpected_customer_agent`, …) *before* the round trip, so the failure names the rule
  instead of surfacing a PostgreSQL constraint error from a different layer.

The migration ends with a `DO $$` block that reads `pg_constraint` and raises if any of
the three constraints is absent. A migration that quietly skipped one would otherwise
look successful while leaving authorship partly unenforced, with the only symptom being an
unattributable message weeks later.

**Backfill.** Legacy rows map to `agent` when `createdById` is non-null and `system`
otherwise (automation-authored rows, historical seeds). The column is then set
`NOT NULL DEFAULT 'system'` — `system` being the only value valid with no author key, so
an incomplete legacy write fails the CHECK rather than inventing an author.

**Two foreign-key decisions worth stating:**

- `Message.customer` is `ON DELETE CASCADE`. Unlinking must not leave a row with
  `authorType = 'customer'` and `customerId = NULL`, which is precisely the shape
  `message_author_customer` forbids.
- `Message.createdBy` changed from `ON DELETE SET NULL` to `ON DELETE NO ACTION`. Under
  `SetNull`, deleting a user would null an agent's row and the delete would fail — but the
  error would name `message_author_agent`, sending the operator to the wrong place.
  `NoAction` defers the check to the end of the statement, so a cascading workspace
  delete (`Workspace → Membership → User`) still completes while deleting an author who
  has written a message is refused with a foreign-key error that says what actually
  happened.

### 2. Agent Replies Notify the Customer

`createMessage` (`src/lib/messages/server.ts`) became a single transaction that writes
the message, stamps `firstResponseAt` when the ticket had none, and queues
`TICKET_REPLIED` when the ticket has a customer. The message write now states authorship
explicitly (`authorType: 'agent'`, `createdById: membership.userId`, `customerId: null`)
rather than leaving `authorType` to its default.

The API route is now a thin wrapper over `createMessage` / `getMessages`. That is not
cosmetic: a route writing its own rows would have had no way to notify the customer, so
the tests follow the call through to the transaction rather than asserting on ad-hoc
route queries.

### 3. Customer Replies

`createCustomerReply` (`src/lib/customer-portal/server.ts`) is the customer-side writer.
It derives identity exclusively from `requireCustomerInWorkspace`, scopes the ticket read
by `(id, workspaceId, customerId)` in one query, and inserts one row. It does **not**
touch the ticket: a customer reply is neither an implicit reopen nor an agent first
response, so `status` and `firstResponseAt` are left alone. There is no
`ticket.updatedAt` write, so the agent-side ticket list does not reorder under an agent
while a customer is typing.

**The body is `{ body }` and nothing else.** `z.strictObject` means `status`,
`authorType`, `customerId`, `createdById` and `ticketId` are rejected with a `400`
rather than silently dropped — a caller is told their value was ignored instead of being
left to believe it took effect.

Replies are refused on a `closed` ticket with `CustomerTicketReplyNotAllowedError`, which
maps to `400`. It is distinct from `CustomerTicketNotFoundError` because the ticket *is*
visible: saying it is closed is useful, not a disclosure. It is not a `409` because the
portal's status vocabulary is the one in `src/lib/customer-portal/http.ts`, and the useful
signal is "this will never work as written".

| Route | Success | Notes |
| --- | --- | --- |
| `POST /api/portal/{slug}/tickets/{ticketId}/messages` | `201` | `{ body }` only; returns the customer-safe message DTO |
| `createCustomerReplyAction` | — | server action behind the form; revalidates the detail page |

The response is a `CustomerMessageView`, so a raw message id never crosses the wire — the
same allowlist discipline as Task 2's detail endpoint.

### 4. Conversation UI

`src/components/portal/customer-reply-form.tsx` renders only when the DTO's
`availableActions` includes `reply`, driven by the *same* predicate
(`resolveCustomerTicketActions`) the service enforces, so the UI cannot offer a reply the
service will refuse or hide one it will accept. On a closed ticket the conversation ends
with a status notice instead of a disabled control that silently discards input.

Authors render as `Support team`, `You` or `System`. No agent identity is exposed, in
either direction: the customer never learns who replied, and a customer reply never
surfaces an internal account. `src/app/dashboard/tickets/[id]/page.tsx` was updated for
the same three labels.

### 5. Customer-Visible Status Changes

Task 2's activity rule took the maximum of the ticket's `createdAt` and its visible
messages. Task 3 adds a third source rather than redefining the rule:
`TicketActivity` rows of type `STATUS_CHANGED`, read through the existing grouped query.

This is the one `TicketActivity` type that qualifies. Every other type either records an
internal actor id or the before/after of an internal field (assignment, priority, tags,
customer linking), so including them would leak internal work. A status change is
customer-facing by definition — the portal renders it in the customer's own vocabulary —
so it belongs in the rule.

The list page reads these with a `groupBy` restricted to the ids on the page being
rendered, so the query count stays fixed and does not grow with page size.

### 6. Status Emails From Every Write Path

Four independent code paths can move a ticket's status, and a notification that covers
only three of them is a gap nobody notices until a customer asks:

| Path | Function |
| --- | --- |
| Update form | `updateTicket` |
| Close | `closeTicket` |
| Bulk action | `bulkUpdateTickets` (`action: 'status'`) |
| Automation | `set-status` action handler |

All four queue `TICKET_STATUS_CHANGED` inside the caller's transaction, alongside the
`STATUS_CHANGED` activity row, and all four are asserted individually in
`src/__tests__/customer-email.status-paths.test.ts`.

Two edge cases are handled at the shared helper rather than in four call sites:

- **No customer, no event.** An internal ticket has nobody to notify.
- **No change, no event.** A bulk run whose selected tickets are already at the target
  status counts them as no-ops and says nothing.

`updateTicket` passes `updated.customerId` — the customer linked *after* the write — so a
combined "link a customer and change status" update notifies the customer who now owns
the ticket rather than nobody.

### 7. Event Payloads

`src/lib/customer-notifications/events.ts` owns both payload schemas and both queue
helpers. Three rules:

1. **Identifiers only.** A payload carries `workspaceId`, `ticketId`, `customerId` and the
   message or status ids. It carries no address, subject or body. Everything a customer
   reads is rendered in the worker from freshly read state, so a ticket renamed after the
   event was queued cannot produce an email whose subject contradicts the portal.
2. **`strictObject`, not `object`.** An unexpected key — a smuggled `to` or `subject` — is
   a failed parse at write time rather than a silently dropped field that hides a future
   mistake.
3. **Same transaction as the state change.** Both helpers take the caller's
   `Prisma.TransactionClient`, so a status change, its activity row and its email event
   commit or roll back together. An email event written outside the transaction would
   still be delivered for a change that later rolled back.

### 8. The Worker

`src/lib/queue/handlers/customer-email.ts` handles both event types, registered in the
existing handler registry. It follows `handleCustomerMagicLinkEvent`'s shape: validate the
payload, check `SentEmail` for idempotency, re-read the state the email describes, claim,
send, mark.

The re-read is a security control, not a convenience. Between the moment a transaction
queued the event and the moment the worker runs, the ticket may have been unlinked,
relinked to a different customer, or its customer deleted. The payload's `customerId` is
a *claim about who the email was meant for*; it is honoured only while the database still
agrees. Every disagreement completes the event without sending:

| Situation | Behaviour |
| --- | --- |
| Already recorded in `SentEmail` | success, no send |
| Ticket deleted, or in another workspace | success, no send (`missing_ticket`) |
| Ticket unlinked or relinked | success, no send (`unlinked_customer`) |
| Customer row gone, or has no email | success, no send (`missing_recipient`) |
| Message deleted, or not agent-authored | success, no send |
| Payload fails validation | success, no send |

The reply handler additionally requires `authorType = 'agent'` with a non-null
`createdById`. A customer reply or a system row reaching it means the event was produced
for the wrong reason, and echoing a customer's own words back to them would be both
useless and confusing.

A customer-authored message does **not** emit an event. Emailing the author of a reply
they just sent would train customers to ignore the channel, and the reply is already in
their portal.

Delivery failures reuse the existing classification: permanent rejections release the
claim and report non-retryable; retryable failures release the claim and rethrow so the
outbox's retry policy applies; a lost claim (`P2002`) means another worker holds it, so
this one sends nothing.

### 9. Email Content

`src/lib/customer-notifications/email-content.ts` renders both messages, separated from
the worker so the exact bytes a customer receives are assertable without a database or a
provider. Two properties matter more than the wording:

- **No raw ticket id reaches a customer.** Subjects and bodies use Task 2's stable
  `formatTicketReference`; links go to `/portal/{workspaceSlug}/tickets`, not to a ticket
  route. Emails get forwarded, archived and scraped, and must not hand out a ticket
  identifier.
- **Customer text cannot break out of a header.** Ticket titles and message bodies are
  attacker-controlled. Control characters are stripped, whitespace runs collapsed, and
  subjects truncated; HTML is escaped for both text and attributes. The title reaches only
  the body, never a header, which is asserted directly.

The workspace slug in the link is a lookup key, not a credential — the portal still
requires a customer session.

## Security Properties

1. **Authorship is enforced by the database.** Three named CHECK constraints, verified
   present by the migration itself.
2. **Authoring history is not silently erased.** Deleting an author of an agent message
   is refused rather than nulling the column.
3. **A customer cannot post as anyone.** Identity comes from the session; `createdById`,
   `authorType` and `customerId` are not accepted from the request body.
4. **A customer cannot drive workflow.** The reply path writes exactly one row: no status
   change, no reopen, no `firstResponseAt`.
5. **Ownership is a query predicate.** `(id, workspaceId, customerId)` in one `findFirst`;
   a foreign ticket is indistinguishable from a missing one.
6. **Email payloads cannot be used to mail a stranger.** Identifiers only, strict keys, and
   the worker re-verifies the recipient against current database state.
7. **No raw identifiers leave the boundary.** Customer messages expose no message id;
   emails expose no ticket id.
8. **No internal error text reaches a customer or a header.** Unexpected failures are
   logged and answered with a fixed literal.

## Design Decisions

**Why not derive authorship from which foreign key is null?** Because the customer path
makes the null case ambiguous. Task 2's derivation was correct only under the assumption
that `createMessage` was the sole writer; with a second writer, "null means system"
becomes a guess that a future automation rule would eventually get wrong. An explicit
column plus a database constraint is the version of this that stays true.

**Why does the reply path not update the ticket at all?** Because two tempting updates are
wrong. Bumping `updatedAt` reorders the agent's ticket list under them mid-typing, and
moving a closed ticket back to `open` would let a customer override an agent's decision.
The reply is a message, and only a message.

**Why does the closed-ticket refusal map to `400` rather than `409`?** `409` is the more
precise HTTP answer, but it would introduce a status the portal does not otherwise use,
for a case that is not a resource conflict a client can resolve. The portal's vocabulary
is `{400, 401, 403, 404, 500}`, and "this request cannot work as written" is what the
customer needs to hear.

**Why is status history added to the activity rule instead of exposing `TicketActivity`?**
Exposing activity rows wholesale would leak actor ids and internal before/after values.
Adding one type to the existing derivation keeps the rule in one function, which is what
Task 2 exported it for.

**Why does the worker complete rather than fail on a stale event?** Because the event is
not an error condition — the recipient genuinely changed. Completing it marks the outbox
event done without mailing the wrong person; failing it would retry an event that can never
become sendable.

**Why does the reply path emit no event?** A customer who just wrote a message already
knows they wrote it, and a notification for one's own action is the fastest way to train
someone to ignore the channel.

## File Changes

### Schema and migration

| File | Change |
| --- | --- |
| `prisma/schema.prisma` | `MessageAuthorType`, `Message.authorType`, `Message.customerId`, `Customer.messages`, `createdBy` → `NoAction` |
| `prisma/migrations/20260924000000_add_message_author_type/migration.sql` | enum, backfill, `NOT NULL DEFAULT`, index, both FKs, three CHECK constraints, `pg_constraint` self-check |

### Added — library

| File | Purpose |
| --- | --- |
| `src/lib/messages/authorship.ts` | The authorship contract and its write-side assertion |
| `src/lib/customer-notifications/events.ts` | Payload schemas and transactional queue helpers |
| `src/lib/customer-notifications/email-content.ts` | Sanitized subjects, excerpts, HTML, portal links |
| `src/lib/queue/handlers/customer-email.ts` | The worker handler for both event types |

### Modified

- `src/lib/messages/server.ts` — transactional agent message writer, explicit authorship
- `src/app/api/tickets/[id]/messages/route.ts` — delegates to the service
- `src/lib/outbox/types.ts` — `TICKET_STATUS_CHANGED`
- `src/lib/queue/handlers/registry.ts` — customer email handler registration
- `src/lib/tickets/server.ts` — `updateTicket`, `closeTicket`
- `src/lib/tickets/bulk.ts` — `bulkUpdateTickets`
- `src/lib/automation/actions/handlers.ts` — `set-status`
- `src/lib/customer-portal/{schema,errors,dto,activity,server,http,actions}.ts`
- `src/components/portal/customer-ticket-detail.tsx`,
  `src/components/portal/customer-reply-form.tsx`
- `src/app/portal/[workspaceSlug]/tickets/[ticketId]/page.tsx`,
  `src/app/dashboard/tickets/[id]/page.tsx`

### Added — routes

- `src/app/api/portal/[workspaceSlug]/tickets/[ticketId]/messages/route.ts`

### Added — tests

- `src/__tests__/message-author.test.ts` — the authorship table and its error codes
- `src/__tests__/customer-email.events.test.ts` — payload strictness, no-op conditions
- `src/__tests__/customer-email.content.test.ts` — sanitization, escaping, no raw ids
- `src/__tests__/customer-email.handler.test.ts` — stale-link refusals, idempotency, delivery failures
- `src/__tests__/customer-email.status-paths.test.ts` — all four write paths
- `src/__tests__/customer-portal.{unit,service,api}.test.ts` — extended for replies

### Extended

- `src/__tests__/messages.isolation.test.ts` — agent reply event and transaction scope
- `src/__tests__/customer-portal.integration.test.ts` — database CHECK enforcement,
  customer-delete cascade, and real customer replies

## Test Results

```
npm run typecheck   # clean
npm run lint        # clean, 0 errors, 0 warnings

message-author.test.ts               12 passed
customer-email.events.test.ts        14 passed
customer-email.content.test.ts       24 passed
customer-email.handler.test.ts       23 passed
customer-email.status-paths.test.ts  10 passed
messages.isolation.test.ts            6 passed
customer-portal.unit.test.ts         50 passed
customer-portal.service.test.ts      40 passed
customer-portal.api.test.ts          33 passed
customer-portal.ui.test.ts           15 passed
customer-portal.integration.test.ts requires PostgreSQL
```

The non-database suites pass. `customer-portal.integration.test.ts` — extended here with
the CHECK-constraint and cascade cases, which are the properties mocks structurally
cannot prove — needs a reachable PostgreSQL via `DATABASE_URL_TEST`. It was **not
executed** in this environment: no PostgreSQL server or client binary is installed, and
installing one is outside this task's authority. The same prerequisite already gates eight
pre-existing integration suites, so CI runs them unchanged.

`prisma migrate diff` was not run against a live server either, for the same reason. The
migration's SQL is reviewed by hand and its constraint coverage is asserted at the end of
the migration itself, which fails loudly rather than silently under-applying.

## Out of Scope

Deliberately not part of Task 3:

- Attachments, upload, download, scanning — Task 4.
- Rate limiting and broader portal hardening — Task 5.
- Inbound email, `Reply-To` threading, or parsing customer email into replies.
- Customer-initiated status changes or reopen requests.
- Per-workspace or per-customer notification preferences, digests, or unsubscribe.
- OAuth/SSO sign-in.
- Any change to `proxy.ts`, the Task 1 auth modules, or the UI kit.

## Next Steps (Task 4+)

Task 4 adds attachments, which reaches into this task's schema decisions: an attachment
uploaded by a customer needs an author too, and the `authorType` table is the right place
to record it rather than a second nullable pair of foreign keys.
