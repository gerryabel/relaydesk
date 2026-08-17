# Phase 5 — Task 7: Internal Notes

## Purpose

Internal Notes adds agent-only notes to tickets so the support team can collaborate without exposing any note content to customers. It is intentionally separated from customer-visible `Message` data.

## Entity

`InternalNote` is a separate Prisma model.

Fields:

- `id`
- `ticketId`
- `authorId`
- `body`
- `createdAt`
- `updatedAt`

Relations:

- `InternalNote.ticket`
- `InternalNote.author`
- `Ticket.internalNotes`
- `User.internalNotes`

Indexes:

- `InternalNote.ticketId + createdAt`
- `InternalNote.authorId + createdAt`

## Authorization

Workspace membership is required. The current workspace is resolved from the authenticated session; client-supplied workspace IDs are not trusted. Only users in the same workspace as the ticket may create or list internal notes.

## Immutability

Task 7 implements create and list only. No update or delete endpoints are exposed.

## API

- `GET /api/tickets/[id]/internal-notes`
- `POST /api/tickets/[id]/internal-notes`

The legacy `GET /api/tickets/[id]/messages` endpoint remains customer-visible only and never returns `InternalNote` records.

## Validation

- `body` is required.
- `body` is trimmed and must be non-empty after trimming.
- `body` must not contain only whitespace.
- `body` maximum length is `10_000` characters.
- Plain text only.

## Transaction behavior

Creating an internal note is atomic with its activity entry:

1. create `InternalNote`
2. create `TicketActivity` with type `INTERNAL_NOTE_CREATED`
3. commit both together

If either step fails, neither is persisted.

## Activity integration

A new `TicketActivityType` value is added:

- `INTERNAL_NOTE_CREATED`

Activity metadata may include the `InternalNote` id. The note body stays in `InternalNote`, not in activity metadata.

## UI / Ticket detail

Ticket detail now shows:

- Messages
- Internal Notes
- Activity Timeline

Internal notes render with explicit text stating they are internal-only and not visible to the customer. A separate composer is used for internal notes so users do not accidentally send internal context as a customer reply.

## Migration

Migration file: `prisma/migrations/20260817061526_add_internal_notes`

SQL summary:

- `ALTER TYPE "TicketActivityType" ADD VALUE 'INTERNAL_NOTE_CREATED'`
- create `InternalNote` table
- create indexes on `InternalNote`
- add foreign keys from `InternalNote` to `Ticket` and `User`

Old migrations were not modified.

## Message isolation

`Message` behavior is unchanged. The `/api/tickets/[id]/messages` endpoint continues to return only `Message` records. `InternalNote` records never appear in message responses.

## Non-goals

- rich text
- markdown rendering
- mentions
- threaded notes
- reactions
- editing notes
- deleting notes
- note search
- note attachments
- customer notifications

## Test coverage

- internal notes service tests
- internal notes API tests
- message isolation regression tests

Regression checks validate that the message API does not touch internal note data.
