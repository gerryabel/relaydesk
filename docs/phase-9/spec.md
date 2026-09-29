# RelayDesk Phase 9 — Customer Portal & Communication

**Version:** v0.7.0-alpha
**Status:** Draft / Planning
**Scope:** Phase 9
**Document:** `docs/phase-9/spec.md`

---

# 1. Overview

Phase 8 completed the automation and SLA operations foundation:

* Automation Rule Management
* Automation Action Execution
* Configurable SLA Policies
* Automation Execution History
* Retry-safe automation operations
* Operational hardening

The next logical product boundary is to extend RelayDesk from an internal support workspace into a system where **customers can securely participate in their own support conversations**.

The current RelayDesk domain already contains a `Customer` entity associated with a workspace and tickets. However, customer access is not yet treated as a separate authenticated actor model.

Phase 9 therefore establishes the customer-facing side of RelayDesk without merging customer identity into workspace membership.

The phase focuses on:

1. secure customer access;
2. customer ticket management;
3. customer ↔ agent conversation;
4. customer-visible email notifications;
5. customer message attachments;
6. security and isolation hardening.

The phase MUST reuse the existing:

* Customer entity
* Ticket domain
* Message domain
* workspace authorization
* transactional outbox
* Redis/BullMQ
* email abstraction
* attachment storage
* ticket workflow
* SLA calculations
* existing notification infrastructure where applicable

Phase 9 MUST NOT become an omnichannel communication platform.

---

# 2. Phase Goal

> **Give every RelayDesk workspace a secure customer-facing support portal where customers can create and follow their own tickets, communicate with support agents, and receive reliable customer-visible notifications without gaining access to workspace-internal data.**

The end state should support:

```text
Customer
   ↓
Customer Portal
   ↓
Create / View Ticket
   ↓
Conversation
   ↕
Support Agent
   ↓
Customer Email Notification
```

The customer must remain outside the workspace membership and authorization model used by owners and agents.

---

# 3. Core Principles

## 3.1 Customer Is Not a Workspace Member

Customers are external parties.

They MUST NOT become:

* workspace owners
* workspace members
* agents
* administrators
* participants in workspace membership authorization

Customer access MUST be governed by a separate customer-access mechanism.

---

## 3.2 Existing Customer Entity Remains the Domain Source

The existing `Customer` entity should remain the primary customer domain record.

Phase 9 should extend it with access/session capabilities rather than creating a second customer profile system.

A customer identity MUST remain workspace-scoped.

A customer with the same email address in two different workspaces represents two independently authorized customer relationships unless an explicit future cross-workspace identity system is introduced.

Cross-workspace customer identity is outside Phase 9.

---

## 3.3 Customer Authorization Must Be Server-Side

The client MUST NOT be trusted for:

* customer ID
* workspace ID
* ticket ownership
* message ownership
* attachment ownership
* authorization state

Every customer-facing resource lookup MUST derive authorization from the authenticated customer session.

---

## 3.4 Customer Can Only See Customer-Visible Data

Customers MUST NEVER see:

* internal notes
* workspace members
* agent workload
* automation configuration
* automation execution history
* internal notifications
* operational analytics
* SLA configuration
* infrastructure diagnostics
* internal error details

Customer-visible ticket history must be explicitly derived rather than returning arbitrary internal ticket data.

---

## 3.5 Reuse Existing Background Infrastructure

Customer email notifications MUST use the existing:

```text
Database Transaction
      ↓
Transactional Outbox
      ↓
Dispatcher
      ↓
BullMQ
      ↓
Worker
      ↓
Email Provider
```

The user-facing request MUST NOT depend on immediate email delivery.

No second queue or notification worker may be introduced.

---

## 3.6 Messages Need Explicit Actor Semantics

The current message model is centered around application users.

Phase 9 MUST introduce explicit customer-message semantics rather than abusing workspace-user relationships.

The system MUST be able to distinguish:

```text
Agent message
Customer message
System-generated communication
```

This distinction MUST remain durable and queryable.

---

## 3.7 Internal Notes Remain Internal

Customer messages and internal notes MUST remain separate domain concepts.

A customer MUST never be able to:

* create an internal note;
* read an internal note;
* modify an internal note;
* infer internal-note contents from API responses.

---

# 4. Phase 9 Scope

Phase 9 consists of five feature areas:

1. Customer Access Foundation
2. Customer Portal
3. Customer Conversation & Email Communication
4. Customer Attachments
5. Integration Hardening

---

# 5. Task 1 — Customer Access Foundation

## Goal

Establish secure authentication and session handling for external customers.

## In Scope

* customer portal authentication;
* passwordless customer access;
* customer session model;
* customer session creation and expiration;
* logout;
* session revocation;
* workspace-scoped customer access;
* secure customer access tokens;
* customer portal route protection;
* rate limiting for access requests;
* secure cookie/session handling.

## Recommended Authentication Model

Phase 9 SHOULD use:

```text
Customer enters email
        ↓
Workspace/customer access request
        ↓
One-time magic-link token
        ↓
Customer verifies link
        ↓
Secure customer session
        ↓
Customer portal
```

Passwords are not required for Phase 9.

Magic-link tokens MUST:

* expire;
* be single-use;
* be stored hashed where practical;
* become invalid after successful consumption;
* not expose the raw token through application logs;
* be rate-limited;
* not reveal whether a customer exists when responding to unauthenticated requests.

## Workspace Entry

The customer portal MUST use a non-sensitive public workspace identifier.

The system MUST NOT require internal membership IDs as customer-facing identifiers.

A workspace public slug or equivalent stable public identifier SHOULD be introduced.

## Out of Scope

* OAuth customer login;
* social login;
* enterprise SSO;
* customer workspace switching;
* customer role system;
* customer administration.

---

# 6. Task 2 — Customer Portal

## Goal

Allow authenticated customers to manage their own support requests.

## In Scope

### Ticket List

Customers may see tickets belonging to their customer identity.

The list SHOULD support:

* ticket number;
* title;
* status;
* priority where appropriate;
* last activity;
* creation date;
* basic search/filtering where useful.

Customers MUST NOT see tickets belonging to another customer.

### Create Ticket

Customers may create a ticket containing:

* subject/title;
* description;
* supported attachments.

The customer identity is derived from the authenticated session.

The client MUST NOT supply an arbitrary `customerId`.

Default behavior SHOULD remain consistent with the existing ticket system:

* status defaults to `open`;
* priority defaults to the existing customer-safe default;
* workspace is derived from the portal context;
* SLA deadlines use the existing workspace SLA policy.

Customers SHOULD NOT directly control:

* assignee;
* internal priority escalation;
* internal SLA policy;
* internal workflow state beyond supported customer-visible actions.

### Ticket Detail

Customers may see:

* ticket number;
* title;
* status;
* customer-visible conversation;
* customer-visible timestamps;
* supported attachments;
* allowed customer actions.

Customers MUST NOT see:

* internal notes;
* internal automation state;
* worker state;
* internal audit metadata;
* agent-only operational fields.

### Customer Actions

Supported actions:

* send a reply;
* add attachments;
* view current status.

Customer-side ticket deletion is out of scope.

---

# 7. Task 3 — Customer Conversation & Email Communication

## Goal

Create a durable customer ↔ support conversation model while reusing the existing message and email infrastructure.

## In Scope

### Customer Messages

Customers may reply to tickets.

Every customer reply MUST:

* belong to the correct ticket;
* belong to the authenticated customer;
* be workspace-scoped through the ticket;
* create a durable message;
* be visible to authorized agents;
* remain invisible to unrelated customers.

### Agent Messages

Agent replies remain visible to the customer when they are customer-visible messages.

Internal notes remain excluded.

The UI MUST clearly distinguish:

```text
Customer reply
Agent reply
Internal note
```

### Message Author Model

The message domain SHOULD support explicit authorship such as:

```text
authorType = customer | agent | system
```

The persisted model MUST retain enough information to identify the customer author without pretending the customer is a workspace `User`.

The exact schema design may use:

* a nullable `createdById` for agent users;
* a nullable `customerId` for customer authors;
* an explicit author type;
* validation preventing invalid combinations.

The final design MUST be determined during Task 1 planning.

---

## Customer Email Notifications

Customer-visible communication SHOULD support asynchronous email for events such as:

* agent reply;
* relevant ticket status change;
* ticket creation confirmation where useful.

The notification pipeline MUST reuse:

```text
Outbox
→ BullMQ
→ Worker
→ Email abstraction
```

Email delivery MUST be:

