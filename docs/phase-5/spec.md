# RelayDesk Phase 5 — Operational Helpdesk & Agent Productivity

**Version:** v0.4.0-alpha
**Status:** Planning
**Scope:** Phase 5
**Document:** `docs/phase-5/spec.md`

---

## 1. Overview

Phase 5 evolves RelayDesk from a ticket workflow system into a more operationally useful helpdesk platform.

Phase 4 established the core ticket workflow:

* Ticket assignment
* Ticket status workflow
* Ticket priority
* SLA foundations
* Search
* Filtering
* Sorting
* Pagination
* Activity timeline

Phase 5 builds on those foundations by improving customer context, agent collaboration, ticket organization, SLA visibility, agent workflow, notifications, bulk operations, and message attachments.

The primary goal is to make RelayDesk more effective for agents handling tickets during day-to-day helpdesk operations.

---

## 2. Phase Goal

> **Make RelayDesk an operational helpdesk where agents can understand customers, collaborate internally, organize tickets, monitor SLA health, manage their own queue, and efficiently process multiple tickets.**

Phase 5 should prioritize practical agent workflows over introducing large infrastructure or platform-level capabilities.

---

## 3. Core Principles

### 3.1 Build on Existing Foundations

Phase 5 MUST reuse and extend existing Phase 2–4 architecture where appropriate.

Examples:

* Existing Ticket model
* Existing Membership model
* Existing Message model
* Existing Activity Timeline
* Existing assignment logic
* Existing status workflow
* Existing priority logic
* Existing SLA calculations
* Existing search/filter/sort/pagination infrastructure

Do not introduce parallel systems that duplicate existing behavior.

### 3.2 Operational Value Over Feature Count

A feature should only be included when it directly improves the agent's ability to process tickets.

Phase 5 is not intended to maximize the number of features shipped.

### 3.3 Explicit Scope Boundaries

Features listed as non-goals MUST NOT be implemented as part of Phase 5 unless the Phase 5 specification is explicitly revised.

### 3.4 Preserve Existing Behavior

Phase 5 changes MUST NOT regress existing Phase 2–4 functionality.

Existing tests and workflows remain part of the Phase 5 acceptance criteria.

---

# 4. Phase 5 Scope

Phase 5 consists of the following feature areas:

1. Customer / Contact Management
2. Internal Notes
3. Tags / Labels
4. SLA Monitoring
5. My Queue / Agent Queue
6. In-App Notifications
7. Bulk Ticket Actions
8. Attachments

---

# 5. Feature Scope

## 5.1 Customer / Contact Management

### Goal

Give RelayDesk a proper customer entity and provide agents with customer context while handling tickets.

### In Scope

* Customer entity
* Customer basic profile information
* Customer-to-ticket relationship
* Customer search
* Customer profile view
* Customer ticket history
* Navigation from ticket to customer
* Navigation from customer to related tickets

### Expected Customer Context

A customer profile should provide enough information for an agent to understand the customer's relationship with RelayDesk.

At minimum, the profile should support:

* Name
* Email
* Relevant contact information supported by the existing domain model
* Related tickets
* Ticket status information

### Out of Scope

* Customer portal
* Customer authentication
* Customer self-service
* Customer segmentation
* Customer billing
* CRM functionality

---

# 6. Internal Notes

## Goal

Allow agents to communicate internally without exposing internal information to the customer.

### In Scope

* Create internal note
* Display internal notes distinctly from customer-visible messages
* Associate internal notes with the ticket
* Record note author
* Display internal notes in the activity/timeline context
* Authorization ensuring internal notes are not treated as customer-visible messages

### Required Distinction

RelayDesk MUST clearly distinguish:

```text
Customer-visible message
```

from:

```text
Internal agent note
```

Internal notes MUST NOT be exposed through customer-visible message behavior.

### Activity Integration

Internal note creation should integrate with the existing activity architecture where appropriate.

The actor MUST remain identifiable.

### Out of Scope

* Rich text editor
* Mentions
* Threaded internal discussions
* Reactions
* Real-time collaboration

---

# 7. Tags / Labels

## Goal

Provide flexible ticket classification beyond status, priority, and assignment.

### In Scope

* Tag entity
* Ticket-to-tag relationship
* Create tag
* Rename tag
* Delete tag where safe
* Add tag to ticket
* Remove tag from ticket
* Display tags on ticket UI
* Filter tickets by tags
* Tag management appropriate to the existing workspace model

