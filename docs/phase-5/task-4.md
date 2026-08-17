# Phase 5 — Task 4: SLA Monitoring

## Status

Planning

## Objective

Convert the Phase 4 SLA foundation into operational monitoring states that agents can act on.

Task 4 must reuse existing SLA calculations and expose:

```text
Response SLA
Resolution SLA
```

with derived monitoring states:

```text
On Track
At Risk
Breached
Completed
Not Applicable
```

## Design Decisions

### SLA States

Use the following domain states:

```text
on_track
at_risk
breached
completed
not_applicable
```

The existing `SlaStatus = pending | completed | overdue` is preserved for backward compatibility. New monitoring state is derived on top of it.

### At Risk Threshold

Default threshold:

```text
AT_RISK_THRESHOLD_RATIO = 0.8
```

At Risk is defined as:

```text
elapsed >= 80% of total SLA duration
```

This value is a fixed domain constant. It is not configurable via workspace settings in this task.

### Boundary Handling

* completion exactly at deadline → `completed`
* completion after deadline → `breached`
* no deadline or missing created time → `not_applicable`

### Remaining Time

Domain layer provides:

```text
getSlaRemainingMsFromNow(deadline, now)
getElapsedRatio(deadline, createdAt, now)
isSlaOverdue(deadline, completedAt, now)
```

Formatting for human-readable strings is implemented in the UI/presentation layer, not in the domain layer.

## Domain Layer

All SLA monitoring logic lives in:

```text
src/lib/tickets/sla.ts
```

Reuse existing functions:

```text
getResponseSlaStatus()
getResolutionSlaStatus()
```

Do not duplicate business rules between domain helpers and database queries.

## Ticket Detail

Ticket detail must show:

```text
Response SLA
<status badge>
<description/remaining>

Resolution SLA
<status badge>
<description/remaining>
```

Status is not a single combined SLA state. Response and resolution SLA must remain independent.

## Ticket List

Ticket list must show compact SLA visibility:

```text
Response SLA: <status badge>
Resolution SLA: <status badge>
```

Do not create a separate SLA dashboard.

## SLA Filtering

SLA filtering is intentionally not implemented in Task 4.

Reason:

* Adding server-side SLA filtering would require duplicating derived monitoring logic in query construction.
* That would violate the single source of truth requirement and the instruction not to duplicate business rules.

If Task 5 My Queue needs SLA-based categories, it should derive them from the same domain helpers rather than introducing a database-level filter.

## Database / Migration

No new migration is introduced.

Existing fields remain sufficient:

```text
responseSlaDeadline
resolutionSlaDeadline
firstResponseAt
resolvedAt
createdAt
```

Do not add Prisma enums for derived SLA state.

## Authorization

Reuse existing workspace/membership authorization.

No new authorization mechanism is introduced.

## Activity / Audit

SLA monitoring is derived state, not event mutation.

Do not create `TicketActivity` for SLA status changes caused by UI reads.

Do not introduce background jobs or schedulers.

## Testing

Unit tests must cover:

### Response SLA

* no deadline / missing created time → `not_applicable`
* completed before deadline
* completed exactly at deadline
* completed after deadline → `breached`
* deadline passed without response → `breached`
* before threshold → `on_track`
* exactly at threshold → `at_risk`
* after threshold → `at_risk`

### Resolution SLA

Equivalent cases to response SLA.

### Remaining Time

* positive remaining time
* zero at deadline
* negative overdue value
* null missing deadline

Use fixed `now` values in tests. Do not depend on wall-clock time.

## Integration / API Tests

Verify:

* ticket detail renders SLA status correctly
* ticket list renders compact SLA badges correctly
* workspace isolation remains intact
* existing ticket API behavior does not regress
* existing priority/SLA deadline calculations remain intact

## Documentation

This document records:

* monitoring state semantics
* at-risk threshold
* response vs resolution distinction
* derived-state behavior
* deliberate non-implementation of SLA filtering

## Non-Goals

Do not implement:

* configurable SLA policy editor
* multiple SLA engines
* business-hours calendar
* holiday calendar
* automated escalation
* email alerts
* push notifications
* background SLA calculator
* Redis/cache layer
* SLA reporting dashboard
* SLA BI
