# Phase 6 — Task 4: Email Abstraction & Delivery

## Objective

Provide asynchronous email delivery through a provider-agnostic `sendEmail()` abstraction, so that domain services (ticket assignment, status changes, SLA alerts) can trigger emails without coupling to a specific provider, and without blocking the HTTP request path.

This task implements the **email job** that the outbox/worker infrastructure (Tasks 1–3) executes. It does **not** implement inbound email, campaigns, or a template CMS.

## Context

Phase 5 has in-app notifications (`Notification` model) but no email capability. The original RelayDesk blueprint explicitly called for a `sendEmail()` abstraction so provider choice remains outside application logic.

The codebase currently has:

- `Customer` model with optional `email` field
- `User` model with `email` (required, unique) — these are **agent/auth** emails, not customer emails
- `Notification` model for in-app notifications (synchronous, inside the domain transaction)
- Outbox + worker infrastructure (Tasks 1–3) for async job execution
- No email provider, no email job, no email abstraction

The key boundary: **Phase 6 must not invent a full customer authentication/channel model merely to force email functionality into scope.** Email recipients are limited to supported use cases — primarily agents (via `User.email`) where the domain already has a relationship.

## Dependencies

- **Task 1 (Redis & BullMQ Infrastructure)** — provides the queue transport.
- **Task 2 (Transactional Outbox Foundation)** — provides the durable async intent.
- **Task 3 (Worker Runtime & Outbox Dispatching)** — provides the handler registry and job execution.

## Scope

- Email provider interface (`EmailProvider` with `sendEmail(message): Promise<DeliveryResult>`).
- Initial provider implementation (Resend or SMTP, subject to environment).
- Typed email message schema (to, subject, body, optional reply-to).
- Async email job handler registered in the worker.
- Provider configuration via environment variables.
- Development/test behavior (no-op provider or captured emails).
- Error classification (retryable vs non-retryable).
- Initial supported email events aligned with existing Phase 5 domain behavior.

## Non-Goals

- Email template CMS or visual editor.
- Marketing email or email campaigns.
- Inbound email-to-ticket processing.
- Email threading engine.
- Notification preference center.
- Customer portal or customer authentication redesign.
- Full email tracking (opens, clicks).

## Current Codebase Integration

The integration surface:

- `src/lib/email/` — new directory for email abstraction.
- `src/lib/email/types.ts` — email message and result types.
- `src/lib/email/provider.ts` — `EmailProvider` interface.
- `src/lib/email/providers/` — provider implementations (resend, smtp, noop).
- `src/lib/email/send-email.ts` — `sendEmail()` function used by handlers.
- `src/lib/queue/handlers/email.ts` — email job handler registered in the worker.
- `src/lib/env.ts` — extend with email provider env vars.
- `package.json` — add email provider SDK (e.g., `resend` or `nodemailer`).

The existing `Notification` creation path is **not** replaced. In-app notifications remain; email is an additional async channel.

## Architecture

### Provider interface

```typescript
interface EmailMessage {
  to: string;
  subject: string;
  body: string;
  replyTo?: string;
}

interface DeliveryResult {
  providerMessageId: string;
}

interface EmailProvider {
  sendEmail(message: EmailMessage): Promise<DeliveryResult>;
}
```

Application/domain code depends on `sendEmail(message)` and **never** instantiates a provider directly.

### Provider implementations

| Environment | Provider | Behavior |
|-------------|----------|----------|
| Production | Resend (or SMTP) | Sends real emails |
| Development | No-op (logs) | Logs email content, does not send |
| Test | No-op (captured) | Stores emails in memory for assertions |

The provider is selected at startup based on `NODE_ENV` and the presence of provider API keys.

### Email job handler

```typescript
async function handleEmailJob(payload: JobPayload): Promise<void> {
  const { to, subject, body } = payload.payload;
  const result = await sendEmail({ to, subject, body });
  // Idempotency: outbox event ID is the idempotency key (Task 5)
  return;
}
```

The handler is registered in the worker's handler registry (Task 3) under an appropriate `eventType` (e.g., `SEND_EMAIL`).

### Initial email events

Based on existing Phase 5 domain behavior, the initial supported events are:

| Event | Recipient | Trigger |
|-------|-----------|---------|
| Ticket assigned | Assignee (`User.email`) | `assignTicket` mutation |
| Ticket status changed | Assignee (`User.email`) | `updateTicket` status change |
| Ticket resolved | Assignee (`User.email`) | `closeTicket` / resolve mutation |

