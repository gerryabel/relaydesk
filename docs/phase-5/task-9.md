# Phase 5 — Task 9: Attachments

## Purpose

Attachments allow customers and agents to associate files with ticket communication. The implementation attaches files to the `Message` entity, not to the `Ticket` directly, preserving the communication-attachment domain relationship:

```
Ticket
  └── Message
        └── Attachment
```

This is intentional: attachments are communication artifacts, not generic ticket files. The `Message` already provides the ownership/audit semantics (`createdById`), so the full authorization chain is:

```
User
→ Membership
→ Workspace
→ Ticket
→ Message
→ Attachment
```

## Entity

`Attachment` is a new Prisma model.

Fields:

- `id`
- `messageId`
- `originalFilename`
- `mimeType`
- `sizeBytes`
- `storageKey`
- `createdAt`

Relations:

- `Attachment.message` — many-to-one, `onDelete: Cascade`
- `Message.attachments` — one-to-many (added to existing `Message` model)

Indexes:

- `Attachment_messageId_idx` on `Attachment.messageId`
- `Attachment_storageKey_key` unique constraint on `Attachment.storageKey`

The `Message` model already has `Ticket` and `User` relations, so no additional owner reference was needed on `Attachment`.

## Authorization

Workspace membership is required for all attachment operations. The current workspace is resolved from the authenticated session via `getCurrentMembership()`; client-supplied workspace IDs are never trusted.

For **upload**, the service verifies the target `Message` belongs to a `Ticket` in the current workspace. Cross-workspace uploads are rejected.

For **list**, the service verifies the target `Message` belongs to a `Ticket` in the current workspace before returning attachments.

For **download**, the service resolves the `Attachment` by `id`, then walks `Attachment → Message → Ticket` to verify workspace membership. A user who is not a member of the attachment's workspace gets a 404 (not 403), avoiding information leakage about attachment existence.

For **delete**, the same workspace verification applies. Cross-workspace deletion is blocked.

## Storage

`StorageProvider` is a minimal interface:

```ts
export interface StorageProvider {
  put(key: string, data: Buffer): Promise<void>;
  get(key: string): Promise<Buffer>;
  delete(key: string): Promise<void>;
  exists(key: string): Promise<boolean>;
}
```

`LocalStorageProvider` is the default implementation:

- stores files under a configurable directory (default: `./storage/attachments`)
- resolves storage keys relative to the root
- rejects path traversal attempts (`../`, absolute paths)
- creates parent directories as needed
- does not use client filenames as storage paths

Storage keys are application-generated:

```
attachments/<uuid>
```

The original filename is preserved only as metadata in `Attachment.originalFilename`.

Configuration:

- `ATTACHMENT_STORAGE_ROOT` — environment variable for custom storage directory (optional)
- default location: `./storage/attachments` (relative to `process.cwd()`)

The domain model is not coupled to any storage provider. The `StorageProvider` interface allows swapping the local adapter for an object-storage adapter without touching `AttachmentService`.

## Validation

Centralized in `src/lib/attachments/config.ts` and `src/lib/attachments/schema.ts`.

Schema validation (`uploadAttachmentSchema`):

- `filename` — required, trimmed, 1-255 characters
- `mimeType` — required, trimmed, 1-255 characters
- `sizeBytes` — required, positive integer (> 0)

Service-level validation:

- file buffer must not be empty
- `sizeBytes` must not exceed `maxFileSizeBytes`
- `mimeType` must be in the allowed list

Configuration:

- `maxFileSizeBytes`: `10 * 1024 * 1024` (10 MB)
- `allowedMimeTypes` (explicit allowlist):
  - `image/png`
  - `image/jpeg`
  - `image/gif`
  - `image/webp`
  - `application/pdf`
  - `application/msword`
  - `application/vnd.openxmlformats-officedocument.wordprocessingml.document`
  - `application/vnd.ms-excel`
  - `application/vnd.openxmlformats-officedocument.spreadsheetml.sheet`
  - `text/plain`
  - `text/csv`
  - `application/zip`

