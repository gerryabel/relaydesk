# Phase 4 — Task 3: Priority & SLA

**Version:** 0.3.0-alpha
**Status:** Planned

---

## 1. Goal

Implement a consistent ticket priority and SLA foundation for RelayDesk.

This task introduces:

* Priority-aware SLA policies.
* Response SLA.
* Resolution SLA.
* Stable SLA deadline snapshots per ticket.
* SLA status representation in the ticket UI.
* Validation and business logic for SLA calculations.
* Tests covering priority and SLA behavior.

The implementation must remain simple enough for the current phase while providing a clean foundation for future SLA escalation, reporting, and notification capabilities.

---

## 2. Scope

### 2.1 Ticket Priority

Ticket priority remains represented by the existing priority model:

* `LOW`
* `MEDIUM`
* `HIGH`
* `URGENT`

Priority must:

* Be persisted on the ticket.
* Be validated through the existing ticket validation layer.
* Be changeable through the supported ticket workflow.
* Respect existing authentication and workspace-isolation rules.
* Be displayed consistently in the ticket UI.

---

### 2.2 SLA Policy

Each priority maps to a predefined SLA policy.

Each policy defines:

* Response SLA duration.
* Resolution SLA duration.

Conceptually:

```text
Priority
    ↓
SLA Policy
    ├── Response duration
    └── Resolution duration
```

The initial policies are application-defined rather than workspace-configurable.

| Priority | Response SLA | Resolution SLA |
| -------- | -----------: | -------------: |
| LOW      |     24 hours |         5 days |
| MEDIUM   |      8 hours |         3 days |
| HIGH     |      4 hours |          1 day |
| URGENT   |       1 hour |        4 hours |

These values are centralized in `src/lib/tickets/sla.ts` and should be treated as the single source of truth for Task 3.

The policy implementation must be isolated from UI and persistence logic so that future configurable SLA policies can be introduced without rewriting the core SLA calculation flow.

---

### 2.3 Response SLA

Response SLA represents the maximum allowed time before the ticket receives its first agent response.

The response SLA:

* Starts from the ticket's SLA start time.
* Has a calculated deadline.
* Is considered completed when the first qualifying agent response occurs.
* Must preserve the deadline that was established for the ticket.

The implementation must not depend on repeatedly recalculating the deadline from the current SLA policy.

---

### 2.4 Resolution SLA

Resolution SLA represents the maximum allowed time before the ticket is resolved.

The resolution SLA:

* Starts from the ticket's SLA start time.
* Has a calculated deadline.
* Is considered completed when the ticket reaches the resolved state.
* Must preserve the deadline established for the ticket.

---

## 3. Architectural Decisions

### 3.1 Fixed Policy, Extensible Domain Logic

SLA policies are fixed for the current implementation.

They must not be configurable per workspace in this task.

However, the SLA policy lookup and calculation logic must be isolated behind a domain-level abstraction so future configuration can be introduced without coupling SLA rules to UI or database code.

---

### 3.2 SLA Deadlines Are Snapshots

SLA deadlines must be persisted as ticket-specific values once established.

Conceptually:

```text
Ticket
├── priority
├── responseSlaDeadline
├── resolutionSlaDeadline
├── firstResponseAt
└── resolvedAt
```

The system must not continuously recalculate an existing ticket's deadline from the current SLA policy.

This preserves historical consistency when SLA policy definitions change in the future.

---

### 3.3 SLA Is Event/Lifecycle Based

SLA completion is determined by meaningful ticket lifecycle events rather than simply deriving behavior from the current ticket status.

Response SLA:

```text
started
   ↓
first qualifying agent response
   ↓
completed
```

Resolution SLA:

```text
started
   ↓
ticket resolved
   ↓
completed
```

---

### 3.4 `WAITING_CUSTOMER` Does Not Automatically Pause SLA

The `WAITING_CUSTOMER` workflow state introduced in Task 2 must not automatically pause, resume, or extend SLA timers in this task.

The SLA clock continues according to the defined SLA lifecycle.

More advanced SLA pause/resume semantics may be introduced later as part of the SLA/Escalation architecture.

---

### 3.5 No Automatic Escalation

Task 3 must not introduce:

* Automatic escalation.
* Background SLA workers.
* Cron-based escalation processing.
* Email notifications.
* Push notifications.
* Realtime SLA notifications.

