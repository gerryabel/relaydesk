# RelayDesk Phase 7 — Agent Productivity & Workspace Management

**Version:** v0.5.0-alpha
**Status:** Planning
**Scope:** Phase 7
**Document:** `docs/phase-7/spec.md`

---

## 1. Overview

Phase 7 evolves RelayDesk from an operational helpdesk into a more capable workspace for managing teams, organizing agent workflows, understanding workload, and analyzing operational performance.

Phase 6 established the background-processing foundation required for asynchronous work, including transactional outbox processing, Redis/BullMQ workers, email delivery, retry/idempotency handling, SLA background evaluation, and operational observability.

Phase 7 builds primarily on the application and domain foundations already established in Phases 2–6.

The primary goal is to improve how a workspace is configured and managed while giving agents and workspace owners better tools for organizing and understanding operational work.

---

# 2. Phase Goal

> **Make RelayDesk a more capable operational workspace by improving team management, workspace configuration, saved ticket workflows, agent workload visibility, and operational analytics.**

Phase 7 should prioritize practical workspace and agent productivity improvements over introducing new infrastructure.

The phase MUST reuse existing ticket, assignment, filtering, sorting, tagging, SLA, notification, workspace, and membership infrastructure wherever appropriate.

---

# 3. Core Principles

## 3.1 Build on Existing Foundations

Phase 7 MUST extend existing architecture rather than introduce parallel systems.

Relevant existing foundations include:

* Workspace and Membership models
* User and workspace roles
* Ticket assignment
* My Queue
* Ticket filtering
* Ticket sorting
* Ticket search
* Ticket tags
* SLA calculations and monitoring
* In-app notifications
* Dashboard statistics
* Existing authorization boundaries
* Existing service/domain modules

New functionality SHOULD reuse these systems instead of duplicating their logic.

## 3.2 Workspace Before Platform

Phase 7 focuses on capabilities within an existing RelayDesk workspace.

It MUST NOT expand into platform-wide identity or infrastructure work such as OAuth, multi-workspace identity switching, or external authentication providers.

## 3.3 Operational Value Over Feature Count

A feature should be included only when it provides meaningful value to workspace owners or agents handling tickets.

Phase 7 is intentionally smaller than earlier phases.

## 3.4 Preserve Existing Behavior

Phase 7 MUST NOT regress existing functionality from Phases 2–6.

Existing ticket workflow, customer management, collaboration, notifications, SLA monitoring, background processing, and attachment behavior remain part of the acceptance criteria.

## 3.5 Configuration Must Have Clear Ownership

Workspace-level settings MUST be distinguishable from user-level preferences.

Team capabilities MUST respect workspace authorization and existing membership boundaries.

## 3.6 Analytics Must Reflect Source-of-Truth Data

Analytics MUST derive from existing persisted domain data and established business rules.

Analytics MUST NOT introduce duplicated counters or independently maintained operational state unless there is a demonstrated technical requirement.

---

# 4. Phase 7 Scope

Phase 7 consists of the following feature areas:

1. Team Management
2. Workspace Settings
3. Saved Views
4. Agent Workload
5. Analytics

These areas are intentionally limited to workspace and agent productivity concerns.

---

# 5. Feature Scope

## 5.1 Team Management

### Goal

Provide workspace owners and authorized users with practical tools to understand and manage workspace membership.

### In Scope

* Workspace member listing
* Member detail information
* Current workspace role visibility
* Basic role management using the existing workspace role model
* Assignment eligibility visibility
* Member-related authorization boundaries
* Replacement of the existing members-page placeholder

### Out of Scope

* Member online status, availability, presence, last-seen state, or equivalent presence tracking — the current architecture has no source-of-truth data to support this.
* OAuth
* External identity providers
* Multi-workspace account switching
* Advanced enterprise identity management
* Complex permission matrices unless explicitly introduced by a later phase
* Invitation email infrastructure

### Requirements

Team management MUST respect workspace isolation.

Only authorized workspace users may perform privileged member-management actions.

Role management MUST extend the existing `WorkspaceRole` model rather than creating a parallel permission system.

---

## 5.2 Workspace Settings

### Goal

Provide a centralized location for workspace-level configuration.

### In Scope

Phase 7 MUST implement only the **workspace name** setting unless another concrete requirement already exists in the repository or this specification.