`*/*` is not used. MIME types are explicit.

## API

### `POST /api/messages/[id]/attachments`

Upload a file to a message. Uses `multipart/form-data` with a `file` field.

### `GET /api/messages/[id]/attachments`

List attachments for a message. Returns attachment metadata (no storage keys, no file contents).

### `GET /api/attachments/[id]`

Download an attachment. Returns raw file bytes with `Content-Type` from stored metadata and `Content-Disposition: attachment`.

### `DELETE /api/attachments/[id]`

Delete an attachment. Removes both database metadata and stored file.

## Transaction Behavior

### Upload

1. validate input schema
2. validate file buffer is not empty
3. validate file size against config
4. validate MIME type against allowlist
5. resolve current membership
6. load target message, verify workspace
7. generate opaque storage key
8. write file to storage (`storage.put`)
9. inside a Prisma transaction:
   - create `Attachment` metadata
   - create `TicketActivity` with type `ATTACHMENT_ADDED`
10. if the transaction fails, attempt storage cleanup (`storage.delete`)

Storage and database are **not** atomic. If storage write succeeds but DB insert fails, the implementation attempts best-effort cleanup of the stored file. If cleanup fails, the error is logged but not propagated.

### Delete

1. resolve current membership
2. load attachment by `id`
3. walk `Attachment → Message → Ticket` to verify workspace
4. inside a Prisma transaction:
   - delete `Attachment` metadata
   - create `TicketActivity` with type `ATTACHMENT_REMOVED`
5. attempt storage cleanup (`storage.delete`)

If the transaction fails, no storage cleanup is attempted and the error is returned.

If the transaction succeeds but storage cleanup fails, the error is logged. The database state is consistent; the orphaned file remains on disk. There is no background cleanup infrastructure in scope.

## Activity Integration

Two new `TicketActivityType` values:

- `ATTACHMENT_ADDED`
- `ATTACHMENT_REMOVED`

Both are added to the Postgres enum via migration.

Activity metadata includes:

- `attachmentId`
- `filename` (original filename)

Actor is always the current membership user. Activities are created transactionally with attachment metadata changes.

## UI / Ticket detail

The message composer on `/dashboard/tickets/[id]` includes a file input for optional attachments. Files are uploaded after message creation via a separate `POST /api/messages/[id]/attachments` request.

Message display shows attachment chips with:

- filename (truncated)
- file size
- download link (triggers browser download)
- delete button (with confirmation dialog)

Loading, empty, and error states are handled. The file input is hidden visually but accessible via a styled label. File size validation happens client-side before upload.

## Migration

Migration file: `prisma/migrations/20260817164003_add_attachments`

SQL summary:

- `ALTER TYPE "TicketActivityType" ADD VALUE 'ATTACHMENT_ADDED'`
- `ALTER TYPE "TicketActivityType" ADD VALUE 'ATTACHMENT_REMOVED'`
- create `Attachment` table
- create index `Attachment_messageId_idx`
- create unique index `Attachment_storageKey_key`
- add foreign key from `Attachment.messageId` to `Message.id`

Historical migrations were not modified.

## Test Coverage

- `src/__tests__/attachments.validation.test.ts` — schema validation and config verification
- `src/__tests__/attachments.service.test.ts` — service behavior:
  - upload validation (empty, oversized, unsupported MIME)
  - workspace isolation (cross-workspace message rejection)
  - storage failure handling
  - DB failure cleanup
  - download and delete operations
- `src/__tests__/attachments.api.test.ts` — API behavior:
  - authorization (401/403)
  - workspace isolation (404 for cross-workspace)
  - upload success/failure
  - download success/failure
  - delete success/failure

All 417 tests across 38 test files pass.

## Non-goals

- image processing
- video processing
- document preview engine
- virus scanning
- object-storage administration
- customer file portal
- advanced file versioning
- Redis
- background jobs
- WebSocket/realtime infrastructure
- email/SMS/push infrastructure
