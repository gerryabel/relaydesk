# Phase 5 — Task 6: In-App Notifications

## Task Objective
Add a simple in-app notification system so agents can see important ticket events without staying inside a ticket page.

## Notification Model
New Prisma model: `Notification`

Fields:
- `id`
- `userId`
- `workspaceId`
- `ticketId` nullable
- `type`
- `title`
- `body`
- `readAt` nullable
- `createdAt`
- `updatedAt`

Read state uses `readAt: DateTime?`.
- `null` = unread
- non-null = read

Relations:
- `user` -> `User` with `onDelete: Cascade`
- `workspace` -> `Workspace` with `onDelete: Cascade`
- `ticket` -> `Ticket` nullable with `onDelete: SetNull`

Indexes:
- `[userId, readAt, createdAt]`
- `[workspaceId, createdAt]`
- `[ticketId]`

## Supported Event Matrix

| Event | Status |
|------|--------|
| `TICKET_ASSIGNED` | Implemented |
| `TICKET_STATUS_CHANGED` | Implemented |
| `CUSTOMER_REPLY` | Deferred |
| `SLA_AT_RISK` | Deferred |

## Deferred Events

### Customer Reply
Deferred because the existing `Message.createdById` is a `User`, and the current `Customer` entity does not have authentication or a customer actor model. We do not treat every `Message` as a customer reply.

### SLA At Risk
Deferred because Task 4 SLA monitoring is derived from current time, and Phase 5 has no background scheduler/job infrastructure. We do not fake scheduler, polling, or cron only for notifications.

## Authorization Model
All notification queries are scoped to the current membership:
- `userId = currentMembership.userId`
- `workspaceId = currentMembership.workspaceId`

Related ticket navigation is only exposed when the ticket belongs to the same workspace.

### List Authorization
Users only see their own notifications in their current workspace.

### Mark-As-Read Authorization
The notification must be resolved by `id`, `userId`, and `workspaceId` before updating `readAt`.

### Related Ticket Authorization
Ticket navigation metadata is only included when the ticket is in the same workspace.

## Transaction Guarantees
Notification creation participates in the same transaction as the ticket mutation.

Assignment mutation:
```
transaction:
  update ticket
  write TicketActivity
  create Notification
```

Status change mutation:
```
transaction:
  update ticket
  write TicketActivity
  create Notification
```

If notification creation fails, the ticket mutation rolls back.

### Self-Notification
If actor == recipient, no notification is created.

### No-Op Behavior
- identical assignment -> no notification
- unchanged status -> no notification

## Unread/Read Semantics
- `readAt = null` -> unread
- `readAt` set to current time on read

## API Surface
- `GET /api/notifications`
- `GET /api/notifications/unread-count`
- `PATCH /api/notifications/[id]/read`

## UI Behavior
- `/dashboard/notifications` page is the notification list surface.
- Dashboard/navigation exposes unread count badge.
- Notification entries show title, body, timestamp, unread/read state, and related ticket navigation.
- Clicking a notification marks it as read and preserves navigation to the related ticket.

## Retention Behavior
No automatic cleanup is implemented in Task 6. Notifications remain stored unless a future explicit policy is added.

## Migration Details
- New migration: `20260817045802_add_notifications`
- Only introduces `NotificationType` enum, `Notification` model, and required indexes/relations.

### Migration scope note
Inspected migration history before finalizing Task 6. The notification migration also includes a `Ticket.assignedToId` index adjustment. That adjustment originates from schema/index evolution starting in `20260810000000_add_ticket_assignee`, not from Task 6 schema changes. It was detected during Task 6 migration generation and is documented here instead of being silently hidden or moved into older migrations.

## Non-Goals
- No customer reply notifications
- No SLA at-risk notifications
- No email/push/SMS/WebSocket
- No preferences, rules, filters, digests, or scheduler

## Testing Strategy
Service tests:
- create `TICKET_ASSIGNED` and `TICKET_STATUS_CHANGED` notifications
- no-op/self-notification guards
- mark as read / idempotency
- failure/atomicity cases: missing assignee membership, missing ticket, transaction rollback behavior

Authorization tests:
- cross-user visibility blocked
- cross-workspace visibility blocked
- mark-as-read authorization enforced
- related ticket leakage prevented

Event integration tests:
- assignment change creates one notification for the new assignee
- status change notifies current assignee only
- self-status change does not notify
- transaction helper is called inside ticket mutation

API tests:
- list notifications
- unread count
- mark as read
- unauthorized and forbidden access behavior

Regression:
- all existing Phase 2-5 tests continue to pass
