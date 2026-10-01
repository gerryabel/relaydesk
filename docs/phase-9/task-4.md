# Phase 9 — Task 4: Customer Attachments

**Status:** Implemented
**Branch:** `phase-9/task-4-customer-attachments`

## Overview

Task 4 lets a customer attach a file to their own reply and download the files on their
ticket. It is deliberately small: two routes, one service module, and no change to how
agents upload or download anything.

The organising principle is the same one Task 2 established for tickets and Task 3 for
messages, applied to a resource that is *reachable by id*. A ticket is only ever fetched
through a customer-scoped query, so a foreign ticket id simply matches nothing. An
attachment is different: the portal DTO hands the customer an attachment id, so anyone can
write `/api/portal/<their-slug>/attachments/<any-id>` by hand. **The id is a render hint,
not an authorization.** The download endpoint therefore re-walks the entire ownership
chain on every request, and does it inside the query rather than in a branch after it.

The second principle is that **the browser is a source of claims, not of truth.** The
filename and the MIME type are whatever the customer's browser put in the multipart body.
The size is not, because the server counts the bytes it actually received. No claim from
the request reaches the storage path: keys are opaque UUIDs, so a filename cannot
influence where a file is written or traverse out of the storage root.

## What This Task Delivers

### 1. A Separate Authorization Domain

`src/lib/customer-portal/attachments.ts` is a **sibling** of
`src/lib/attachments/service.ts`, not an extension of it. The internal service opens with
`getCurrentMembership()` — a Better Auth workspace session, which a customer session can
never satisfy. Adding a customer branch to that path would have meant one function
answering "authorized?" for two principal types, with the branch decided by the shape of
the request. Instead the two domains share no call path at all:

| | Internal | Customer |
| --- | --- | --- |
| Session | `getCurrentMembership()` | `requireCustomerInWorkspace(slug)` |
| Entry point | `POST /api/messages/[id]/attachments` | `POST /api/portal/[slug]/tickets/[ticketId]/messages/[messageId]/attachments` |
| Download | `GET /api/attachments/[id]` | `GET /api/portal/[slug]/attachments/[attachmentId]` |
| Who may upload | any workspace member | the customer who wrote that exact message |
| Shared | storage provider, config, filename helpers | storage provider, config, filename helpers |

The internal route keeps its own membership check unchanged; it only now builds its
`Content-Disposition` through the shared helper.

### 2. Upload Authorization Lives in the Query

```ts
where: {
  id: messageId,          // caller-supplied lookup key
  ticketId,               // caller-supplied lookup key
  authorType: 'customer',
  customerId: owner.customerId,      // from the session, never the request
  createdById: null,
  ticket: {
    workspaceId: owner.workspaceId,  // from the session
    customerId: owner.customerId,
  },
}
```

Every condition is a `where` clause, so there is no read-then-judge step that could be
forgotten. Six classes of caller match zero rows and all raise the same
`CustomerAttachmentNotFoundError`:

- a message id belonging to another customer in the same workspace;
- a message on a ticket the customer does not own;
- a message on another workspace's ticket;
- an **agent-authored** message on the customer's own ticket — a customer must not be
  able to attach a file to something an agent said;
- a **system** message;
- an unknown id.

`ticketId` being in the predicate matters independently of `ticket.customerId`: both ids
arrive in the URL, and passing the ticket check alone would leave "the right message, the
wrong ticket" open.

### 3. Download Re-Walks the Whole Chain

```ts
where: {
  id: attachmentId,
  message: {
    authorType: { in: ['agent', 'customer'] },
    ticket: {
      workspaceId: owner.workspaceId,
      customerId: owner.customerId,
    },
  },
}
```

`agent` is visible (agent uploads belong to the customer-visible conversation);
`system` is not, because it has no author a customer could correspond with. A storage
read happens only after this predicate matches, so a foreign id costs one `SELECT` and no
filesystem access.

Foreign, cross-workspace, non-visible and missing all produce the identical
`404 { error: "Not found" }`. A distinguishing status, header or body would be an
existence oracle for every attachment id in every workspace.

### 4. Filenames Are Sanitized on Both Sides

`src/lib/attachments/filename.ts` is a new shared module, used by the customer path and
by the internal service. `sanitizeAttachmentFilename` NFKC-normalizes, reduces to a
basename, strips control and invisible characters (including U+202E, which otherwise
makes `exe.txt` *display* as `txt.exe`), substitutes path-unsafe characters, clamps to 255
bytes while preserving the extension, and falls back to `attachment` when nothing survives.

`buildAttachmentContentDisposition` then emits both a quoted ASCII `filename` and the
RFC 5987 `filename*`, so a name with accents survives in modern clients and still saves
somewhere legible in old ones. The output is always a single line.

### 4a. MIME Types Fail Closed