### Example Tags

```text
billing
refund
technical
bug
vip
account
```

### Design Principle

Tags should complement, not replace:

* Status
* Priority
* Assignee
* Workflow state

### Out of Scope

* Hierarchical tags
* Tag automation
* Tag-based workflow rules
* AI-generated tags
* Advanced taxonomy management

---

# 8. SLA Monitoring

## Goal

Turn the SLA foundation introduced in Phase 4 into actionable operational information for agents.

Phase 4 introduced SLA-related data and calculations. Phase 5 focuses on visibility and monitoring.

### In Scope

* SLA status representation
* Response SLA visibility
* Resolution SLA visibility
* Remaining-time information where applicable
* At-risk indicators
* Breach indicators
* SLA status in ticket detail
* SLA visibility in relevant ticket lists/queues
* Integration with agent workflow where appropriate

### Expected SLA States

The UI should communicate states such as:

```text
On Track
At Risk
Breached
Completed
Not Applicable
```

The exact implementation should follow the existing SLA domain rules.

### Out of Scope

* Configurable SLA policy editor
* Multiple SLA policy engines
* Business-hours calendar
* Holiday calendars
* Escalation automation
* Email SLA alerts
* Advanced SLA reporting

---

# 9. My Queue / Agent Queue

## Goal

Provide agents with a focused operational view of tickets requiring their attention.

### In Scope

* Tickets assigned to the current agent
* Relevant ticket status information
* Priority visibility
* SLA visibility
* Queue counts/summaries
* Navigation from queue to ticket
* Appropriate reuse of existing filtering/sorting/pagination behavior

### Queue Philosophy

The queue should answer:

> "What tickets do I need to work on?"

It should not become a second independent ticket-management system.

### Possible Queue Categories

Depending on the final UX design:

```text
My Open Tickets
High Priority
SLA At Risk
Waiting Customer
Recently Updated
```

These categories should reuse existing ticket state and query infrastructure where possible.

### Out of Scope

* Automatic assignment
* Round-robin assignment
* Skill-based routing
* Team workload balancing
* Workflow automation

---

# 10. In-App Notifications

## Goal

Give agents timely awareness of important events without requiring them to continuously inspect tickets.

### In Scope

* Notification entity/model
* Notification creation for selected domain events
* Notification list
* Read/unread state
* Notification badge/count
* Mark as read
* Navigation to the related resource
* Appropriate notification retention behavior

### Initial Notification Events

The initial implementation SHOULD cover high-value events such as:

* Ticket assigned to agent
* Customer reply
* Relevant ticket workflow/status change
* SLA at-risk event where technically appropriate

The final event list must be defined during task planning before implementation.

### Requirements

Notifications MUST respect workspace and authorization boundaries.

An agent MUST NOT receive notifications for resources they are not authorized to access.

### Out of Scope

* Email notifications
* Push notifications
* SMS
* Browser push infrastructure
* Notification preferences
* Notification automation rules

---

# 11. Bulk Ticket Actions

## Goal

Allow agents to efficiently perform common operations across multiple tickets.

### In Scope

Initial bulk operations SHOULD support:

* Bulk assignment
* Bulk status update
* Bulk priority update
* Bulk tag addition/removal

### Requirements

Bulk operations MUST:

* Validate each target ticket
* Respect authorization
* Respect existing workflow/domain rules
* Avoid partially applying invalid operations without an explicit strategy
* Provide clear success/failure feedback
* Preserve relevant activity/audit behavior

### Out of Scope

* Bulk deletion
* Bulk customer modification
* Bulk message operations
* Arbitrary bulk database mutation
* Automation rules

---

# 12. Attachments

## Goal

Allow customers/agents to associate files with ticket communication where appropriate.

### In Scope

* Upload attachment
* Attachment metadata
* Associate attachment with a message or supported communication entity
* Download attachment
* Delete attachment where authorized
* File type validation
* File size validation
* Authorization checks
* Basic attachment UI

### Minimum Metadata

The system SHOULD preserve information such as:

* Original filename
* MIME type
* File size
* Storage reference
* Upload timestamp
* Uploader/owner where applicable

### Security Requirements

Attachment handling MUST include:

* Authorization checks
* File size limits
* Allowed file type strategy
* Safe filename handling
* No direct exposure of unauthorized files
* Appropriate storage abstraction

### Storage

The storage strategy MUST be explicitly decided during technical task planning before implementation.

The implementation MUST avoid coupling the domain model unnecessarily to a specific storage provider.

### Out of Scope

* Image processing
* Video processing
* Document preview engine
* Virus scanning infrastructure
* Object-storage administration
* Customer file portal
* Advanced file versioning

---

# 13. Phase 5 Non-Goals

The following are explicitly outside Phase 5 scope:

### Communication Infrastructure

* Email notifications
* Email-to-ticket
* Full outbound email delivery system
* SMS
* Push notifications

### Automation

* Automation rules
* Workflow automation engine
* Auto assignment
* Round-robin assignment
* Skill-based routing
* Automated escalation

### Real-Time Infrastructure

* WebSocket infrastructure
* Real-time ticket synchronization
* Real-time collaborative editing

### Knowledge / Self-Service

* Knowledge base
* Suggested knowledge articles
* Customer self-service portal

### Identity / Workspace Expansion

* OAuth
* Multi-workspace picker
* Invite-user system
* Advanced workspace administration
* Advanced team management

### SLA Expansion

* Configurable SLA policy editor
* Business-hour calendars
* Holiday calendars
* Automated SLA escalation

### Analytics Expansion

* Advanced reporting
* Agent performance scoring
* Complex reporting engine
* Historical BI infrastructure

### Infrastructure

* Redis
* Background-job platform
* Docker reintroduction solely for Phase 5 features

Infrastructure may only be introduced when a scoped feature has a demonstrated technical requirement for it.

---

# 14. Architecture Expectations

Phase 5 SHOULD maintain the established architectural separation:

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

Domain rules MUST NOT be duplicated across UI and API layers.

Where existing services or domain modules exist, Phase 5 should extend them rather than create competing implementations.

---

# 15. Data Integrity

All Phase 5 features MUST preserve relational and domain integrity.

Particular attention is required for:

* Customer relationships
* Ticket relationships
* Ticket-tag relationships
* Internal notes
* Notifications
* Attachments
* Bulk operations

Operations that modify multiple related records SHOULD use transactions where atomicity is required.

Bulk operations MUST have a clearly defined failure/transaction strategy before implementation.

---

# 16. Authorization

Every new resource MUST respect the existing workspace/membership authorization model.

This applies especially to:

* Customers
* Internal notes
* Tags
* Notifications
* Attachments
* Bulk ticket actions

A user MUST NOT gain access to another workspace's resources through indirect relationships.

---

# 17. Activity / Audit Considerations

Phase 4 introduced `TicketActivity` and transactional activity logging.

Phase 5 MUST preserve the activity/audit model.

Relevant mutations SHOULD produce appropriate activity records, including where applicable:

* Internal note creation
* Tag changes
* Assignment changes
* Bulk ticket changes
* Relevant workflow changes
* Attachment operations where auditability requires it

The exact activity event taxonomy will be finalized during task planning.

---

# 18. UI / UX Requirements

All Phase 5 UI MUST follow the established RelayDesk UI conventions.

### Required

* Responsive behavior
* Loading states
* Empty states
* Error states
* Accessible controls
* Keyboard accessibility where applicable
* Clear destructive-action confirmation
* Consistent feedback for mutations

### Accessibility

Interactive controls MUST have:

* Accessible names
* Appropriate semantic elements
* Keyboard operation
* Visible focus states
* Appropriate status/error communication

### Responsive

The UI MUST remain usable across:

* Desktop
* Tablet
* Narrow/mobile viewport where the existing application supports it

---

# 19. Testing Requirements

Phase 5 MUST maintain and extend the existing test strategy.

## Unit Tests

Required for domain logic such as:

* Customer rules
* Tag operations
* SLA status calculation/interpretation
* Notification logic
* Bulk-operation validation
* Attachment validation

## Integration/API Tests

Required for:

* Authorization
* Customer endpoints
* Internal notes
* Tags
* Notifications
* Bulk operations
* Attachments
* SLA-related behavior

## UI Tests

Where existing project conventions support them, important user-facing behavior should be covered.

## Regression

All existing Phase 2–4 tests MUST continue to pass.

---

# 20. Definition of Done

A Phase 5 task is not considered complete merely because the implementation exists.

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

