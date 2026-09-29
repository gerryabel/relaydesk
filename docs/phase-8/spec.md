# RelayDesk Phase 8 — Automation & SLA Operations

**Version:** v0.6.0-alpha  
**Status:** Draft / Planning  
**Scope:** Phase 8  
**Document:** `docs/phase-8/spec.md`

> Phase 8 is a planned product milestone. It is **not** declared the final RelayDesk phase. Future phases may still be required for customer communication, self-service, integrations, or other product capabilities.

---

## 1. Overview

Phase 7 completed the workspace-management and agent-productivity foundation:

- Team Management
- Workspace Settings
- Personal Saved Views
- Agent Workload
- Operational Analytics

Phase 6 established the asynchronous processing foundation required to safely execute background work:

- transactional outbox
- Redis/BullMQ
- retry and idempotency handling
- email delivery
- SLA background evaluation
- structured worker logging
- operational diagnostics
- graceful shutdown

Phase 8 builds on those foundations to move RelayDesk from a primarily manual helpdesk toward a **controlled automation system with configurable SLA policy**.

The phase focuses on two closely related operational problems:

1. reducing repetitive agent work through explicit automation rules;
2. allowing each workspace to define its own SLA durations without replacing the existing SLA monitoring architecture.

The phase MUST reuse the existing ticket workflow, TicketActivity, workspace authorization, notifications, outbox, BullMQ worker, and SLA monitoring systems.

---

# 2. Phase Goal

> **Make RelayDesk capable of executing safe, observable, workspace-owned ticket automation while allowing workspace owners to configure the SLA policy used by new and reprioritized tickets.**

Phase 8 should add automation without creating a general-purpose workflow engine, arbitrary scripting platform, or second background-job system.

---

# 3. Core Principles

## 3.1 Existing Infrastructure First

Automation MUST reuse:

- transactional outbox
- Redis/BullMQ
- existing worker
- existing retry/idempotency behavior
- TicketActivity
- existing ticket services
- existing notification services
- existing workspace authorization
- existing SLA monitoring functions

No parallel automation queue or separate job runner may be introduced.

## 3.2 Explicit Rules Only

Automation MUST be configured through structured data.

Rules MUST NOT execute arbitrary JavaScript, SQL, shell commands, expressions, or user-provided code.

Conditions and actions MUST be validated with explicit Zod schemas.

## 3.3 Automation Must Be Observable

Every automation execution MUST have a durable execution record containing enough information to determine:

- which rule ran
- which source event triggered it
- which ticket was affected
- which actions were attempted
- whether execution succeeded, partially failed, or failed
- when execution started and ended

Automation behavior MUST never be invisible side effects.

## 3.4 Idempotency Is Mandatory

The same source event MUST NOT execute the same rule more than once successfully.

A worker retry MUST resume safely without duplicating user-visible side effects.

Existing outbox and email idempotency mechanisms MUST be reused.

## 3.5 No Cascading Automation in Phase 8

An action caused by an automation rule MUST NOT recursively trigger another automation rule in the same phase.

This is a deliberate safety boundary.

Phase 8 supports:

```text
Domain Event
    ↓
Matching Rule(s)
    ↓
Action(s)
```

but not:

```text
Rule A
 ↓
Action
 ↓
Rule B
 ↓
Action
 ↓
Rule C
```

Multi-step automation chains are deferred.

## 3.6 Configuration Has Clear Ownership

Workspace automation rules and SLA policies are workspace-owned configuration.

Only workspace owners may:

- create rules
- edit rules
- enable/disable rules
- delete rules
- inspect automation history
- configure SLA policy

Regular workspace members may be affected by automation but MUST NOT alter its configuration.

## 3.7 Preserve Existing Behavior

Phase 8 MUST NOT regress:

- ticket creation
- ticket assignment
- ticket workflow transitions
- priority handling
- tags
- notifications
- SLA monitoring
- background processing
- retry/idempotency behavior
- workspace isolation
- attachments
- customer and ticket history

