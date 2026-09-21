# Phase 8 Task 2 — Automation Rule Management

Branch: `phase-8/task-2-rule-management`

Task 2 delivers rule management: a service layer, REST API, server actions, rule-builder dashboard page, multi-rule evaluator integration, condition-field catalog, and tests.

## Architecture

### Nullable FK + Execution History Preservation

`AutomationExecution.ruleId` is now **nullable** with `onDelete: SetNull`. When a rule is deleted (hard delete), its executions are **preserved** rather than cascaded away. Each execution retains a `ruleNameSnapshot` column that captures the rule's name at creation time — this keeps execution history readable even after the rule is gone (needed for Task 5 audit views).

```prisma
model AutomationExecution {
  ruleId          String?
  ruleNameSnapshot String
  rule             AutomationRule? @relation(fields: [ruleId], references: [id], onDelete: SetNull)
}
```

The unique constraint `@@unique([sourceEventId, ruleId])` continues to work because PostgreSQL treats NULLs as distinct — so deleted-rule executions don't collide.

### Migration

`prisma/migrations/20260922000000_add_rule_mgmt/migration.sql` performs a safe, ordered migration:

1. DROP existing FK `AutomationExecution_ruleId_fkey` (currently ON DELETE CASCADE)
2. ALTER `ruleId` DROP NOT NULL
3. ADD `ruleNameSnapshot` with temporary DEFAULT '' for backfill
4. Backfill snapshot from live rule relation
5. DROP temporary DEFAULT (Prisma declares no @default)
6. ADD new FK with ON DELETE SET NULL
7. ADD `priority` column + index on `AutomationRule`

### Deterministic Rule Ordering

Rules are ordered by `priority ASC, createdAt ASC, id ASC`. The `priority` field (integer, default 0) lets owners control evaluation order. Concurrent creates that compute the same `nextPriority` still produce deterministic final order via the `createdAt`/`id` tiebreakers.

### Race-Safe Rule Limit & Priority Allocation

`createRule` runs in a `SERIALIZABLE` transaction with P2034 serialization-failure retry (bounded, exponential backoff). This prevents two concurrent creates from both reading `count = 49` and both inserting. The `@@unique([workspaceId, name])` constraint is the backstop for name conflicts.

```typescript
await executeWithRetry(() =>
  prisma.$transaction(async (tx) => {
    const count = await tx.automationRule.count({ where: { workspaceId } });
    if (count >= MAX_RULES_PER_WORKSPACE) throw new RuleLimitReachedError();
    const maxRow = await tx.automationRule.aggregate({ _max: { priority: true }, where: { workspaceId } });
    const nextPriority = input.priority ?? ((maxRow._max.priority ?? -1) + 1);
    return tx.automationRule.create({ data: { ...input, priority: nextPriority, workspaceId } });
  }, { isolationLevel: 'Serializable' })
);
```

### Multi-Rule Evaluator

`handleAutomationEvaluation` in `src/lib/queue/handlers/automation.ts` now processes **all** matching rules (not just the first). Each matched rule gets its own `AutomationExecution`, keyed by `(sourceEventId, ruleId)` for idempotency.

Per-rule failure isolation:
- **Permanent failures** (validation, config, `InvalidTicketTransitionError`, P2002) → recorded on the execution, **not retried**, continue to next rule.
- **Transient failures** (P2034, P2024, P2028, network) → collected, bubble up as retryable overall failure. Already-succeeded rules are protected by idempotency.
- **Unknown/unexpected errors** → treated as transient (retryable) to avoid silent swallowing.

```typescript
function classifyRuleProcessingError(error: unknown): 'permanent' | 'transient' {
  if (isUniqueConstraintError(error)) return 'permanent';
  if (isPrismaError(error, 'P2034')) return 'transient';
  if (isPrismaError(error, 'P2024')) return 'transient';
  if (isPrismaError(error, 'P2028')) return 'transient';
  if (error instanceof InvalidTicketTransitionError) return 'permanent';
  if (error instanceof ZodError) return 'permanent';
  if (error instanceof RuleValidationError || error instanceof RuleReferencedResourceError) return 'permanent';
  // Network errors → transient
  // Unknown → transient (retryable)
  return 'transient';
}
```

### Trigger Payload Normalization

Each trigger type emits a normalized payload that carries all fields the condition evaluator can resolve. The condition-field catalog (`src/lib/automation/condition-fields.ts`) is the single source of truth — the UI only exposes fields that exist in the normalized payload.

| Trigger | Normalized fields |
|---|---|
| `ticket.created` | `ticketId`, `workspaceId`, `priority`, `status` (= "open"), `assignedToId` (= null), `customerId` (= null), `createdById` |
| `ticket.status_changed` | `ticketId`, `workspaceId`, `from`, `to`, `status` (= `to`) |
| `ticket.priority_changed` | `ticketId`, `workspaceId`, `from`, `to`, `priority` (= `to`) |
| `ticket.assigned` | `ticketId`, `workspaceId`, `assigneeId`, `previousAssigneeId` |
| `ticket.unassigned` | `ticketId`, `workspaceId`, `previousAssigneeId` |
| `ticket.tag_added` | `ticketId`, `workspaceId`, `tagId`, `tagName` |
| `ticket.tag_removed` | `ticketId`, `workspaceId`, `tagId`, `tagName` |
| `ticket.customer_linked` | `ticketId`, `workspaceId`, `customerId` |
| `ticket.customer_unlinked` | `ticketId`, `workspaceId`, `customerId` |
| `sla.at_risk` | `ticketId`, `workspaceId`, `slaType`, `assignedToId` |
| `sla.breached` | `ticketId`, `workspaceId`, `slaType`, `assignedToId` |