The settings system SHOULD establish a clean, extensible foundation for workspace configuration, but Phase 7 implementation is limited to:

* Workspace name (the initial and mandatory Phase 7 setting)

The settings page MUST replace the current placeholder implementation.

### Out of Scope

* Operational preferences, default ticket behavior, display preferences, or other speculative settings not required by an existing feature.
* OAuth configuration
* External integrations
* Email provider administration
* Business-hour / holiday SLA policy editor
* Automation rule editor
* Multi-workspace administration

### Requirements

Workspace settings MUST be scoped to the current workspace.

Settings MUST NOT be stored in client-only state when they affect server-side behavior.

Configuration MUST have explicit validation and authorization boundaries.

---

## 5.3 Saved Views

### Goal

Allow users to persist useful ticket filter/sort/view combinations instead of rebuilding them for every session.

### Existing Foundation

RelayDesk already supports ticket search, status filtering, priority filtering, sorting, tags, pagination, and My Queue views.

Phase 7 SHOULD extend this existing query infrastructure rather than implement a second filtering system.

### In Scope

* Saved ticket view definitions
* Saved filter criteria
* Saved sort configuration
* Saved queue/view selection where applicable
* Personal saved views only
* Create/edit/delete saved views
* Apply saved view to the existing ticket/queue interface

### Out of Scope

* Workspace-shared saved views — explicitly deferred to a future phase.
* Arbitrary reporting dashboards
* Workflow automation triggered by saved views
* Scheduled reports
* External sharing

### Requirements

Saved views MUST serialize the existing query/filter model rather than duplicate filter semantics.

A saved view MUST remain safe and valid when referenced filters or fields change.

A saved view MUST be owned by a single user within the current workspace. Only its owner may create, edit, apply, or delete it.

---

## 5.4 Agent Workload

### Goal

Provide useful visibility into how work is distributed across agents and identify potentially overloaded or underutilized queues.

### In Scope

* Agent workload summary
* Assigned ticket counts
* Workload breakdown by relevant ticket state
* High-priority / urgent workload visibility
* SLA-risk workload visibility where existing SLA data supports it
* Team/workspace-level workload overview
* Reuse of existing assignment and queue logic

### Requirements

Workload calculations MUST derive from current ticket assignment and status data.

Where practical, workload views SHOULD reuse the same business definitions already used by My Queue and SLA monitoring.

Workload metrics MUST clearly define what is being counted.

### Out of Scope

* Automatic assignment
* Round-robin assignment
* Skill-based routing
* Automated workload balancing
* Predictive staffing
* Machine-learning workload forecasting

---

## 5.5 Analytics

### Goal

Provide practical operational insight into ticket and agent activity beyond the existing basic dashboard counters.

### Existing Foundation

The current dashboard provides basic ticket-state counts.

Phase 7 may extend this foundation using existing ticket, activity, assignment, SLA, customer, and notification data.

### In Scope

Phase 7 MUST implement the following explicit, bounded metric set:

1. **Ticket Volume** — count of tickets created within the selected time range.
2. **Status Distribution** — count of tickets grouped by current ticket status.
3. **Priority Distribution** — count of tickets grouped by current priority.
4. **Resolution Count** — count of tickets whose `resolvedAt` falls within the selected time range.
5. **Average Resolution Time** — average duration from ticket creation (`createdAt`) to resolution (`resolvedAt`) for tickets **resolved** within the selected time range. Unresolved tickets are excluded.
6. **Assignment Distribution** — count of currently assigned tickets grouped by assigned agent (tickets with a non-null `assignedToId`).
7. **SLA Risk Count** — count of currently open tickets that satisfy the existing SLA-risk definition at query time, reusing the established `SLA_AT_RISK` monitoring semantics.
8. **SLA Breach Count** — count of tickets whose existing SLA deadline has been exceeded according to the established SLA semantics.

Analytics SHOULD prioritize information useful for operational decision-making rather than attempting to become a full business-intelligence platform.

### Time Semantics

Phase 7 analytics use the following explicit time semantics:

* **Timezone:** UTC
* **Calendar-day boundary:** 00:00:00 UTC
* **Time ranges use `[start, end)` semantics** (inclusive start, exclusive end).
* **Daily time-series granularity** for Phase 7.
* **Rolling-24-hour analytics are out of scope** for Phase 7.

### Requirements

Every metric MUST have an explicit definition (see the In Scope list above).