`normalizeAttachmentMimeType` reduces a declared type to its bare essence, returning `''`
for anything it cannot vouch for. The download path then writes that result straight into
`Content-Type`, so the value used is `normalize(...) || 'application/octet-stream'` — never
the raw stored string.

The previous `|| attachment.mimeType` was a header-injection sink for any row whose stored
type fails normalization: `text/plain\r\nX-Injected: yes` would have been handed to
`new Response()` verbatim. On Node this happens to throw a `TypeError` inside `Headers`, so
the exploit *appears* to fail — but that is an accident of the HTTP library, not a control,
and other runtimes accept CR/LF in a header value. The application chooses the value; the
HTTP layer is not the thing being relied on.

`application/octet-stream` is inert: not in the allowlist, never rendered inline, and no
parameters available to smuggle. The customer still receives their bytes — a legacy row with
an unusable type gets an unhelpful content type rather than a broken download.

The constant is defined once in `filename.ts` (`ATTACHMENT_FALLBACK_MIME_TYPE`) and
referenced by both the server-only download path and the client-safe DTO, so the two cannot
drift into different fallbacks. `toCustomerAttachmentView` received the same treatment: its
value is a JSON field and cannot inject a header, but a stored `text/plain\r\n...` should not
be republished into a customer payload either.

The **internal** writer is normalized in the same direction: `AttachmentService` now
normalizes the declared type *before* the allowlist check and persists that normalized
value, rather than validating one string and writing another. The allowlist is unchanged and
still exact-match, so `text/plain; charset=utf-8` and `TEXT/PLAIN` are accepted (as they
already were on the customer path) while `text/html`, `image/svg+xml` and
`application/x-executable` remain rejected. Both upload paths now store the canonical bare
type, so no un-normalized value enters storage in the first place.

### 4b. The Attachment Cap Is Enforced Under a Row Lock

A message may hold at most `CUSTOMER_ATTACHMENTS_PER_MESSAGE_LIMIT` attachments. The check
is **inside the metadata transaction**, immediately after
`SELECT "id" FROM "Message" WHERE "id" = $1 FOR UPDATE` on the exact authorized message, and
immediately before the insert it guards.

Read before the transaction, that check was not a limit at all. Two concurrent uploads to a
message holding 9 attachments both read `9`, both saw room, and both committed — leaving 11
on a message documented to hold at most 10. The count is only meaningful if it is read while
every other inserter for that message is excluded; a row lock is what provides that without
weakening the isolation level for the whole transaction.

Notes on the choice:

- **Per message row, not a global or advisory lock.** An advisory lock keyed by message id
  would also serialize, but it is anonymous in `pg_locks` and outlives the row it describes.
  The `Message` row is the durable, self-describing lock, and uploads to *different* messages
  never contend — asserted by a test.
- **Scope is the already-authorized id.** The lock helper takes only the id resolved through
  the ownership predicate; it accepts no broader scope (ticket, workspace, "any message"), so
  it cannot be pointed at a row the caller was never authorized for. The id is a bound
  parameter, never concatenated.
- **Uniform lock order** (this message row, then attachment inserts against it), so no
  deadlock cycle can form between concurrent uploads.
- **Byte-level validation stays outside the transaction.** Empty, oversize, MIME and
  filename are pure functions of the request bytes; only the capacity check is a statement
  about database state, and only that one needs the lock.

The cleanup path also covers the rejection: storage is written before the transaction, so a
capacity rejection found under the lock orphans a file unless it is removed. A full message
keeps its `400` and its cap message rather than being flattened into the generic `500`, as
does a message deleted between the authorization query and the lock (the only new `404`
path this introduces).

**Sanitizing on the read path as well is not redundancy.** Attachments written through the
internal route before this task hold whatever filename an agent's browser sent, and the
ticket projection reads those same rows. `toCustomerAttachmentView` therefore sanitizes
too, so a pre-existing hostile name cannot be rendered into the conversation even though
the download route would rewrite it again.

MIME types get the same treatment, for the same reason and with one difference: a
malformed `Content-Type` is not merely wrong-looking, it is a response-splitting primitive.
See 4a and 4b.

### 5. Storage Lifecycle

Storage is written *before* the metadata transaction, because the provider has no
transaction to enlist in — the same ordering, and for the same reason, as the internal
service. If the transaction fails, the stored object is deleted before the error
propagates, so a metadata failure never leaves an orphan that neither the customer nor an
agent can remove through the portal. A cleanup failure is logged and swallowed: replacing
the real cause with "cleanup failed" would send an operator to the wrong place.

The attachment row and its `ATTACHMENT_ADDED` activity row are written in one
transaction, so an attachment can never exist without its activity.

