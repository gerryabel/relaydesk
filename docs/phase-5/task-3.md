# Phase 5 — Task 3: Tags / Labels

## Status

Planning

## Objective

Define the complete implementation contract for the Tags / Labels feature.

Task 3 must give RelayDesk a mechanism to classify tickets outside of status,
priority, assignment, and workflow state.

## Scope

Task 3 covers one full vertical slice:

1. Tag domain/entity.
2. Workspace-scoped tag management.
3. Ticket ↔ Tag relationship.
4. Add/remove tag from ticket.
5. Tag display on ticket detail.
6. Tag filtering on existing ticket listing/query infrastructure.
7. Activity/audit logging for tag changes.
8. Unit/service tests.
9. API/integration tests.
10. UI behavior and accessibility/responsive requirements.

Do not include out-of-scope features.

## Explicit Non-Goals

Do not implement or design as part of Task 3:

* hierarchical tags
* tag automation
* tag-based workflow rules
* AI-generated tags
* advanced taxonomy management
* bulk ticket tag operations
* tag-based automation
* saved tag views
* advanced taxonomy administration

Bulk ticket actions are a separate Phase 5 feature area.

---

# Design Decisions — MUST preserve

## Tag Model

Use the concept:

```prisma
model Tag {
  id          String
  workspaceId String
  name        String
  createdAt   DateTime
  updatedAt   DateTime

  workspace Workspace
  tickets   TicketTag[]
}
```

Required documented details:

* tag is always scoped to a workspace
* `name` is required
* trim whitespace
* `name` length: `1–50` characters
* whitespace-only values are invalid
* tag name is unique per workspace, case-insensitive
* do not add `slug` for Task 3
* do not add `normalizedName` or extra fields unless the implementation absolutely requires them and that decision has been reviewed first

## TicketTag Model

Use the concept:

```prisma
model TicketTag {
  ticketId String
  tagId    String

  ticket Ticket
  tag    Tag
}
```

Constraint:

```text
(ticketId, tagId)
```

must be unique / serve as the composite primary key so the same tag cannot be
attached twice to the same ticket.

Indexes and foreign-key behavior must be documented.

## Delete Behavior

Tag delete is a hard delete.

Behavior:

```text
Delete Tag
    ↓
TicketTag associations deleted
    ↓
Ticket remains intact
```

Tickets must not be deleted.

Association cleanup may use database cascade.

Do not introduce soft delete because Task 3 scope does not require it.

---

# API Contract

Document the following contract as proposed implementation contract:

## Tag Management

```text
GET    /api/tags
POST   /api/tags
PATCH  /api/tags/[id]
DELETE /api/tags/[id]
```

Expected behavior:

* GET returns only tags from the active workspace
* GET results are ordered by `name ASC`
* POST creates a tag in the current workspace
* PATCH performs a rename
* DELETE removes the tag and associated `TicketTag` records
* all operations are workspace-scoped

Duplicate case-insensitive tag names must be rejected.

## Ticket Tags

```text
GET    /api/tickets/[id]/tags
POST   /api/tickets/[id]/tags
DELETE /api/tickets/[id]/tags/[tagId]
```

Expected behavior:

* GET returns the ticket's tags
* POST adds one tag to the ticket
* DELETE removes one tag from the ticket
* ticket and tag must belong to the same workspace
* duplicate attachment is not allowed
* cross-workspace operations must be rejected

Do not create a bulk tag-assignment API.

---

# Service / Domain Contract

Preserve the pattern:

```text
UI → API → validation → service/domain → Prisma
```

Proposed service operations:

```text
createTag()
getTags()
getTagById()
updateTag()
deleteTag()
getTicketTags()
addTagToTicket()
removeTagFromTicket()
```

Domain rules must live in the service/domain layer, not only in the UI.

Proposed domain errors:

```text
TagNotFoundError
DuplicateTagError
TagNotInWorkspaceError
TicketNotInWorkspaceError
TicketTagAlreadyExistsError
TicketTagNotFoundError
```

Final naming may align with existing error conventions, but behavior must remain the same.

---

# Authorization

All operations must use the existing workspace/membership authorization model.

Must reject:

```text
Ticket in workspace A
+
Tag in workspace B
```

No indirect cross-workspace access is allowed.

Document:

* unauthenticated behavior
* missing membership behavior
* not-found behavior
* cross-workspace behavior
* duplicate/conflict behavior

Use HTTP status semantics consistent with existing RelayDesk API behavior.

---

# Validation

Create a validation contract for:

```text
name
```

Rules:

* required on create
* optional/partial on update
* trim whitespace
* 1–50 characters
* whitespace-only values are invalid
* case-insensitive uniqueness must be enforced at the service/database boundary

Do not rely on client/UI validation alone for uniqueness.

---

# Activity / Audit

Task 3 must preserve the existing `TicketActivity` architecture.

Proposed activity events:

```text
TAG_ADDED
TAG_REMOVED
```

Behavior:

```text
addTagToTicket()
    → TicketTag created
    → TicketActivity TAG_ADDED
```