---

# 4. Phase 8 Scope

Phase 8 consists of five feature areas:

1. Automation Foundation
2. Automation Rule Management
3. Automation Action Execution
4. Configurable SLA Policies
5. Automation Operations & Audit

These areas are intentionally bounded.

---

# 5. Feature Scope

## 5.1 Automation Foundation

### Goal

Create the domain and event foundation required for safe, asynchronous automation execution.

### In Scope

- Automation rule domain model
- Structured trigger definitions
- Structured condition definitions
- Structured action definitions
- Workspace ownership
- Rule enable/disable state
- Automation execution records
- Automation action execution records or equivalent durable action status
- Automation-relevant domain event contracts
- Outbox integration for automation evaluation
- Idempotency keys derived from source event + rule
- Prevention of recursive automation
- Maximum rule/action safety limits

### Trigger Types

Phase 8 supports only explicit ticket events:

- `ticket.created`
- `ticket.assigned`
- `ticket.unassigned`
- `ticket.status_changed`
- `ticket.priority_changed`
- `ticket.tag_added`
- `ticket.tag_removed`
- `ticket.customer_linked`
- `ticket.customer_unlinked`
- `ticket.sla_at_risk`
- `ticket.sla_breached`

The exact internal event names MAY follow existing RelayDesk naming conventions, but each trigger MUST map to a concrete persisted domain event or outbox event.

### Out of Scope

- Scheduled/cron automation triggers
- Time-of-day triggers
- Arbitrary webhooks as automation triggers
- External event buses
- Cross-workspace triggers
- User-defined code execution
- Automation chains

### Requirements

Automation-relevant domain changes MUST be emitted transactionally with the change they describe.

A source event MUST contain enough workspace and ticket context for a worker to evaluate rules without trusting client-supplied workspace identifiers.

---

## 5.2 Automation Rule Management

### Goal

Give workspace owners a simple UI for creating and managing deterministic ticket automation rules.

### In Scope

- Rule list
- Rule creation
- Rule editing
- Rule deletion
- Enable/disable toggle
- Rule name
- Trigger selection
- Condition builder
- Action configuration
- Basic rule ordering/priority
- Validation errors
- Empty state
- Disabled-rule state
- Owner-only authorization

### Condition Model

Phase 8 conditions MUST remain bounded and ticket-focused.

Supported condition fields SHOULD be limited to existing source-of-truth fields such as:

- status
- priority
- assignee presence
- assigned agent
- tag
- customer presence
- customer identity
- ticket creator
- ticket age only when evaluated from the current source event timestamp

Supported operators SHOULD remain simple:

- equals
- not equals
- includes
- excludes
- is set
- is not set

Time-window schedules are out of scope.

A rule MAY contain multiple conditions.

Phase 8 SHOULD support a single deterministic condition group using AND semantics.

OR trees, nested boolean expressions, and arbitrary expression languages are out of scope.

### Rule Limits

To keep evaluation bounded:

- maximum 50 rules per workspace
- maximum 10 conditions per rule
- maximum 5 actions per rule

The implementation MUST validate these limits server-side.

### Rule Ownership

Rules MUST be scoped by `workspaceId`.

Only workspace owners may:

- create
- edit
- enable/disable
- delete

rules.

---

## 5.3 Automation Action Execution

### Goal

Execute useful ticket-management actions asynchronously and safely.

### In Scope

Phase 8 supports the following actions:

1. Assign ticket to a selected workspace member.
2. Unassign ticket.
3. Change ticket status.
4. Change ticket priority.
5. Add a tag.
6. Remove a tag.
7. Create an internal note.
8. Create an in-app notification for a selected workspace member.

Actions MUST reuse the existing domain services wherever possible.

### Action Requirements

Each action MUST:

- validate its configuration
- verify workspace membership/ownership boundaries where relevant
- be idempotent
- record execution status
- provide a useful error message when it fails
- avoid exposing internal exceptions to end users