Task 3 establishes the SLA foundation only.

---

## 4. SLA Lifecycle

For a newly created ticket:

```text
Ticket Created
      │
      ├── determine priority
      │
      ├── resolve SLA policy
      │
      ├── calculate response deadline
      │
      └── calculate resolution deadline
              │
              ▼
       SLA snapshot persisted
```

Response SLA:

```text
Pending
   │
   ├── agent first response
   │
   ▼
Completed
```

Resolution SLA:

```text
Pending
   │
   ├── ticket resolved
   │
   ▼
Completed
```

If a deadline passes before completion, the SLA becomes overdue.

---

## 5. SLA State

The application should be able to derive or represent at least these states:

* `PENDING`
* `COMPLETED`
* `OVERDUE`

An SLA is:

* `PENDING` when it has not yet been completed and its deadline has not passed.
* `COMPLETED` when the corresponding lifecycle event occurs before or at the deadline.
* `OVERDUE` when its deadline has passed without completion.

The exact implementation may derive these states rather than persisting them if doing so avoids redundant state.

---

## 6. Priority Changes

Changing a ticket's priority must not silently rewrite an already established SLA deadline.

Priority represents the current ticket priority.

The SLA snapshot represents the SLA commitment established for the ticket.

Therefore:

```text
Current Priority ≠ Historical SLA Policy Snapshot
```

If a future product requirement needs priority changes to trigger SLA recalculation, that behavior must be explicitly designed rather than emerging implicitly from the implementation.

For Task 3, existing SLA deadlines remain stable.

---

## 7. Data Model

The implementation should evaluate the existing `Ticket` model and add only the fields necessary to support the SLA contract.

Potential fields include:

```text
responseSlaDeadline
resolutionSlaDeadline
firstResponseAt
```

The implementation must verify whether existing ticket lifecycle fields can already provide equivalent information before introducing redundant columns.

The final schema should avoid storing values that can safely and deterministically be derived.

---

## 8. SLA Start Time

The implementation must define one canonical SLA start timestamp for the ticket.

Unless an existing domain requirement dictates otherwise, the default starting point should be the ticket creation time.

The start timestamp must be consistent for both:

* Response SLA.
* Resolution SLA.

Future business-hours SLA behavior is explicitly out of scope.

---

## 9. Business Hours

Task 3 uses simple elapsed-time durations.

SLA calculations must not yet account for:

* Business hours.
* Weekends.
* Holidays.
* Workspace-specific working hours.
* Time zones beyond the application's normal timestamp handling.

These capabilities can be introduced in a future SLA iteration.

---

## 10. Implementation Areas

The implementation should be reviewed against the existing architecture before modifying files.

Expected areas may include:

### Domain / SLA Logic

Potential new module:

```text
src/lib/tickets/sla.ts
```

Responsibilities may include:

* SLA policy definitions.
* Policy lookup by priority.
* Deadline calculation.
* SLA state calculation.

The final location should follow existing project conventions after architecture review.

### Ticket Service Layer

Potential changes to:

```text
src/lib/tickets/server.ts
```

Responsibilities may include:

* Creating SLA snapshots.
* Handling priority changes.
* Recording first response timing.
* Preserving workspace isolation.

### Validation

Potential changes to:

```text
src/lib/tickets/schema.ts
```

Only where additional validation is required.

### API / Server Actions

Existing ticket mutation patterns must be followed.

Potential areas:

```text
src/app/api/tickets/[id]/route.ts
src/lib/tickets/actions.ts
```

No duplicate business logic should be introduced between API routes and Server Actions.

### Ticket UI

Potential changes to:

```text
src/app/dashboard/tickets/[id]/page.tsx
```

The UI should communicate:

* Current priority.
* Response SLA status.
* Resolution SLA status.
* Relevant deadline information.

The UI must remain responsive and accessible.

---

## 11. UI Requirements

Priority must have a clear visual representation that does not rely exclusively on color.

SLA information should communicate:

* Current SLA state.
* Deadline or remaining time where appropriate.
* Completed state when applicable.
* Overdue state when applicable.

Accessibility requirements:

* Status must be understandable without color alone.
* Interactive controls must have accessible labels.
* Focus states must remain visible.
* Time/deadline information must be readable at responsive breakpoints.