Analytics MUST use existing domain semantics.

Queries MUST respect workspace isolation and authorization.

Time-based metrics MUST define their timezone and date-boundary behavior (see Time Semantics above).

Agent-level visibility is OWNER-ONLY for Phase 7. Workspace-level aggregate analytics MAY be visible to authorized workspace members according to the existing membership model.

### Out of Scope

* Rolling-24-hour / sliding-window analytics.
* Agent-level analytics visibility for non-owner members.
* Full BI infrastructure
* Data warehouse
* Complex arbitrary report builder
* Predictive analytics
* Machine-learning scoring
* External analytics providers

---

# 6. Explicit Phase 7 Non-Goals

The following remain outside Phase 7 scope.

### Communication Infrastructure

* Email-to-ticket
* New external communication channels
* SMS
* Push notifications beyond the existing notification architecture

### Automation

* Automation rules
* Workflow automation engine
* Auto assignment
* Round-robin assignment
* Skill-based routing
* Automated escalation engine

### Real-Time Infrastructure

* WebSocket infrastructure
* Real-time ticket synchronization
* Real-time collaborative editing

### Knowledge / Self-Service

* Knowledge base
* Suggested knowledge articles
* Customer self-service portal

### Identity / Platform

* OAuth
* External identity providers
* Multi-workspace account switching
* Enterprise identity management

### SLA Policy Expansion

* Configurable SLA policy editor
* Business-hour calendars
* Holiday calendars
* Automated SLA escalation policy engine

Phase 6's existing SLA evaluation, background processing, duplicate suppression, and notification behavior MUST remain intact.

### Infrastructure

* New background-job platform
* Replacement of the existing Redis/BullMQ infrastructure
* New infrastructure introduced without a direct Phase 7 product requirement

---

# 7. Architecture Expectations

Phase 7 SHOULD maintain the established architectural separation:

```text
UI
 ↓
API / Route Handler
 ↓
Validation
 ↓
Service / Domain Logic
 ↓
Prisma / Database
```

Where appropriate, existing infrastructure such as:

* ticket query/filter utilities
* queue/view logic
* workspace membership logic
* SLA evaluation helpers
* dashboard services

MUST be reused.

Domain rules MUST NOT be duplicated across UI and API layers.

Analytics MUST be implemented as domain/query functionality rather than embedding business rules exclusively inside UI components.

Saved views MUST build on the existing ticket query model.

---

# 8. Data Model Expectations

Potential Phase 7 persistence may include new models for:

* Saved views
* Workspace settings
* Additional team-management metadata
* Analytics-specific persisted state only if demonstrated necessary

Before adding persistence, implementation planning MUST determine whether existing models can satisfy the requirement.

New models MUST:

* have clear workspace ownership
* define authorization boundaries
* include appropriate indexes
* preserve relational integrity
* include appropriate uniqueness constraints
* avoid duplicating existing domain state

Analytics SHOULD prefer computed/query-based metrics over persisted aggregates unless performance requirements justify materialization.

---

# 9. Authorization and Workspace Isolation

All Phase 7 functionality MUST preserve workspace isolation.

A user MUST NOT be able to:

* read another workspace's members
* modify another workspace's settings
* access another workspace's saved views
* query another workspace's workload
* access another workspace's analytics

Privileged team and workspace operations MUST enforce the existing role/authorization model.

Authorization MUST be enforced server-side.

Client-side visibility MUST NOT be treated as the security boundary.

### Owner Authorization Helper

Phase 7 MUST introduce a reusable server-side owner-authorization helper built on the existing `WorkspaceRole` model. This helper:

* Verifies current workspace membership.
* Verifies `WorkspaceRole.owner`.
* Is reusable by privileged Team Management and Workspace Settings operations.
* Remains a server-side security boundary.

---

# 10. UI / UX Requirements

Phase 7 MUST follow existing RelayDesk interface conventions.

Interactive controls MUST provide:

* Accessible names
* Appropriate semantic elements
* Keyboard accessibility
* Visible focus states
* Clear success/error feedback
* Appropriate loading states

The UI MUST remain usable across:

* Desktop
* Tablet
* Narrow/mobile viewport where existing application support applies

Workspace settings and team management SHOULD clearly communicate destructive or privileged actions.

Analytics MUST distinguish between:

* zero data
* unavailable data
* loading
* error states