Automation-created internal notes and notifications MUST clearly indicate that they originated from automation.

### Out of Scope

- Sending customer email from a rule
- SMS
- Push notifications
- External webhooks
- HTTP requests to arbitrary URLs
- Automatic ticket creation
- Automatic customer creation
- Automatic attachment manipulation
- Arbitrary code/action plugins

Customer-facing communication remains a future phase.

---

# 6. Automation Execution Semantics

## 6.1 Event Flow

The expected flow is:

```text
Ticket / SLA Domain Operation
        │
        ▼
DB Transaction
        │
        ├── Domain state change
        ├── TicketActivity
        └── Outbox event
                │
                ▼
        Outbox Dispatcher
                │
                ▼
          BullMQ Worker
                │
                ▼
        Automation Evaluator
                │
                ├── Load enabled workspace rules
                ├── Match trigger
                ├── Evaluate conditions
                └── Execute actions
```

The implementation MUST NOT perform full rule evaluation synchronously inside the user-facing request unless the operation is explicitly required to maintain a transaction invariant.

## 6.2 Idempotency

For each `sourceEventId + ruleId` pair, at most one successful rule execution may exist.

The database SHOULD enforce the invariant with a unique constraint.

A worker retry MUST detect an existing completed execution and avoid reapplying actions.

## 6.3 Action Ordering

Actions within a rule execute in the configured order.

A failed action MUST be recorded.

The default Phase 8 behavior is:

- execute sequentially
- record each result
- continue attempting remaining actions
- mark the overall execution as `completed`, `partial_failure`, or `failed` according to the resulting action states

This behavior must be deterministic and covered by tests.

## 6.4 Recursion Prevention

Automation-generated state changes MUST carry internal execution context.

Generated events from automation MUST NOT cause another rule evaluation in Phase 8.

This prevents loops such as:

```text
Rule A → add tag → tag-added event → Rule A → add tag ...
```

---

# 7. Configurable SLA Policies

## 7.1 Goal

Replace hard-coded SLA durations with workspace-owned configuration while keeping the existing ticket deadline and monitoring architecture intact.

## 7.2 Existing Foundation

RelayDesk already stores:

- `responseSlaDeadline`
- `resolutionSlaDeadline`
- `firstResponseAt`
- `resolvedAt`

and already provides:

- response SLA evaluation
- resolution SLA evaluation
- at-risk detection
- breach detection
- background evaluation
- duplicate notification suppression

Phase 8 MUST reuse these semantics.

## 7.3 In Scope

Each workspace receives one active SLA policy.

The policy defines response and resolution duration for each ticket priority:

- low
- medium
- high
- urgent

Durations are expressed as wall-clock minutes.

The default policy MUST preserve the current RelayDesk SLA durations.

## 7.4 Application Semantics

### New Tickets

When a ticket is created:

- response deadline is computed from the active workspace policy;
- resolution deadline is computed from the active workspace policy;
- the persisted deadlines remain the source of truth for that ticket.

### Priority Changes

When ticket priority changes:

- if first response has not occurred, the response deadline is recalculated using the ticket's original `createdAt` and the new priority policy;
- if the ticket has not been resolved, the resolution deadline is recalculated using the ticket's original `createdAt` and the new priority policy;
- elapsed time is never reset.

### Policy Changes

Changing the workspace SLA policy applies to:

- newly created tickets
- future priority changes

Existing tickets keep their already-persisted deadlines unless their priority is changed.

This avoids retroactive mass mutation of operational ticket deadlines.

## 7.5 SLA Semantics

Phase 8 MUST continue using:

- UTC timestamps
- wall-clock duration
- existing at-risk threshold
- existing breach semantics
- existing background scheduler
- existing duplicate-suppression behavior

Business hours, holidays, and timezone-specific SLA calendars are out of scope.

## 7.6 Authorization