Realtime countdown behavior is not required.

The displayed SLA state may be calculated from the current server timestamp when the page is rendered or refreshed.

---

## 12. API / Service Behavior

All ticket operations must continue to enforce:

* Authentication.
* Workspace membership.
* Ticket workspace isolation.
* Existing authorization rules.

SLA fields must not be directly client-controlled.

The server must determine:

* SLA policy.
* SLA durations.
* SLA deadlines.
* Lifecycle timestamps.

Clients may request ticket mutations, but SLA calculations must remain server-side.

---

## 13. Testing Requirements

Tests must cover at minimum:

### SLA Policy

* Every supported priority resolves to an SLA policy.
* Each policy contains response and resolution durations.
* Unknown/invalid priority cannot produce an SLA policy.

### Deadline Calculation

* Response deadline is calculated correctly.
* Resolution deadline is calculated correctly.
* Calculations use the canonical SLA start timestamp.
* Existing deadlines remain stable after policy changes.

### SLA State

* Pending SLA is identified correctly.
* Completed SLA is identified correctly.
* Overdue SLA is identified correctly.
* Completion at the exact deadline is handled deterministically.

### Ticket Lifecycle

* First qualifying agent response completes response SLA.
* Resolution completes resolution SLA.
* Customer messages do not incorrectly complete response SLA.
* `WAITING_CUSTOMER` does not automatically pause SLA.

### Priority

* Priority can be changed through the supported workflow.
* Priority changes do not silently mutate existing SLA deadlines.

### Security / Isolation

* Users cannot mutate tickets outside their workspace.
* SLA data cannot be forged through client input.

### Regression

Existing ticket workflow, assignment, search, filter, sorting, pagination, authentication, and workspace-isolation tests must continue to pass.

---

## 14. Non-Goals

The following are explicitly out of scope:

* Configurable SLA policies.
* Workspace-specific SLA policies.
* Business-hours calendars.
* Holidays.
* SLA pause/resume rules.
* Automatic escalation.
* Escalation rules.
* Background workers.
* Cron jobs.
* Email notifications.
* Push notifications.
* Realtime notifications.
* SLA analytics/reporting.
* Dashboard SLA analytics.
* Advanced SLA history/auditing.

---

## 15. Documentation Requirements

Update relevant documentation when implementation decisions affect:

* Ticket architecture.
* SLA behavior.
* Data model.
* Development workflow.
* API behavior.

The task documentation must remain consistent with the final implementation.

---

## 16. Definition of Done

Task 3 is complete when:

* [ ] Priority behavior is reviewed and implemented consistently.
* [ ] SLA policy definitions are implemented.
* [ ] Response SLA is implemented.
* [ ] Resolution SLA is implemented.
* [ ] SLA deadlines are persisted as stable snapshots.
* [ ] SLA completion behavior is implemented.
* [ ] SLA overdue behavior is implemented.
* [ ] `WAITING_CUSTOMER` does not automatically pause SLA.
* [ ] Priority changes do not silently rewrite established SLA deadlines.
* [ ] SLA calculations remain server-controlled.
* [ ] API / Server Actions follow existing authorization and isolation rules.
* [ ] Ticket UI displays priority and SLA state accessibly.
* [ ] Responsive behavior is verified.
* [ ] Unit/domain tests pass.
* [ ] Integration/regression tests pass.
* [ ] `npm run lint` passes with 0 errors and 0 warnings.
* [ ] `npm run typecheck` passes.
* [ ] `npm run test` passes.
* [ ] `npm run build` passes.
* [ ] Documentation is updated where required.
* [ ] Git status is clean.
* [ ] Changes are committed using the project commit convention.
* [ ] Branch is pushed successfully.
* [ ] Final architecture and implementation review is completed.

---

## 17. Future Architecture

Task 3 intentionally establishes the foundation for future capabilities:

```text
Priority
   ↓
SLA
   ↓
Escalation
   ↓
Reporting
   ↓
Notifications
```

Future iterations may introduce:

* Configurable SLA policies.
* Business-hour calendars.
* SLA pause/resume semantics.
* Escalation thresholds.
* Automated escalation.
* SLA reporting.
* Notification channels.

These capabilities must build on the Task 3 SLA foundation rather than being implemented prematurely in this task.