```text
removeTagFromTicket()
    → TicketTag deleted
    → TicketActivity TAG_REMOVED
```

Operations requiring atomicity must use transactions.

Activity metadata must follow the capabilities of the existing `TicketActivity` implementation. Do not create new metadata structures without justification.

Do not change existing activity event semantics outside Task 3 scope.

---

# Ticket Filtering

Task 3 must reuse existing ticket search/filter/sort/pagination infrastructure.

Do not create a second query subsystem.

Add tag filtering to the existing ticket query.

Use:

```text
tagIds
```

as the proposed filter input.

## Multi-tag semantics

Multiple selected tags use OR:

```text
tagIds = [billing, vip]
```

means:

```text
tag = billing OR tag = vip
```

## Cross-filter semantics

Different filter types use AND:

```text
status=open
AND
priority=high
AND
(tag=billing OR tag=vip)
```

## No tag filter

If `tagIds` is not provided:

```text
existing ticket query behavior remains unchanged
```

## Pagination

Tag filtering must happen in the database/query layer and remain compatible with existing pagination.

Do not fetch all tickets and filter in application memory.

Do not add an explicit “match any/match all” mode in Task 3.

Do not implement a “tickets without tags” filter unless it already exists in the repository and can be reused without expanding scope.

---

# UI Scope

Task 3 covers:

## Ticket Detail

Include a Tags area that supports:

* viewing tags
* adding a tag
* removing a tag

## Ticket List / Dashboard

Add a tag filter to the existing ticket filtering UI.

Multiple tag selection uses OR semantics.

## Tag Management

Provide a management surface following existing dashboard/settings UI conventions for:

* listing tags
* creating a tag
* renaming a tag
* deleting a tag

Do not build a large admin system.

## UI Quality Requirements

Required:

* loading state
* empty state
* error state
* mutation feedback
* accessible names
* keyboard accessibility
* visible focus state
* responsive behavior
* destructive-action confirmation for tag deletion

---

# Database / Migration Boundary

Task 3 has one primary migration boundary covering:

* Tag table
* TicketTag table
* Workspace → Tag relation
* Ticket → TicketTag relation
* required indexes
* unique constraints
* foreign keys
* cascade behavior

The migration must preserve existing migration history and follow the repository's migration ordering.

Do not create separate migrations for logically grouped Task 3 schema changes unless Prisma/repository tooling explicitly requires it.

---

# Testing Strategy

## Unit / Service

Cover:

* create tag
* trim input
* reject empty name
* reject names longer than 50 characters
* case-insensitive duplicate detection
* list workspace tags
* rename tag
* delete tag
* workspace isolation
* add tag to ticket
* remove tag from ticket
* duplicate attachment
* cross-workspace ticket/tag access
* transaction behavior
* activity logging

## API / Integration

Cover:

* unauthenticated requests
* missing membership
* successful CRUD
* invalid payload
* duplicate tag conflict
* cross-workspace access
* ticket tag attach/remove
* ticket tag authorization

## Filtering

Cover:

* no tag filter
* one tag
* multiple tags = OR
* tag filter + status = AND
* tag filter + priority = AND
* pagination correctness
* empty result

## Regression

All existing Phase 2–4 and current Phase 5 tests must continue passing.

Do not invent exact test filenames that have not yet been created.

---

# Acceptance Criteria

Task 3 implementation should later satisfy:

* Tag model implemented
* Tag workspace isolation
* Case-insensitive unique tag name per workspace
* TicketTag relationship implemented
* Duplicate relation prevented
* Tag CRUD implemented
* Ticket tag add/remove implemented
* Cross-workspace relations rejected
* TAG_ADDED activity
* TAG_REMOVED activity
* Transactional atomicity where required
* Existing ticket filtering reused
* Multiple tag filter uses OR
* Existing different filters remain AND-compatible
* Ticket detail displays tags
* Ticket list exposes tag filter
* Tag management UI exists
* Loading/empty/error states
* Accessibility
* Responsive behavior
* Tests added
* lint passes
* typecheck passes
* test passes
* build passes
* documentation updated
* commit created
* branch pushed
* independent verification completed

---

# Git Workflow

Task 3 must use a dedicated branch:

```text
phase-5/task-3-tags
```

Do not create integration branches unless a real dependency or integration requirement emerges.

Task 2 is complete and already documented; do not change Task 2 to suit Task 3 needs.

---

# Definition of Done

Follow the Phase 5 DoD pattern:

* separate task branch
* documentation
* architecture review
* UI/UX review
* accessibility review
* responsive review
* tests
* lint
* typecheck
* test
* build
* changes reviewed
* intentional commit
* pushed branch
* final independent verification

---

# Important Constraint

This document is **planning/implementation contract**, not a report that Task 3 has been implemented.

Status must remain:

```text
Planning
```

Do not mark acceptance criteria as complete.

After finishing:

```powershell
git status
git diff -- docs/phase-5/task-3.md
```

Confirm only `docs/phase-5/task-3.md` was created/changed.

**Do not commit. Do not push. Do not implement.**