These are the events where the domain already has a clear recipient (the assigned agent) and a clear trigger. Customer-facing email is **not** included because the current customer model does not support a reliable external communication identity.

### Email content

Initial emails are plain text with a simple template:

```
Subject: [RelayDesk] Ticket assigned: {ticketTitle}
Body: Ticket #{ticketId} has been assigned to you.
```

No template engine, no HTML templates, no localization. These can be improved in future phases.

## Data Model / Schema Changes

None. This task introduces no database schema changes. Email delivery is a side effect of existing domain events.

## Runtime / Application Changes

| Area | Change |
|------|--------|
| `src/lib/email/types.ts` | New — email message and result types |
| `src/lib/email/provider.ts` | New — `EmailProvider` interface |
| `src/lib/email/providers/resend.ts` | New — Resend provider (or SMTP) |
| `src/lib/email/providers/noop.ts` | New — no-op provider for dev/test |
| `src/lib/email/send-email.ts` | New — `sendEmail()` function |
| `src/lib/queue/handlers/email.ts` | New — email job handler |
| `src/lib/env.ts` | Extend with email env vars |
| `package.json` | Add email provider SDK |

## Error Handling

- **Retryable errors** (network timeout, rate limit, provider 5xx): the handler throws, and the outbox event is retried (Task 5).
- **Non-retryable errors** (invalid email address, authentication failure): the handler throws a typed error, and the outbox event is marked failed without retry (Task 5).
- **Provider not configured**: the no-op provider is used in development; in production, missing configuration fails fast at startup.

## Security / Authorization

- Email provider API keys live in `.env`, never in source control.
- Email addresses are resolved from the database (authoritative records), not from job payloads directly.
- Email bodies do not contain sensitive data (passwords, tokens).
- The no-op provider in development prevents accidental email sends during local testing.

## Testing Strategy

- **Unit tests**:
  - `sendEmail()` calls the configured provider.
  - No-op provider stores emails in memory for assertions.
  - Provider selection logic chooses the correct provider based on env.
- **Integration tests**:
  - Email job handler sends an email via the no-op provider.
  - Email job handler retries on retryable errors (simulated).
  - Email job handler marks outbox event failed on non-retryable errors (simulated).
- **Regression tests**: All existing Phase 5 tests pass.

Tests use the existing Vitest + test database setup. The no-op provider is used in tests.

## Acceptance Criteria

1. `sendEmail(message)` sends an email via the configured provider.
2. In development/test, the no-op provider is used and emails are captured (not sent).
3. In production, the configured provider (Resend or SMTP) is used.
4. The email job handler is registered in the worker and executes when an `SEND_EMAIL` job is dispatched.
5. On success, the outbox event is marked complete.
6. On retryable error, the outbox event's `attempts` is incremented and the event remains pending.
7. On non-retryable error, the outbox event is marked failed (no retry).
8. Missing email configuration in production fails fast at startup.
9. All existing Phase 5 tests pass.

## Definition of Done

- All acceptance criteria above are demonstrably true.
- Email provider interface and at least one implementation exist.
- Email job handler is registered and functional.
- No-op provider is used in development/test.
- All existing tests pass.
- Branch and commit are clean; no unrelated changes.

## Files / Areas Expected to Change

```
src/lib/email/types.ts              (new)
src/lib/email/provider.ts           (new)
src/lib/email/providers/resend.ts   (new)
src/lib/email/providers/noop.ts     (new)
src/lib/email/send-email.ts         (new)
src/lib/queue/handlers/email.ts     (new)
src/lib/env.ts                      (extend)
package.json                        (add email SDK)
```

## Implementation Notes

- Choose the initial provider based on environment and implementation constraints. Resend is recommended for simplicity; SMTP is an alternative if the project has existing SMTP infrastructure.
- The `EmailProvider` interface is intentionally minimal — just `sendEmail()`. Do not add `sendBulk()`, `getStatus()`, or other methods unless a concrete use case requires them.
- The no-op provider should store emails in a way that's easy to assert against in tests (e.g., an in-memory array exposed via a getter).
- Do **not** implement email templates, HTML formatting, or localization in this task. Plain text is sufficient for the initial implementation.
- Do **not** implement customer-facing email. The current customer model does not support a reliable external communication identity. Agent-facing email is the only supported use case.
- The email job handler should be idempotent — if the same outbox event is processed twice, the email should not be sent twice. Task 5 implements the idempotency mechanism; this task just ensures the handler is compatible with it.