* asynchronous;
* retryable;
* idempotent;
* workspace-safe;
* customer-safe.

The customer email MUST contain only customer-visible information.

Internal notes, workspace details, internal IDs, automation configuration, and stack traces MUST never be included.

---

## Email Scope Boundary

Phase 9 sends email **to customers**.

Phase 9 does NOT support replying to that email to continue the ticket.

That capability requires inbound email processing and is deferred.

---

# 8. Task 4 — Customer Attachments

## Goal

Extend the existing attachment infrastructure so customers can securely attach files to customer-visible messages.

## In Scope

* customer attachment upload;
* attachment metadata;
* attachment authorization;
* customer-visible attachment download;
* file type validation;
* file size validation;
* safe filename handling;
* workspace/ticket/customer ownership checks;
* reuse of existing storage abstraction.

## Security Requirements

A customer MUST NOT be able to download an attachment merely by knowing its ID.

Attachment authorization MUST derive from:

```text
Authenticated Customer
        ↓
Owned Ticket
        ↓
Customer-visible Message
        ↓
Attachment
```

Internal-only attachments remain outside customer visibility.

## Out of Scope

* virus scanning infrastructure;
* image processing;
* previews;
* advanced document indexing;
* object-storage administration;
* file versioning.

---

# 9. Task 5 — Integration Hardening

## Goal

Make customer-facing communication safe and consistent with the existing RelayDesk architecture.

## In Scope

### Workspace Isolation

Test:

* customer cannot access another workspace;
* customer cannot access another customer's ticket;
* customer cannot access another customer's message;
* customer cannot access another customer's attachment;
* customer cannot use manipulated route parameters to cross boundaries.

### Authentication Security

Test:

* expired magic links;
* consumed magic links;
* invalid tokens;
* session expiration;
* logout;
* token replay;
* rate limiting;
* enumeration-resistant access responses.

### Message Visibility

Test:

* customer-visible agent messages appear;
* internal notes never appear;
* unrelated messages never appear;
* customer replies appear to authorized agents;
* customer replies do not become internal notes.

### Email Safety

Test:

* only customer-visible content is serialized;
* email retries do not duplicate sends;
* email failure does not roll back the ticket/message transaction;
* workspace and recipient data remain correct.

### Attachments

Test:

* unauthorized customer download is rejected;
* cross-workspace access is rejected;
* internal attachment access is rejected;
* invalid file types/sizes are rejected.

---

# 10. Data Model Expectations

The current `Customer` model remains the central customer entity.

Potential additional models:

## CustomerSession

Conceptual fields:

* id
* customerId
* workspaceId
* tokenHash
* expiresAt
* createdAt
* revokedAt
* lastUsedAt

The session MUST be workspace-scoped.

---

## CustomerAccessToken

Conceptual fields:

* id
* customerId
* workspaceId
* tokenHash
* expiresAt
* consumedAt
* createdAt

The raw access token MUST NOT be persisted in plaintext.

---

## Workspace Public Identifier

The workspace SHOULD gain a public identifier such as:

```text
slug
```

This identifier is intended for customer-facing portal routing.

It MUST be unique among workspaces.

---

## Message Extension

The message model SHOULD support customer authors.

Conceptually:

```text
Message
├── ticketId
├── createdById?       → workspace User
├── customerId?        → Customer
├── authorType
├── body
└── createdAt
```

A message MUST represent exactly one valid author category.

Invalid combinations MUST be rejected server-side.

---

## Ticket

The existing:

```text
Ticket.customerId
```

relationship remains the ownership boundary for customer-facing ticket access.

No second customer-ticket relationship should be introduced.

---

# 11. Authorization Model

Phase 9 introduces two distinct authorization domains:

```text
Workspace User
    ↓
Workspace Membership
    ↓
Owner / Member permissions


Customer
    ↓
Customer Session
    ↓
Owned Customer
    ↓
Owned Tickets
```

These domains MUST NOT be merged.

A customer session MUST NOT satisfy workspace membership checks.

A workspace user session MUST NOT automatically gain customer portal capabilities merely by knowing a customer ID.

The server MUST explicitly authorize each domain.

---

# 12. API / Route Expectations

Customer-facing routes SHOULD follow a clear public namespace.

Conceptual examples:

```text
/portal/{workspaceSlug}
/portal/{workspaceSlug}/login
/portal/{workspaceSlug}/tickets
/portal/{workspaceSlug}/tickets/{ticketId}
```

