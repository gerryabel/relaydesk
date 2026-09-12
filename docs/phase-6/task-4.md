# Phase 6 — Task 4: Email Provider Abstraction & Delivery

## Objective

Provide asynchronous email delivery without coupling business logic to a specific email provider.

Email sending is routed through the existing outbox → BullMQ → worker path, and uses a small provider-independent contract so the implementation can switch providers without changing domain logic.

## Architecture

```text
OutboxEvent
  ↓
Task 3 dispatcher
  ↓
BullMQ job
  ↓
Worker
  ↓
Email handler
  ↓
EmailProvider abstraction
  ↓
Concrete provider (Resend / console)
```

## Provider Boundary

Business logic depends on:

- `EmailMessage`
- `EmailDeliveryResult`
- `sendEmail(config, message)`

No ticket, notification, or worker handler imports provider-specific client types directly.

## Selected Provider

Resend is implemented as the production provider.

Reason:

- HTTP-only integration, no SMTP infrastructure required.
- Fits the repository's current deployment constraints.
- Easy to test with deterministic HTTP mocks.

`console` is used for local development and tests.

## Email Event Matrix

| Event | Recipient source | Subject/body source | Outbox event type | Supported |
| --- | --- | --- | --- | --- |
| Ticket assigned | `User.email` resolved by `assigneeId` from outbox payload | Ticket title + ticket/assignee IDs | `TICKET_ASSIGNED` | Yes |

Unsupported events and why:

- `TICKET_CREATED` — no explicit customer-facing or assignee email identity requirement in the current Task 4 scope.
- `TICKET_REPLIED` — no customer email identity is guaranteed in the current domain model.
- `TICKET_RESOLVED` — not required by the Task 4 event matrix and would duplicate in-app notification behavior.
- `SLA_AT_RISK` — owned by Task 6.

The worker ignores unsupported email events with a permanent failure classification rather than inventing recipients.

## Error Classification

| Classification | Meaning | Examples |
| --- | --- | --- |
| `success` | Provider accepted the message | Resend returns 2xx |
| `retryable_failure` | Temporary failure safe to retry | Provider outage, network timeout, rate limiting |
| `permanent_failure` | Do not retry as-is | Invalid recipient, invalid configuration, malformed message |
| `invalid_message` | Payload or config is invalid before provider call | Missing fields, bad `EMAIL_FROM`, missing `RESEND_API_KEY` |

Retry policy/backoff/max attempts remain deferred to Task 5.

## Development/Test Mode

Tests use:

- mocked provider HTTP calls for Resend tests
- `console` provider default so no real email is sent in development
- deterministic assertions on recipient, subject, and body

Never commit `RESEND_API_KEY` or production credentials.

## Environment

| Variable | Purpose |
| --- | --- |
| `EMAIL_PROVIDER` | `resend` or `console` |
| `EMAIL_FROM` | Sender identity used by the provider |
| `RESEND_API_KEY` | Required only when `EMAIL_PROVIDER=resend` |

## Failure Behavior

| Failure mode | Behavior |
| --- | --- |
| Provider unavailable | Provider result is classified as retryable failure; worker records failure and leaves outbox event pending for retry |
| Provider rejects message | Classified as permanent or retryable based on provider response; Task 5 decides whether to dead-letter or retry |
| Invalid configuration | Returns permanent failure without calling provider when required config is missing |
| Worker restarts | BullMQ re-queues in-flight jobs; outbox event remains claimed/retryable via existing Task 3 recovery path |
| Job execution fails | Outbox event `attempts` is incremented and `lastError` is set; event is not marked processed |

## Limitations

- Only `TICKET_ASSIGNED` email events are implemented.
- No inbound email, threading, reply parsing, or customer authentication.
- No full retry strategy, backoff, or idempotency framework in this task.
- No exactly-once delivery guarantees.