Enrichments to existing emitters:
- `createTicket` (`src/lib/tickets/server.ts`): now includes `priority`, `status`, `assignedToId`, `customerId`, `createdById` in the trigger payload.
- `updateTicket` status/priority/customer changes: now includes `status`/`priority`/`customerId` aliases (= `to`) alongside `from`/`to`.

### Condition Field Catalog

`CONDITION_FIELDS_BY_TRIGGER` maps each trigger type to its evaluable fields. Each field has:
- `field`: payload key
- `label`: human-readable UI label
- `type`: determines operators + value widget (`status`, `priority`, `agent`, `customer`, `tag`, `slaType`, `text`)
- `operators`: allowed operators for this field

**Important:** `customerId` uses a dedicated `customer` type (NOT `agent`) because customer and agent IDs come from different lookups.

## Files

### New

- `prisma/migrations/20260922000000_add_rule_mgmt/migration.sql` — safe migration
- `src/lib/automation/rules.ts` — domain service (CRUD, validation, reference checks)
- `src/lib/automation/rule-actions.ts` — server actions wrapper
- `src/lib/automation/condition-fields.ts` — condition field catalog
- `src/app/api/automation-rules/route.ts` — GET (member), POST (owner)
- `src/app/api/automation-rules/[id]/route.ts` — GET (member), PATCH (owner), DELETE (owner)
- `src/app/dashboard/automations/page.tsx` — server component (data fetching)
- `src/app/dashboard/automations/client-page.tsx` — client component (state, UI)
- `src/components/automations/rule-list.tsx` — ordered rule list with enable/disable/edit/delete
- `src/components/automations/rule-builder.tsx` — create/edit form with condition + action builder
- `src/components/automations/empty-state.tsx` — empty CTA
- `src/__tests__/automation.rules.service.test.ts` — service unit tests
- `src/__tests__/automation.rules.api.test.ts` — API route existence tests
- `src/__tests__/automation.rules.schema.test.ts` — schema validation tests (modified)
- `src/__tests__/automation.evaluator.multi-rule.test.ts` — multi-rule evaluator tests
- `src/__tests__/automation.condition-fields.test.ts` — condition field catalog tests

### Modified

- `prisma/schema.prisma` — `priority` on `AutomationRule`; `ruleId` nullable + `ruleNameSnapshot` on `AutomationExecution`; `onDelete: SetNull`
- `src/generated/prisma` — via `npx prisma generate`
- `src/lib/queue/handlers/automation.ts` — multi-rule + ordered load + `ruleNameSnapshot` + failure classification
- `src/lib/automation/schema.ts` — tightened validation with `triggerTypeSchema`, `conditionGroupSchema`, `automationActionConfigSchema`
- `src/lib/automation/actions/schema.ts` — added `automationActionConfigSchema` export
- `src/lib/automation/actions/types.ts` — `ActionContext.automationContext.ruleId: string | null`
- `src/lib/automation/actions/execution.ts` — `ruleId: string | null` in signatures
- `src/lib/automation/actions/handlers.ts` — `ruleId: string | null` in `emitAutomationEvent`
- `src/lib/automation/context.ts` — `ruleId?: string | null`
- `src/lib/automation/types.ts` — `AutomationContext.ruleId?: string | null`
- `src/lib/automation/execution-service.ts` — `CreateExecutionInput.ruleId: string | null` + `ruleNameSnapshot`
- `src/lib/automation/conditions.ts` — added `.max(10)` to condition group
- `src/lib/tickets/server.ts` — enriched `createTicket` payload; added `status`/`priority`/`customerId` aliases in `updateTicket`
- `src/components/dashboard/sidebar.tsx` — added Automations link
- `src/__tests__/automation.schema.test.ts` — updated to match new schema shapes

## API

### `GET /api/automation-rules`
Returns all rules for the workspace, ordered by priority. Readable by any member.

### `POST /api/automation-rules`
Creates a new rule. Owner-only. Body:
```json
{
  "name": "string (1-100 chars)",
  "description": "string (optional, max 500)",
  "triggerType": "ticket.created | ...",
  "conditions": { "conditions": [{ "field": "...", "operator": "equals|not_equals|is_set|is_not_set", "value": "..." }] },
  "actions": [{ "actionType": "assign|unassign|set-status|set-priority|add-tag|remove-tag|internal-note|notification", "actionConfig": {} }]
}
```

Error codes: 400 (validation), 401 (unauthorized), 403 (forbidden), 409 (name conflict / limit reached), 500 (unexpected).

### `GET /api/automation-rules/[id]`
Returns a single rule. Readable by any member.

### `PATCH /api/automation-rules/[id]`
Updates a rule. Owner-only. Supports partial updates. Use `{ "enabled": true|false }` for toggle.

### `DELETE /api/automation-rules/[id]`
Deletes a rule. Owner-only. Hard delete — execution history preserved via nullable FK + `ruleNameSnapshot`.

## Security

- Owner-only mutations via `assertWorkspaceOwner()` (existing pattern).
- Workspace isolation: all queries scoped by `workspaceId` from `getCurrentMembership()`.
- Never trust client-provided `workspaceId` — always derive from authenticated session.
- Never expose Prisma/internal stack traces — error mapping returns generic messages.
- Reference validation: `assigneeId`, `authorId`, `recipientId` must be workspace members; `tagId` must belong to workspace.

## Verification

```bash
npx prisma generate
npm run lint
npm run typecheck
npm test
npm run build
```

Manual (where DB available):
- Create rule as owner → 201
- Create rule as member → 403
- 50-rule limit → 409
- Name uniqueness → 409
- Reference validation rejects cross-workspace tag/member → 400
- Multi-rule execution creates one execution per matching rule in priority order
- Delete rule preserves its executions with `ruleNameSnapshot`
- Retry after transient failure does not duplicate succeeded rules