The exact route structure may follow existing RelayDesk conventions.

The route layer MUST:

1. resolve the workspace public identifier;
2. validate customer session;
3. resolve authenticated customer;
4. authorize resource ownership;
5. validate input with Zod;
6. call the customer domain service.

Client-side route restrictions MUST NOT be treated as security.

---

# 13. UI / UX Requirements

The customer portal MUST have:

* dedicated customer-facing layout;
* clear workspace identity;
* authentication state;
* loading state;
* empty state;
* error state;
* accessible forms;
* keyboard accessibility;
* visible focus states;
* responsive behavior;
* clear ticket status;
* clear conversation author labels;
* clear attachment status.

The customer portal SHOULD feel distinct from the internal workspace dashboard while retaining RelayDesk's visual language.

The customer must never encounter internal terminology such as:

* automation execution;
* worker lease;
* outbox event;
* membership role;
* internal audit state.

---

# 14. Email UX

Customer emails SHOULD include:

* workspace name;
* ticket number;
* concise event description;
* customer-visible message/status information;
* secure link back to the customer portal.

Emails MUST NOT depend on exposing internal ticket IDs.

Customer email links SHOULD resolve through stable customer-facing identifiers.

The email notification system SHOULD reuse the existing provider abstraction and sender configuration.

---

# 15. Testing Requirements

## Unit Tests

Required for:

* customer session validation;
* token expiration;
* token consumption;
* customer authorization;
* ticket ownership;
* message author validation;
* customer visibility filtering;
* email payload construction;
* attachment authorization.

## Integration Tests

Required for:

* customer login flow;
* ticket creation;
* ticket ownership;
* customer reply;
* agent reply visibility;
* internal-note isolation;
* cross-workspace isolation;
* customer email notification creation;
* email outbox behavior;
* attachment access;
* session expiration;
* token replay prevention.

## Regression

Existing Phase 2–8 tests MUST remain passing.

In particular:

* ticket workflow;
* workspace isolation;
* attachments;
* email delivery;
* outbox;
* BullMQ;
* automation;
* SLA;
* retry/idempotency;
* operational execution history

must remain stable.

---

# 16. Performance Requirements

The customer portal SHOULD:

* avoid N+1 ticket/message queries;
* paginate customer ticket history;
* paginate long conversations where practical;
* avoid loading internal data only to discard it at presentation time;
* query only the authenticated customer's workspace/tickets;
* reuse indexed `Customer` and `Ticket` relationships;
* keep email delivery asynchronous.

Customer routes MUST NOT perform broad workspace queries merely to determine ownership.

---

# 17. Security Requirements

Phase 9 is security-sensitive because it creates an external-facing authorization boundary.

The implementation MUST:

* never trust client-supplied customer IDs;
* never trust client-supplied workspace IDs;
* protect customer sessions;
* prevent session/token replay;
* prevent cross-workspace access;
* prevent cross-customer ticket access;
* prevent internal-note leakage;
* prevent attachment leakage;
* prevent internal error leakage;
* avoid exposing internal resource IDs where unnecessary;
* rate-limit authentication attempts;
* keep customer email enumeration-resistant where practical;
* preserve existing workspace isolation.

Any security ambiguity is a stop condition under the project workflow.

---

# 18. Phase 9 Non-Goals

The following remain outside Phase 9:

## Inbound Email

* email-to-ticket;
* inbound email webhooks;
* email reply threading;
* email MIME parsing;
* email quote stripping;
* email attachment ingestion;
* email spoofing protection;
* email conversation synchronization.

These should be considered for a dedicated future Email Channel phase.

## Knowledge & Self-Service

* knowledge base;
* article search;
* customer FAQ;
* AI knowledge retrieval;
* suggested articles;
* customer self-service resolution flows.

## Omnichannel

* SMS;
* WhatsApp;
* Telegram;
* Discord;
* social channels;
* voice;
* live chat infrastructure.

## Advanced Identity

* OAuth customer login;
* customer SSO;
* organization accounts;
* customer teams;
* customer role systems.

## Billing / Commercial Features

* subscriptions;
* billing;
* plans;
* usage metering.

## Advanced Automation

* customer-triggered automation graphs;
* automation chains;
* arbitrary customer webhooks;
* arbitrary HTTP actions;
* AI-generated automation.

