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

**Sanitizing on the read path as well is not redundancy.** Attachments written through the
internal route before this task hold whatever filename an agent's browser sent, and the
ticket projection reads those same rows. `toCustomerAttachmentView` therefore sanitizes
too, so a pre-existing hostile name cannot be rendered into the conversation even though
the download route would rewrite it again.

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
| `customer-attachments.integration.test.ts` | 28 | That the predicates behave correctly against real SQL |
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
                     127 failed | 1504 passed | 16 skipped (1647) tests
```

**Every one of the 127 failures is `Can't reach database server at 127.0.0.1:5432`.**
No PostgreSQL is running in this environment and installing a server was out of scope. The
baseline on `main` fails the same 99 tests across 9 files; the delta is exactly the 28
tests in the new integration file. To confirm:

```bash
git stash -u && npm test   # main baseline:  99 failed
git stash pop && npm test  # this branch:   127 failed  (+28, all new file)
```

The `build` warning about `Encountered unexpected file in NFT list` is pre-existing on
`main` and unrelated — it concerns `path.resolve` in `next.config.ts`.

## Changes to Existing Internal Code

Two files outside the new customer path changed, both minimally:

- `src/lib/attachments/service.ts` now sanitizes the filename before storing it, so new
  internal uploads cannot add rows that the customer path would have to defend against.
  Existing rows are covered by read-path sanitization.
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