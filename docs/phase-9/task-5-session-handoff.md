# Phase 9 Task 5 — Session Handoff

**Project:** `~/Work/Projects/relaydesk`
**Branch:** `phase-9/task-5-integration-hardening`
**Baseline:** `d1a5dd7`
**Date:** 2026-11-01

> **Note (2026-11-06):** This is a HISTORICAL handoff from the `d1a5dd7`-era session. Its
> snapshots (git status, verification counts) are preserved as context and are superseded.
> The authoritative current status and the T5.1 closeout record live in
> [`docs/phase-9/task-5.md`](./task-5.md).

## 1. Current Git Status

> **Historical snapshot at baseline `d1a5dd7` — this was the working-tree state at the time
> of handoff, not the current repository state. Current status: see `task-5.md`.**

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

> **Historical snapshot (2026-11-01) — superseded.** The final, authoritative verification is
> the 126-file / 1736-test suite described in `task-5.md`.

- **Test files:** 118 passed
- **Tests:** 1691 passed, 0 failed
- **Errors:** 2 unhandled `ERR_INVALID_STATE` rejections from `ReadableStream` during `customer-attachments.api.test.ts` — Node.js/undici test-environment artifact when manually consuming `NextRequest` `FormData` bodies; does not affect runtime behavior.
- **Lint:** 0 errors, 0 warnings
- **Typecheck:** passes
- **Build:** passes

### Superseded ERR_INVALID_STATE interpretation — evidence-based correction (2026-11-06)

The original statement above ("does not affect runtime behavior") was an under-verified
assessment. The corrected, evidence-based account:

- The artifact's visibility is **version/runtime dependent**. At the time of handoff no
  cross-version investigation had been done.
- The **underlying undici implementation was not patched, and `route.ts` was not modified**.
  The upload route's existing `readFormDataWithLimit` (explicit `reader.cancel()` in its
  `finally` block) was left as-is; resolution happened through verification, configuration,
  and evidence — not through production code changes.
- Local verification on **Node 26.13.0 (undici 8.12.2)**: the real attachment API tests were
  run five times across default/strict rejection modes with the suppressor gated OFF; all
  passed (41/41) and no `ERR_INVALID_STATE` was reproduced.
- GitHub Actions **Node 22** strict attachment verification passed twice (Run #51, both
  attempts) while the suppressor still existed but was disabled, and again after removal
  (Run #52, post-suppressor `ef3d06a` — see `task-5.md` for details and links).

## 4. Two Outstanding Final-Review Items

> **Both items are now RESOLVED — full evidence trail in `task-5.md`.**

1. **Unhandled `ERR_INVALID_STATE` rejections — RESOLVED (2026-11-06).** The root-cause investigation superseded this open item:
   - Node's strict rejection semantics were investigated (in strict mode an unhandled
     rejection surfaces as `uncaughtException` before `unhandledRejection` is emitted).
   - Synthetic probes established the actual event behavior under Vitest's worker listeners.
   - The suppressor was made opt-in via `RELAYDESK_SUPPRESS_STREAM_REJECTIONS` and disabled
     by default (commit `81c9d19`), with a `--unhandled-rejections=strict` CI verification
     step added.
   - Strict attachment verification passed twice on Node 22 (Run #51) with the suppressor
     disabled, and local Node 26 runs passed in all tested modes.
   - The suppressor was then removed entirely (commit `ef3d06a`); the post-removal Node 22
     CI Run #52 passed.

2. **Untracked `storage/` directory — RESOLVED (2026-11-06).** `storage/` was added to `.gitignore` (`.gitignore:53`); the working tree is clean.

## 5. Delegated Audit Findings (preserved, not implemented — status as of handoff; reconciled 2026-11-06, see `task-5.md` and `task-5-audit-findings.md`)

- **Location:** `docs/phase-9/task-5-audit-findings.md`
- **Redis rate limiter:** 5 findings (1 HIGH, 2 MEDIUM, 2 LOW-MEDIUM) in `src/lib/rate-limit/redis-store.ts`, `src/lib/rate-limit/limiter.ts`, `src/lib/customer-access/rate-limit.ts` — **implemented 2026-11-01 in commit `02194b7`, shortly after this handoff was written** (see §7 for the honest sequencing note)
- **Customer email pipeline:** 7 findings (4 HIGH, 1 MEDIUM, 2 LOW) in `src/lib/queue/handlers/email-handler.ts`, `src/lib/queue/handlers/customer-email.ts`, `src/lib/customer-notifications/events.ts`, `src/lib/customer-notifications/email-content.ts` — **still outstanding** (re-verified against HEAD `ef3d06a`)
- **Upload concurrent resource exhaustion:** Finding F-1 (MEDIUM) added — no per-customer/IP rate limit or concurrent-upload throttle; 11 MiB max buffered body per request — **still outstanding**

## 6. Remaining Phase 9 Task 5 Objectives

> **Status note (2026-11-06):** T5.1 is now CLOSED (see `task-5.md`). Redis reliability
> (T5.2-scope) was completed in `02194b7`. The email pipeline findings E-1 through E-5, the
> separate Resend idempotency recommendation (E-REC-1), and upload finding F-1 remain open.

- T5.2–T5.5: Address Redis reliability, customer email pipeline, and upload rate-limiting findings.
- Finalize T5.1 closeout after the two outstanding items above are resolved.

## 7. Agreed Constraints

- Work exclusively on `phase-9/task-5-integration-hardening`; do not merge into `main`.
- Do not implement Redis/email findings until T5.1 is formally closed.
- Do not add a new rate limiter before Redis reliability findings are addressed.
- Preserve all existing security boundaries and accepted architecture.

> **Historical sequencing note (recorded 2026-11-06, neutrally):** The constraint above was
> NOT followed literally. Redis reliability findings R-1 through R-5 were implemented in
> commit `02194b7` (2026-11-01) BEFORE T5.1 was formally closed (closed after Step H, commit
> `ef3d06a`, and post-removal CI Run #52). This chronology is preserved for accuracy and is
> documented in `task-5.md` §7 — not rewritten or concealed. The email and upload findings
> remain unstarted, consistent with the spirit of the constraint.

## 8. Exact Next Action

> **Superseded (2026-11-06).** This handoff is historical context, not the authoritative
> current status. See [`docs/phase-9/task-5.md`](./task-5.md) for the authoritative record:
> T5.1 is CLOSED after Step H (suppressor removal) and Step I (documentation reconciliation);
> E-1 through E-5 and F-1 remain the future Task 5 work.