Phase 8 automation remains bounded and must not be expanded silently into Phase 9.

---

# 19. Task Planning

Phase 9 consists of five tasks.

## Task 1 — Customer Access Foundation

Responsibilities:

* customer portal authentication;
* passwordless access;
* customer sessions;
* public workspace identifier;
* security boundaries;
* authentication tests.

Dependency: none.

---

## Task 2 — Customer Portal

Responsibilities:

* customer ticket list;
* customer ticket creation;
* ticket detail;
* customer-visible ticket state;
* customer authorization;
* portal UI.

Dependency: Task 1.

---

## Task 3 — Customer Conversation & Email

Responsibilities:

* customer replies;
* customer/agent message authorship;
* customer-visible message filtering;
* asynchronous customer email notifications;
* outbox integration;
* idempotent email delivery.

Dependency: Tasks 1–2.

---

## Task 4 — Customer Attachments

Responsibilities:

* customer message attachments;
* attachment authorization;
* customer download;
* upload validation;
* storage integration;
* attachment tests.

Dependency: Task 3.

---

## Task 5 — Customer Integration Hardening

Responsibilities:

* security review;
* workspace-isolation review;
* regression testing;
* email reliability verification;
* UX/accessibility review;
* performance review;
* operational documentation;
* final independent verification.

Dependency: Tasks 1–4.

---

# 20. Dependency Graph

```text
Task 1 — Customer Access Foundation
        │
        ▼
Task 2 — Customer Portal
        │
        ▼
Task 3 — Customer Conversation & Email
        │
        ▼
Task 4 — Customer Attachments
        │
        ▼
Task 5 — Customer Integration Hardening
```

The sequence is intentionally linear because the customer authorization boundary should be established before exposing customer-owned resources.

---

# 21. Definition of Done

Phase 9 is complete when:

* customer authentication exists;
* customer sessions are secure;
* customers can create tickets;
* customers can view only their own tickets;
* customers can reply to tickets;
* agents can see customer replies;
* customers can see customer-visible agent replies;
* internal notes remain completely private;
* customer email notifications use the existing outbox/BullMQ infrastructure;
* customer attachments are securely authorized;
* workspace isolation remains enforced;
* cross-customer access is rejected;
* regression tests pass;
* `npm run lint` passes with 0 warnings/errors;
* `npm run typecheck` passes;
* `npm test` passes;
* `npm run build` passes;
* documentation is updated;
* independent verification is completed;
* the working tree is clean.

---

# 22. Success Criteria

Phase 9 is successful when RelayDesk supports the complete customer-facing workflow:

```text
Customer
   │
   ▼
Customer Portal Login
   │
   ▼
Create Ticket
   │
   ▼
Support Workspace
   │
   ▼
Agent Reply
   │
   ├───────────────► Customer Email
   │
   ▼
Customer Portal
   │
   ▼
Customer Reply
   │
   ▼
Agent Workspace
```

The customer must experience a coherent support system without receiving access to internal workspace operations.

The support team must continue using the same ticket, authorization, outbox, worker, email, SLA, attachment, and automation foundations.

---

# 23. Explicit Phase Boundary

Phase 9 deliberately establishes the **customer-facing support loop**.

The product progression becomes:

```text
Foundation
    ↓
Helpdesk
    ↓
Workflow
    ↓
Operations
    ↓
Workspace
    ↓
Insight
    ↓
Automation
    ↓
Customer Portal & Communication
```

The next likely expansion after Phase 9 is a dedicated communication-channel phase, potentially including:

* email-to-ticket;
* inbound email processing;
* email threading;
* knowledge base;
* richer self-service;
* additional communication channels.

These must be evaluated separately rather than silently expanding Phase 9.

---

# 24. Planning Status

This document is a Phase 9 planning baseline.

It does NOT authorize implementation by itself.

Before implementation:

1. review this specification;
2. confirm or amend the phase goal;
3. confirm the customer authentication model;
4. finalize task-level acceptance criteria;
5. inspect the current implementation against each task;
6. determine the exact schema changes;
7. determine the exact route/API boundaries;
8. create the task branch from the latest completed baseline;
9. produce the task-specific implementation plan;
10. obtain explicit approval before code changes.

Phase 9 should be treated as a planned `v0.7.0-alpha` milestone and remains subject to revision before implementation begins.