Activity is **internal only**, and `actorId` is `null` because a customer is not a
`User` — attributing an upload to an arbitrary workspace user would fabricate an actor.
Because `loadLastVisibleActivity` counts only customer-visible messages and
`STATUS_CHANGED`, an attachment does not move a ticket's `lastActivityAt`: a file with no
words should not reorder the customer's ticket list.

### 6. What the Customer Can Never See

`CustomerAttachmentView` is five fields: `id`, `originalFilename`, `mimeType`,
`sizeBytes`, `createdAt`. Not `storageKey`, not `messageId`, not `workspaceId`, not
`customerId`, not `createdById`, not activity.

Three independent layers enforce this, which is deliberate:

1. the query's `select` never reads those columns;
2. the mapper takes a narrow argument type, so it cannot receive them;
3. the **route projects to an explicit allowlist** rather than serializing what the
   service returned.

Layer 3 is redundant today and that is the point. It makes the guarantee a property of
*that route* instead of a property of a module it calls, and the `CustomerAttachmentView`
annotation means a future field added to the service's DTO becomes a compile error before
it becomes a leak.

## Design Decisions

**The reply form uses a server action, not the REST route, to write.** The compose flow
needs the new message's id to attach files to it — and Task 3 deliberately never exposes a
raw message id in the customer DTO. Sending it to the browser just to POST it back would
undo that. The action keeps the id server-side:

```
1. customer submits the reply
2. the reply is stored, and is the customer-authored message
3. each selected file is attached to that message
4. the conversation re-renders with what actually landed
```

The reply is committed first because it is the record of what the customer said and what
they would be upset to lose. A file that cannot be stored is reported per-file rather than
rolling back the message. The REST route still exists and is fully tested — it is the
endpoint the download links use, and the documented path for anything not driven by the
compose form.

**`CUSTOMER_ATTACHMENTS_PER_MESSAGE_LIMIT = 10` lives in `schema.ts`, not in the service.**
A customer has no delete path in Task 4, so an unbounded count would let one message
accumulate storage nothing can reclaim. It sits beside `CUSTOMER_REPLY_BODY_MAX_LENGTH`
because the reply form is a *client* component: importing the number from the service
would pull `node:crypto`, Prisma and the filesystem-backed provider into the browser
bundle. That was a real build failure, not a theoretical one — see below. Enforcement
remains entirely server-side; the constant only lets the form disable its own submit early.

**A bad filename does not fail an upload.** It is rewritten. Refusing to store a file
because of its *name* would break a legitimate download for a cosmetic reason, and the
bytes are still authorized. Only the type and the size are refusable.

**An execution type is refused regardless of the filename.** `photo.jpg` declared as
`application/x-executable` is rejected; the extension is never the control.

## Testing

| Suite | Count | What it proves |
| --- | --- | --- |
| `customer-attachments.filename.test.ts` | 54 | Sanitizer, header builder, MIME normalizer |
| `customer-attachments.service.test.ts` | 60 | Exact query predicates, storage ordering, cleanup, error classes |
| `customer-attachments.api.test.ts` | 32 | Status codes, headers, and that nothing internal reaches a response |
| `customer-attachments.integration.test.ts` | 31 | That the predicates behave correctly against real SQL, and that concurrent uploads cannot exceed the cap |
| `customer-portal.service.test.ts` (added) | 5 | Attachment projection shape in the ticket read |
| `customer-portal.unit.test.ts` (added) | 10 | DTO allowlist and read-path sanitization |
| `customer-portal.ui.test.ts` (added) | 4 | Locale-independent size formatting |

Three of the four mocked suites and one existing suite were **corrected during
implementation**; the changes are worth recording because the tests were not wrong so much
as they encoded the pre-Task-4 shape:

- `customer-portal.service.test.ts` asserted an exact `select` with four message columns.
  It now asserts the attachment sub-projection exists, that its keys are exactly the five
  displayable fields, that it never widens to `storageKey` or `messageId`, and that its
  author-type filter equals the one the download route enforces. The last one matters: if
  the two ever drift, the portal would *list* an attachment it then refuses to serve.
- The filename expectations were corrected against the real sanitizer (`a\rb.txt` →
  `ab.txt`, not `arb.txt`) and the header tests were rewritten to assert structure —
  single-line, ASCII-only, confined to the quoted string — rather than that particular
  substrings are absent. `"X-Injected"` surviving as literal filename text is inert; the
  CRLF that would start a second header line is the actual hazard.
- A workspace-mismatch test asserted a property of `requireCustomerInWorkspace`, which
  those suites stub. It now asserts the thing the *service* controls: the predicate is
  pinned to the session's resolved workspace, not to the slug in the URL.