Only workspace owners may modify the active SLA policy.

All reads and writes MUST be workspace scoped and server-authorized.

---

# 8. Automation Operations & Audit

## 8.1 Goal

Make automation understandable and diagnosable without exposing internal infrastructure details to ordinary users.

## 8.2 In Scope

Workspace owners may inspect:

- rule execution history
- ticket
- rule name
- trigger
- source event
- execution timestamp
- overall execution state
- action results
- failure reason
- retry-related state when available

The UI SHOULD support basic filtering by:

- rule
- execution status
- ticket
- date range

No arbitrary log-query interface is required.

## 8.3 Failure Semantics

Transient infrastructure failures SHOULD use the existing BullMQ retry behavior.

Permanent validation/configuration failures MUST be recorded as permanent failures.

The automation system MUST NOT silently drop failed executions.

A failed automation MUST NOT block the original ticket transaction that produced the source event.

---

# 9. Data Model Expectations

Potential new models:

### AutomationRule

Suggested conceptual fields:

- id
- workspaceId
- name
- enabled
- triggerType
- conditions
- actions
- createdById
- createdAt
- updatedAt

Constraints SHOULD include:

- workspace ownership
- unique rule name within workspace
- useful workspace indexes

### AutomationExecution

Suggested conceptual fields:

- id
- workspaceId
- ruleId
- sourceEventId
- ticketId
- status
- startedAt
- completedAt
- error

A uniqueness constraint SHOULD prevent successful duplicate execution for the same `ruleId + sourceEventId`.

### AutomationActionExecution

Suggested conceptual fields:

- id
- executionId
- actionType
- actionIndex
- status
- result
- error
- startedAt
- completedAt

The implementation MAY combine action results into the execution record if that remains fully auditable and testable.

### SlaPolicy

The implementation SHOULD use a normalized model unless a simpler schema is clearly preferable.

A policy MUST be workspace-owned.

Priority-specific durations MUST remain strongly validated.

Analytics-specific persisted counters are not permitted.

---

# 10. Authorization and Workspace Isolation

All Phase 8 functionality MUST preserve workspace isolation.

A user MUST NOT be able to:

- read another workspace's automation rules
- create rules in another workspace
- execute rules for another workspace
- inspect another workspace's automation history
- modify another workspace's SLA policy
- inspect another workspace's SLA configuration

Authorization MUST be enforced server-side.

The client MUST NOT be treated as a security boundary.

Owner authorization SHOULD reuse the existing `assertWorkspaceOwner()` helper introduced in Phase 7.

---

# 11. Architecture Expectations

Phase 8 MUST retain the established layering:

```text
UI
 ↓
Server Action / Route
 ↓
Zod Validation
 ↓
Service / Domain Logic
 ↓
Prisma
```

Asynchronous automation:

```text
Domain Transaction
 ↓
Outbox
 ↓
Dispatcher
 ↓
BullMQ
 ↓
Worker
 ↓
Automation Domain Service
```

The automation evaluator MUST remain separate from presentation components.

Condition evaluation MUST be pure/deterministic where practical.

Action handlers MUST reuse existing ticket, tag, assignment, notification, and workspace services rather than directly duplicating their domain rules.

The SLA policy layer MUST feed the existing SLA deadline calculation functions instead of creating a second SLA evaluator.

---

# 12. UI / UX Requirements

Phase 8 must follow existing RelayDesk visual conventions.

Automation UI MUST provide:

- accessible labels
- keyboard accessibility
- visible focus states
- clear enabled/disabled state
- clear validation errors
- explicit confirmation for destructive rule deletion
- empty state
- loading state
- error state

The rule builder SHOULD remain understandable for a non-programmer workspace owner.

Avoid exposing raw JSON to ordinary users.

SLA configuration MUST clearly communicate:

- priority
- response target
- resolution target
- unit of measurement
- effect of saving the new policy

The automation history view MUST distinguish:

- completed
- partial failure
- failed
- skipped / non-matching where applicable

---

# 13. Testing Requirements

## 13.1 Unit Tests

Required for:

- trigger matching
- condition evaluation
- action validation
- rule validation limits
- action ordering
- recursion prevention
- automation idempotency decisions
- SLA policy validation
- SLA deadline calculation
- priority-change SLA recalculation

## 13.2 Integration Tests

Required for:

- owner-only rule management
- workspace isolation
- rule persistence
- outbox event creation
- worker automation dispatch
- duplicate source-event execution prevention
- action execution
- execution history persistence
- SLA policy persistence
- new-ticket deadline creation
- priority-change deadline recalculation

## 13.3 Regression

Existing Phase 2–7 tests MUST continue to pass.

Phase 6 tests MUST continue to cover:

- outbox behavior
- retries
- idempotency
- email
- SLA background processing
- Redis/BullMQ infrastructure

Automation tests MUST not rely on an external production provider.

---

# 14. Definition of Done

Each Phase 8 task MUST satisfy the project Definition of Done:

- dedicated Git branch
- scope fully implemented
- architecture reviewed
- UI reviewed where applicable
- accessibility reviewed
- security reviewed
- performance reviewed where relevant
- tests added/updated
- `npm run lint` passes with 0 warnings/errors
- `npm run typecheck` passes
- `npm test` passes
- `npm run build` passes
- documentation updated
- intentional commit created
- working tree clean
- independent verification completed

Push remains subject to the normal project workflow and explicit user request.

---

# 15. Task Planning

Phase 8 is planned as five tasks.

## Task 1 — Automation Foundation

Responsibilities:

- automation data model
- execution model
- trigger contracts
- automation outbox integration
- idempotency constraints
- recursion-prevention context
- domain services
- core tests

Dependency: none.

## Task 2 — Automation Rule Management

Responsibilities:

- rule CRUD
- rule builder UI
- condition validation
- action configuration validation
- owner-only authorization
- enable/disable
- rule limits
- rule-management tests

Dependency: Task 1.

## Task 3 — Automation Action Execution

Responsibilities:

- worker-side rule evaluation
- matching conditions
- ordered action execution
- assign/unassign
- status change
- priority change
- tag add/remove
- internal note creation
- in-app notification
- retries/idempotency
- action execution history

Dependency: Tasks 1–2.

## Task 4 — Configurable SLA Policies

Responsibilities:

- SLA policy model
- owner-only settings UI
- priority-specific durations
- new-ticket deadline calculation
- priority-change recalculation
- existing SLA monitoring integration
- migration
- tests

Dependency: independent from Tasks 2–3 at the data level, but implemented after Task 1 so shared authorization and worker assumptions remain stable.

## Task 5 — Automation Operations & Integration Hardening

Responsibilities:

- execution history UI
- execution filtering
- failure-state presentation
- operational documentation
- integration/regression tests
- performance review
- final Phase 8 hardening
- final independent verification

Dependency: Tasks 1–4.

---

# 16. Dependency Graph

```text
Task 1 — Automation Foundation
   │
   └──→ Task 2 — Rule Management
              │
              └──→ Task 3 — Action Execution

Task 4 — Configurable SLA Policies
   │
   └───────────────┐
                   ▼
Task 5 — Operations & Integration Hardening
```

Task 4 is intentionally independent of the rule-builder implementation.

---

# 17. Explicit Phase 8 Non-Goals

The following are outside Phase 8:

### Customer Communication

- email-to-ticket
- inbound email processing
- customer email threading
- SMS
- WhatsApp
- social channels
- customer-facing automation email templates

### Self-Service

- knowledge base
- customer portal
- public ticket portal
- customer authentication

### Advanced Automation

- automation chains
- nested rule graphs
- scheduled triggers
- cron-based rules
- arbitrary webhooks
- arbitrary HTTP actions
- custom scripts
- custom code plugins
- AI-generated rules
- predictive automation

