# Phase 9 Task 5 — Session Handoff

**Project:** `~/Work/Projects/relaydesk`
**Branch:** `phase-9/task-5-integration-hardening`
**Baseline:** `d1a5dd7`
**Date:** 2026-11-01

## 1. Current Git Status

```
M  src/__tests__/customer-attachments.api.test.ts
 M src/__tests__/customer-attachments.integration.test.ts
 M src/__tests__/customer-portal.integration.test.ts
 M src/app/api/attachments/[id]/route.ts
 M src/app/api/portal/[workspaceSlug]/tickets/[ticketId]/messages/[messageId]/attachments/route.ts
 M src/components/portal/customer-reply-form.tsx
 M src/lib/attachments/service.ts
 M src/lib/customer-portal/actions.ts
?? docs/phase-9/task-5-audit-findings.md
?? src/__tests__/attachments.transport.test.ts
?? storage/
```

8 modified files, 3 untracked paths (2 files + 1 directory).

## 2. T5.1 Completed Architecture

- Split Server Action and attachment API: reply creation returns `messageId`; client uploads files individually to bounded API.
- Streaming byte counter (`readFormDataWithLimit`) in portal attachments route: 11 MiB limit enforced via `request.body.getReader()`; returns HTTP 413.
- Explicit `reader.cancel()` on limit exceed and in `finally` block.
- Server-side 10-attachment limit: transactional `SELECT ... FOR UPDATE` + `assertAttachmentCapacityUnderLock` in `src/lib/customer-portal/attachments.ts:267-311`.
- Message ID exposure accepted as documented exception; authorization re-validated on every upload.
- Internal download hardened: filename sanitization, MIME normalization, `Content-Length` header.
- Transport regression tests: `src/__tests__/attachments.transport.test.ts` (7 tests).

## 3. Latest Verification

- **Test files:** 118 passed
- **Tests:** 1691 passed, 0 failed
- **Errors:** 2 unhandled `ERR_INVALID_STATE` rejections from `ReadableStream` during `customer-attachments.api.test.ts` — Node.js/undici test-environment artifact when manually consuming `NextRequest` `FormData` bodies; does not affect runtime behavior.
- **Lint:** 0 errors, 0 warnings
- **Typecheck:** passes
- **Build:** passes

## 4. Two Outstanding Final-Review Items

1. **Unhandled `ERR_INVALID_STATE` rejections**  
   Investigate root cause, including strict unhandled-rejection testing. Likely related to manual `NextRequest` body consumption in tests vs. undici stream lifecycle.

2. **Untracked `storage/` directory**  
   Inspect contents without deleting or modifying anything. Determine whether it is test artifact, local dev storage, or should be gitignored/cleaned.

## 5. Delegated Audit Findings (preserved, not implemented)

- **Location:** `docs/phase-9/task-5-audit-findings.md`
- **Redis rate limiter:** 5 findings (1 HIGH, 2 MEDIUM, 2 LOW-MEDIUM) in `src/lib/rate-limit/redis-store.ts`, `src/lib/rate-limit/limiter.ts`, `src/lib/customer-access/rate-limit.ts`
- **Customer email pipeline:** 7 findings (4 HIGH, 1 MEDIUM, 2 LOW) in `src/lib/queue/handlers/email-handler.ts`, `src/lib/queue/handlers/customer-email.ts`, `src/lib/customer-notifications/events.ts`, `src/lib/customer-notifications/email-content.ts`
- **Upload concurrent resource exhaustion:** Finding F-1 (MEDIUM) added — no per-customer/IP rate limit or concurrent-upload throttle; 11 MiB max buffered body per request.

## 6. Remaining Phase 9 Task 5 Objectives

- T5.2–T5.5: Address Redis reliability, customer email pipeline, and upload rate-limiting findings.
- Finalize T5.1 closeout after the two outstanding items above are resolved.

## 7. Agreed Constraints

- Work exclusively on `phase-9/task-5-integration-hardening`; do not merge into `main`.
- Do not implement Redis/email findings until T5.1 is formally closed.
- Do not add a new rate limiter before Redis reliability findings are addressed.
- Preserve all existing security boundaries and accepted architecture.

## 8. Exact Next Action

Finish T5.1 final verification by:
1. Investigating and resolving or documenting the 2 `ERR_INVALID_STATE` rejections.
2. Inspecting the untracked `storage/` directory.
3. Running full verification again.
4. Only then mark T5.1 complete and proceed to subsequent implementation.