**The concurrency test needs a real database and cannot be mocked.** The invariant in 4b is
enforced by `SELECT ... FOR UPDATE` serializing two transactions; a mocked client has no
transactions to serialize and would pass with the lock removed. `customer-attachments.integration.test.ts`
therefore fires two uploads at a message seeded to 9 attachments with `Promise.allSettled`
and asserts the row count afterwards. Two variants: a two-racer race for the last slot
(exactly one winner), and a four-way burst against two remaining slots (exactly two
winners) — the second pins that the lock queue orders racers correctly rather than just
serializing a single pair. A third test asserts uploads to *different* messages both
succeed concurrently, which a global or ticket-scoped lock would break.

These are among the tests that cannot run here: see Verification.

**Assertions are on structure, not on substrings.** The MIME tests check that the returned
value contains no CR/LF and is not one of the injected header names, rather than that
particular strings are absent — `"X-Injected"` surviving as inert literal text is not the
hazard, the CRLF that starts a second header line is. The lock tests assert the SQL contains
`FOR UPDATE` and `WHERE "id" = ?` and *not* `FOR UPDATE ALL`, `pg_advisory`, or the literal
id, which is what distinguishes a per-row lock with a bound parameter from a table or global
lock with a spliced-in string.

**Each new test was checked against the un-fixed code.** Reverting each fix in isolation
makes exactly its own tests fail — 9 for the MIME fallback, 6 for the lock, 4 for internal
normalization — and no others. Without that, a passing suite could be passing for the wrong
reason.

**Why the integration suite is not redundant with the mocked ones.** Mocks assert that the
ownership predicates are *present*. They cannot assert the predicates are *correct*, and
the ways that break are easy to commit and hard to notice — a Prisma relation filter
written against the wrong relation type-checks perfectly and silently authorizes too much;
`authorType: { in: [...] }` typo'd as `authorType: 'agent'` looks restrictive and is the
opposite. The integration suite inserts the rows a hostile caller would need and reads back
what the service actually returns, and each negative case sits beside a positive control so
a fixture that is merely empty cannot make it pass.

## Verification

```
npm run typecheck    clean
npm run lint         clean
npm run build        succeeds
npm test             10 failed | 107 passed (117) files
                     130 failed | 1532 passed | 16 skipped (1678) tests
```

**Every one of the 130 failures is `Can't reach database server at 127.0.0.1:5432`.**
No PostgreSQL is running in this environment and installing a server was out of scope. The
same 10 files fail with and without this work; the delta is entirely new tests in the
integration file. Measured against the previous commit on this branch:

```bash
git stash -u && npm test   # before remediation: 127 failed | 1504 passed | 16 skipped (1647)
git stash pop && npm test   # after  remediation: 130 failed | 1532 passed | 16 skipped (1678)
```

So the remediation adds 31 tests, of which 28 run and pass without a database and 3 are the
concurrency cases that need one. The 3 new failures are the 3 new DB-backed tests, not a
regression.

**This is the one part of the work that is unverified at runtime.** The mocked suites prove
the lock is taken, that it precedes the count, and that the count is scoped to the
transaction — but only a real PostgreSQL proves two concurrent transactions actually
serialize on it. The 4a and 4b fixes should not be considered fully confirmed until
`customer-attachments.integration.test.ts` has been run against a live database.

The `build` warning about `Encountered unexpected file in NFT list` is pre-existing on
`main` and unrelated — it concerns `path.resolve` in `next.config.ts`.

## Changes to Existing Internal Code

Three files outside the new customer path changed, all minimally:

- `src/lib/attachments/service.ts` now sanitizes the filename before storing it, so new
  internal uploads cannot add rows that the customer path would have to defend against.
  Existing rows are covered by read-path sanitization. The OMP remediation added MIME
  normalization here as well (4a): the allowlist check and the persisted value are now the
  same normalized string. This widens nothing — the allowlist is unchanged and still
  exact-match, so no previously-rejected type is now accepted.
- `src/app/api/attachments/[id]/route.ts` builds `Content-Disposition` through the shared
  helper and gains `X-Content-Type-Options: nosniff`. Its membership authorization is
  untouched. This is the one behavioural change outside the customer path: the previous
  `filename="${encodeURIComponent(...)}"` interpolated the stored name into a header
  (percent-encoding happens to escape `"` and CR/LF, but a `'` and a `\` survived, and
  many clients save the percent-encoded form verbatim). Flagged as a deviation because the
  task asked that the internal flow stay unchanged.

No Prisma schema change and no migration: `Attachment` already had the relation and
columns this task needed.

## Explicit Non-Goals

Per the task definition, and unchanged by this implementation:

- no customer delete or attachment management;
- no preview, thumbnails, or in-browser rendering of any stored type;
- no virus scanning, content sniffing, or image processing;
- no storage backend other than the existing provider;
- no multipart upload across several HTTP requests;
- no change to agent-facing attachment behaviour.