### Assignment Intelligence

- round-robin assignment
- skill-based routing
- load balancing
- predictive staffing

### Advanced SLA

- business hours
- holiday calendars
- timezone-aware SLA calendars
- pause/resume SLA policies
- customer-tier SLA policies
- multiple simultaneous active policies
- SLA escalation policy editor beyond the existing at-risk/breach architecture

### Reporting

- new BI infrastructure
- data warehouse
- custom report builder
- scheduled reports

### Infrastructure

- replacing Redis/BullMQ
- replacing the transactional outbox
- introducing another background-job platform
- introducing a separate event-bus product

---

# 18. Security Requirements

Automation is privileged infrastructure and MUST be treated as a security-sensitive feature.

The implementation MUST:

- validate every rule configuration server-side
- validate referenced users and tags against the current workspace
- never execute arbitrary user code
- never trust client-provided workspace IDs
- prevent cross-workspace rule execution
- prevent duplicate side effects
- prevent automation loops
- avoid exposing internal stack traces or infrastructure credentials
- avoid embedding secrets in rule configuration
- ensure deleted/disabled rules cannot begin new executions after their effective state is observed

Any security ambiguity is a stop condition under the existing project workflow.

---

# 19. Performance Requirements

Automation MUST remain bounded.

The implementation SHOULD:

- avoid N+1 rule/ticket queries
- load the minimum required ticket context
- avoid loading disabled rules
- bound rule count and condition/action count
- use workspace indexes
- avoid executing long automation chains
- keep rule evaluation asynchronous
- avoid blocking ticket user requests on automation execution

The worker SHOULD process automation events in bounded batches where practical.

---

# 20. Documentation Requirements

Phase 8 documentation MUST include:

```text
docs/phase-8/
├── spec.md
├── task-1.md
├── task-2.md
├── task-3.md
├── task-4.md
└── task-5.md
```

The final phase documentation SHOULD also explain:

- automation event flow
- rule condition/action model
- idempotency behavior
- recursion prevention
- failure/retry semantics
- SLA policy behavior
- operational troubleshooting

---

# 21. Phase 8 Success Criteria

Phase 8 is successful when:

1. Workspace owners can configure deterministic ticket automation rules.
2. Automation is executed asynchronously using the existing outbox/BullMQ infrastructure.
3. Automation is idempotent and does not recurse indefinitely.
4. Automation side effects are durable and observable.
5. Workspace isolation remains enforced.
6. Existing ticket behavior remains intact.
7. Workspace owners can configure response/resolution SLA durations per ticket priority.
8. New tickets use the configured SLA policy.
9. Priority changes correctly recalculate pending SLA deadlines without resetting elapsed time.
10. Existing SLA at-risk/breach monitoring continues to operate.
11. Existing Phase 2–7 functionality remains stable.
12. Full verification passes according to the project Definition of Done.

---

# 22. Phase Boundary

Phase 8 deliberately moves RelayDesk into **controlled automation**, but it does not attempt to become a complete omnichannel or enterprise service platform.

The product progression becomes:

> Foundation → Helpdesk → Workflow → Operations → Workspace → Insight → Automation

After Phase 8, likely future candidates include:

- customer communication / email-to-ticket
- knowledge base
- customer self-service
- shared views and advanced collaboration
- richer integrations
- advanced SLA calendars
- automation chains

Those candidates MUST be evaluated as separate phases rather than silently expanding Phase 8.

---

# 23. Planning Status

This document is the Phase 8 planning baseline.

No implementation task is approved merely by the existence of this specification.

Before implementation:

1. review this specification;
2. confirm or amend scope;
3. finalize task details;
4. inspect current implementation against each task;
5. create the task branch from the latest completed baseline;
6. produce the task-specific implementation plan;
7. obtain approval before code changes.

Phase 8 should be treated as a **candidate milestone**, not assumed to be the final RelayDesk phase.