# 21. Independent Verification

Hermes self-report is NOT considered final proof of completion.

After Hermes reports a task complete, independent verification MUST be performed.

### Verification Sequence

1. Check `git status`
2. Confirm current branch
3. Inspect `git log`
4. Review `git diff`
5. Review `git diff --stat`
6. Review `git diff --cached --stat` where applicable
7. Review critical changed files
8. Run `npm run lint`
9. Run `npm run typecheck`
10. Run `npm run test`
11. Run `npm run build`
12. Verify intended Git state
13. Confirm commit and remote branch state

The verification result is the authoritative completion evidence.

---

# 22. Git Workflow

Phase 5 MUST follow the established task-based Git workflow.

Each task SHOULD use a dedicated branch.

Example:

```text
phase-5/task-1-customer-management
phase-5/task-2-internal-notes
phase-5/task-3-tags
...
```

Integration branches MUST only be introduced when there is a real dependency/integration requirement.

Before starting a dependent task, the dependency state MUST be explicit.

The Phase 5 planning stage MUST define the dependency graph before implementation begins.

---

# 23. Task Planning Constraint

This specification defines **feature scope**, not the final task breakdown.

Before implementation begins, Phase 5 MUST have:

* Final task list
* Task dependencies
* Recommended implementation order
* Integration points
* Database migration boundaries
* Testing strategy per task
* Documentation requirements per task

Tasks SHOULD be independently verifiable wherever practical.

---

# 24. Expected Phase 5 Outcome

At the end of Phase 5, an agent should be able to:

```text
1. Find a customer
2. Understand the customer's ticket history
3. Open a ticket
4. See assignment, priority, workflow, and SLA state
5. Communicate with the customer
6. Add an internal note
7. Organize the ticket with tags
8. See important notifications
9. Work from a personal queue
10. Process multiple tickets efficiently
11. Attach relevant files where supported
```

The result should feel like a meaningful operational improvement over the Phase 4 ticket workflow.

---

# 25. Phase 5 Success Criteria

Phase 5 is successful when RelayDesk demonstrates that its Phase 4 workflow foundation can support practical daily helpdesk operations without requiring large platform infrastructure.

The phase should improve:

* Agent context
* Agent productivity
* Ticket organization
* Internal collaboration
* SLA awareness
* Operational visibility

while maintaining:

* Architectural consistency
* Data integrity
* Authorization boundaries
* Accessibility
* Responsive UX
* Test coverage
* Build stability

---

# 26. Scope Summary

| Area                          | Priority    | Phase 5 |
| ----------------------------- | ----------- | ------- |
| Customer / Contact Management | Must Have   | ✅       |
| Customer Ticket History       | Must Have   | ✅       |
| Internal Notes                | Must Have   | ✅       |
| Tags / Labels                 | Must Have   | ✅       |
| SLA Monitoring                | Must Have   | ✅       |
| My Queue / Agent Queue        | Must Have   | ✅       |
| In-App Notifications          | Must Have   | ✅       |
| Bulk Ticket Actions           | Should Have | ✅       |
| Attachments                   | Should Have | ✅       |
| Agent Workload                | Should Have | ⏸️      |
| SLA Policies                  | Should Have | ⏸️      |
| Advanced Analytics            | Should Have | ⏸️      |
| Team Management               | Should Have | ⏸️      |
| Workspace Settings            | Should Have | ⏸️      |
| Saved Views                   | Should Have | ⏸️      |
| Email Notifications           | Maybe       | ❌       |
| Knowledge Base                | Maybe       | ❌       |
| Automation                    | Later       | ❌       |
| Auto Assignment               | Later       | ❌       |
| Email-to-Ticket               | Later       | ❌       |
| Realtime                      | Later       | ❌       |
| OAuth                         | Later       | ❌       |
| Redis / Background Jobs       | Later       | ❌       |

---

## 27. Next Planning Step

Before implementation begins, the next planning activity is:

1. Break the eight scoped feature areas into concrete tasks.
2. Identify dependencies between tasks.
3. Determine database/schema boundaries.
4. Determine which tasks can be developed independently.
5. Determine integration points.
6. Define task-level acceptance criteria.
7. Define the recommended Git workflow.
8. Review the complete plan before implementation starts.

**Phase 5 implementation MUST NOT begin until this task breakdown and dependency plan have been reviewed and approved.**