Saved views are personal-only for Phase 7. The UI SHOULD make this ownership model clear where relevant.

---

# 11. Testing Requirements

Phase 7 MUST extend the established testing strategy.

## Unit Tests

Required for domain logic such as:

* Team authorization rules
* Settings validation
* Saved view serialization/deserialization
* Saved view authorization
* Workload calculations
* Analytics calculations
* Metric definitions

## Integration/API Tests

Required for:

* Team management authorization
* Workspace settings
* Saved views
* Workload queries
* Analytics queries
* Workspace isolation
* Database constraints and migrations

## Regression

All existing Phase 2–6 tests MUST continue to pass.

Phase 6 background processing, retry/idempotency, email handling, and SLA behavior MUST NOT regress.

---

# 12. Definition of Done

A Phase 7 task is not considered complete merely because the implementation exists.

Each task MUST satisfy the project Definition of Done:

* Separate Git branch
* Documentation updated where applicable
* Architecture reviewed
* UI/UX reviewed where applicable
* Accessibility reviewed
* Responsive behavior reviewed
* Tests added/updated
* `npm run lint` passes with 0 errors
* `npm run typecheck` passes
* `npm run test` passes
* `npm run build` passes
* Changes reviewed
* Intentional commit created
* Branch pushed to remote
* Final independent verification completed

---

# 13. Task Planning Requirements

This specification defines Phase 7 feature scope, not the final task breakdown.

Before implementation begins, Phase 7 MUST have:

* Final task list
* Task dependencies
* Recommended implementation order
* Database/migration boundaries
* Integration points
* Testing strategy per task
* Documentation requirements per task
* Acceptance criteria per task

Tasks SHOULD be independently verifiable wherever practical.

Integration branches MUST only be introduced when there is a real dependency or integration requirement.

---

# 14. Dependencies and Recommended Implementation Order

## 14.1 Hard Dependency

Phase 7 has one hard dependency:

* **Team Management** introduces (or reuses) the owner-authorization helper required by privileged **Workspace Settings** operations.

This is a genuine dependency: privileged workspace settings writes must verify `WorkspaceRole.owner`, and Phase 7 centralizes that verification in a single reusable helper first established for Team Management.

## 14.2 Recommended Implementation Order

The following order is recommended based on migration complexity and shared infrastructure, **not** hard data dependencies:

1. **Team Management** — introduces the owner-authorization helper; replaces the members-page placeholder; no new persistence.
2. **Workspace Settings** — depends on the owner-authorization helper; adds minimal workspace-name persistence; replaces the settings-page placeholder.
3. **Saved Views** — adds new `SavedView` persistence; personal-only; reusable query/filter serialization.
4. **Agent Workload** — computed from existing ticket and assignment data; no new persistence.
5. **Analytics** — computed from existing ticket data with explicit time semantics; no new persistence.

Saved Views, Agent Workload, and Analytics do **not** have hard data dependencies on each other. They are ordered above by increasing query complexity and by the testing foundation each provides for the next. The final task dependency graph MAY be adjusted during implementation planning, provided the Team Management → Workspace Settings hard dependency is preserved.

---

# 15. Phase 7 Success Criteria

Phase 7 is successful when RelayDesk provides a coherent workspace-management and agent-productivity experience in which:

1. Workspace members can be managed using clear authorization boundaries.
2. Workspace configuration has a proper centralized settings experience.
3. Agents can save and reuse useful ticket views.
4. Workspace owners and agents can understand current workload distribution.
5. Workspace operators can obtain meaningful operational analytics.
6. Existing ticket workflows remain intact.
7. Existing SLA and background-processing behavior remains intact.
8. Workspace isolation and authorization remain enforced.
9. Testing and build stability are preserved.

The resulting product should feel like a natural evolution of the Phase 5 operational helpdesk and Phase 6 infrastructure rather than a collection of unrelated features.

---

# 16. Phase Boundary

Phase 7 deliberately does not attempt to become a complete enterprise helpdesk platform.

Features such as automation, automatic assignment, advanced SLA policy engines, real-time collaboration, OAuth, email-to-ticket, knowledge base, and predictive analytics remain future candidates.

The objective of Phase 7 is a focused improvement in:

> **Team → Workspace → Workflow → Workload → Insight**

This progression should provide a coherent product evolution while keeping the phase substantially smaller and more manageable than earlier development phases.
