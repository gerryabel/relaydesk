# Phase 9 Task 5 — Status & T5.1 Closeout Record

**Branch:** `phase-9/task-5-integration-hardening`
**Repository:** `gerryabel/relaydesk`
**Closeout date:** 2026-11-06
**Closeout HEAD:** `ef3d06a9514efaf0fb93e18eaa28126e0b5edb0f`
**Authoritative document.** Supersedes any conflict with the historical
[`task-5-audit-findings.md`](./task-5-audit-findings.md) and
[`task-5-session-handoff.md`](./task-5-session-handoff.md) (both retained, annotated, for their original context).

---

## 1. Task 5 status

- **T5.1 Integration Hardening: CLOSED (2026-11-06).**
  The closure was only granted after: (a) the ERR_INVALID_STATE suppressor was fully removed
  (Step H, commit `ef3d06a`), and (b) post-removal Node 22 CI Run
  [#52](https://github.com/gerryabel/relaydesk/actions/runs/42216589228) passed both jobs.
- **T5.2–T5.4 work remains OPEN.** The unresolved email-pipeline findings (E-1..E-5), the
  separate Resend idempotency recommendation, and upload finding F-1 are future work (§6, §8).
- **Closing T5.1 does NOT mean Phase 9 Task 5 is complete.** Only the integration-hardening
  subset (test discovery, stream-rejection verification, related CI validation) is closed.

## 2. T5.1 scope and outcome

**Test discovery expansion.** Vitest discovery was widened in `vitest.config.mjs` from
`src/__tests__/**/*.test.ts` to `src/**/*.test.ts`. The final inventory is **126 test files**:

| Group | Count |
|---|---|
| Root-level tests under `src/__tests__` | 119 |
| Database URL test under `src/__tests__/db` | 1 |
| Co-located tests under `src/lib` | 6 |

The three inventory manifests (`git ls-files`, `find src`, `vitest list --filesOnly`)
reconciled identically at 126 files with zero duplicates. All 126 files are executed by the
suite (Vitest reports `Test Files 126 passed (126)`).

**The six formerly excluded co-located tests** (`src/lib/email/errors.test.ts`,
`message.test.ts`, `provider.test.ts`, `providers/resend.test.ts`,
`queue/handlers/email-handler.test.ts`, `queue/handlers/email-handler.integration.test.ts`)
were **excluded from Vitest discovery before this task — they were not newly created**. They
ran after inclusion (23 tests, initially 22 passed / 1 failed due to a stale assertion).

**Stale assertion correction.** A one-line assertion fix in
`src/lib/queue/handlers/email-handler.integration.test.ts` aligned the test with the
production two-argument handler contract
`expect(handler).toHaveBeenCalledWith(emailEvent, { attempt: 0, maxAttempts: 3 })`,
matching `processOutboxJob`'s `handlerContext` (`src/lib/queue/worker.ts`, symbol
`OutboxHandlerContext`) and the maintained `src/__tests__/worker.process.test.ts`.
No production code changed.

**Final local verification: 126/126 files, 1736/1736 tests; zero failures; zero skips.**

## 3. ERR_INVALID_STATE investigation and suppressor lifecycle

Complete timeline:

1. **Commit `02194b7` (2026-11-01):** `feat(rate-limit): implement Redis reliability R-1 through R-5` — a temporary `unhandledRejection` suppressor was introduced into `src/__tests__/setup.ts` alongside the Redis work (it was added in the same commit as the oversized-413 attachment tests that exercised the stream lifecycle).
2. **Commit `81c9d19` (2026-11-06):** `test(ci): verify attachment lifecycle under strict rejections` — the suppressor was made **opt-in** via `RELAYDESK_SUPPRESS_STREAM_REJECTIONS === '1'` (**disabled by default**, the listener would be registered at all only when the variable equals `1`), and a strict-mode CI step (`NODE_OPTIONS=--unhandled-rejections=strict`) was added to the `redis-integration` job.
3. **Run [#51](https://github.com/gerryabel/relaydesk/actions/runs/42214118000) at `81c9d19`:** both attempts successful on Node 22; strict attachment test **41/41 on each attempt**; real Redis integration **8/8 on each attempt**. Run #51 validated strict behavior **while the suppressor existed but was disabled**.
4. **Local Node 26.13.0 verification (undici 8.12.2):** five real attachment API runs — default mode with suppression OFF twice, strict mode OFF twice, strict mode ON once. Each passed **41/41**; no unhandled errors surfaced.
5. **Commit `ef3d06a` (2026-11-06):** `chore(test): remove ERR_INVALID_STATE suppression after strict-mode verification` — the suppressor was **removed completely** from `src/__tests__/setup.ts`, the obsolete `RELAYDESK_SUPPRESS_STREAM_REJECTIONS` CI environment entry was deleted, and the strict rejection tripwire was **retained**. Deletion-only diff (26 lines removed, 0 added).
6. **Run [#52](https://github.com/gerryabel/relaydesk/actions/runs/42216589228) at `ef3d06a`:** Node 22 CI passed with **both** `quality` and `redis-integration` jobs succeeding; strict attachment test **41/41** and Redis integration **8/8**. Run #52 validated strict behavior **after the suppressor was removed entirely**.

**Key distinctions and limits of the findings:**

- **No actual `ERR_INVALID_STATE` reproduction occurred in the tested real attachment API
  flows** — neither locally on Node 26 (five runs, all modes) nor on CI Node 22 (four
  successful strict runs across both attempts of Run #51 and the Run #52 execution).
- The underlying undici internals were **not fixed or patched**. The production upload route
  `src/app/api/portal/[...]/attachments/route.ts` (symbol `readFormDataWithLimit`, which
  explicitly cancels the reader in a `finally` block) was **not modified**. Resolution was
  achieved through verification, opt-in gating, strict-mode CI validation, and final
  suppressor removal — **not** through production code changes.
- `ERR_INVALID_STATE` suppression semantics were validated with synthetic probes: strict mode
  surfaces an unhandled rejection as `uncaughtException` before `unhandledRejection` is
  emitted, meaning an `unhandledRejection`-registered suppressor cannot prevent strict-mode
  failures — which is exactly why the retained `NODE_OPTIONS=--unhandled-rejections=strict`
  is the effective regression tripwire.

## 4. Final verification matrix

| Environment | Verification | Result |
|---|---|---|
| Node 26.13.0 local | Full suite (default mode) | 126 files / 1736 tests passed |
| Node 26.13.0 local | Attachment default mode | 41/41 |
| Node 26.13.0 local | Attachment strict mode | 41/41 |
| Node 22 CI Run #51 | Attempt 1 and 2 | Both successful |
| Node 22 CI Run #51 | Attachment strict | 41/41 on each attempt |
| Node 22 CI Run #51 | Redis integration | 8/8 on each attempt |
| Node 22 CI Run #52 | Post-suppressor removal | Both jobs successful |
| Node 22 CI Run #52 | Attachment strict | 41/41 |
| Node 22 CI Run #52 | Redis integration | 8/8 |
| Local | Lint, typecheck, build | All passed |

**Permanent strict setting (retained in CI):** `NODE_OPTIONS=--unhandled-rejections=strict`

## 5. Redis reliability findings R-1 through R-5 — implemented

R-1 through R-5 were implemented in **commit `02194b7` (2026-11-01)**. They are **no longer
outstanding**. Evidence summary (details and original audit text in
[`task-5-audit-findings.md`](./task-5-audit-findings.md) §A):

| Finding | Evidence | Residual caveat |
|---|---|---|
| R-1 atomic increment + TTL | Lua script `INCR_WITH_TTL_SCRIPT` (`src/lib/rate-limit/redis-store.ts`): `INCR`, missing-TTL repair, and `PTTL` return in one atomic execution, replacing the separate `INCR` + `EXPIRE` round-trips | — |
| R-2 Retry-After from real TTL | `consumeRateLimit` (`src/lib/rate-limit/limiter.ts`) derives `retryAfterSeconds` from the store-returned `ttlSeconds` (tightest window retained) | — |
| R-3 missing-TTL repair | `TTL == -1` triggers `EXPIRE` inside the same script; repaired on every increment | — |
| R-4 shared-fallback bucket | `readClientIp` (`src/lib/customer-access/rate-limit.ts`): `unknown:<sha256(user-agent) prefix>` entropy fallback | **Documented limitation intentionally stands:** user-agent identity is spoofable and shared — increased entropy, **not** per-user isolation; workspace-email/workspace-level limits remain the primary abuse protections |
| R-5 permanent degradation | `DEGRADED_RETRY_INTERVAL_MS = 30_000`; recovery only after a stable window of consecutive healthcheck successes (`REQUIRED_HEALTHCHECK_SUCCESSES`), single-flight probes | — |

Test evidence: `src/__tests__/rate-limit.redis.real.test.ts` (real Redis, executes the actual
Lua script through `ioredis.eval`; TTL/repair/PTTL behaviors asserted) and
`src/__tests__/customer-access.unit.test.ts`. Verified continuously by CI Run #51/#52 (8/8).

## 6. Remaining outstanding findings — NOT addressed by T5.1

None of the following was implemented or resolved by the Redis work or the T5.1 closeout.
Each was re-verified against HEAD `ef3d06a` on 2026-11-06 and remains open:

- **E-1 (HIGH):** in `src/lib/queue/handlers/email-handler.ts` (`processOutboxJob` send
  block), `sendEmail` success is followed immediately by `markEmailSent(event.id)`; if the
  mark fails, the claim is released and the event retry can duplicate a real delivery.
- **E-2 (HIGH):** the equivalent send-success / mark-SENT-failure gap exists in
  `src/lib/queue/handlers/customer-email.ts`.
- **E-3 (HIGH):** the existing SENT recheck does **not** guarantee correctness when the
  event is not `SENT` — the claim-collision branch still falls through to
  `return { status: 'success' }` without a SENT record, a potential **email-loss** path.
- **E-4 (HIGH):** a customer-email claim collision returns a success path
  (`src/lib/queue/handlers/customer-email.ts`) with no recheck at all.
- **E-5 (MEDIUM):** stale send-claim recovery still uses the five-minute threshold
  (`STALE_SEND_CLAIM_MS`, `src/lib/queue/handlers/email-handler.ts:11`).
- **E-REC-1 (separate recommendation):** the Resend provider
  (`src/lib/email/providers/resend.ts`) does not use an `Idempotency-Key`. Kept deliberately
  separate from — not a substitute for — the E-1/E-2 fixes.
- **F-1 (MEDIUM):** no per-customer/IP upload throttle or concurrency guard exists in the
  customer portal upload route (`src/app/api/portal/[...]/attachments/route.ts`); it performs
  payload-size validation only. R-1..R-5 (its stated dependency) are now complete, so F-1 is
  ready to build on a trustworthy rate-limiter store.

## 7. Historical sequence and scope note (transparent)

- **Redis R-1..R-5 were implemented in commit `02194b7` (2026-11-01) BEFORE T5.1 formal
  closure (2026-11-06)** — contrary to the earlier session-handoff constraint that said not
  to implement findings before T5.1 was formally closed. This chronology is recorded here and
  in the handoff document, **not rewritten or concealed**.
- **T5.1 closure covers only:** integration hardening, test-discovery expansion, the
  ERR_INVALID_STATE investigation/suppressor lifecycle, the associated CI strict validation,
  and this documentation reconciliation.
- **No email-pipeline or upload-throttling work was done** as part of this closeout.

## 8. Follow-up work

Mapping the unresolved findings to the existing project plan (no new phase names or
acceptance criteria are invented here):

- **Email pipeline hardening** (T5.2/T5.3 work as referenced by
  `task-5-audit-findings.md` §B and the handoff §6): resolve E-1 through E-5 with the
  bounded-wait/polling approach recommended in the audit, keeping the E-1 vs E-2 (two
  handlers) and E-3 vs E-4 (recheck present absent) distinctions from §6.
- **Upload throttling / concurrency protection** (T5.4-style work, audit finding F-1):
  add per-customer/IP request caps and a concurrency guard around the attachment storage
  path, now unblocked by the R-1..R-5 store reliability.
- **Provider idempotency review** (E-REC-1, run alongside the email work): introduce
  and persist an `Idempotency-Key` in the Resend provider as defense-in-depth.

## 9. Related documents and evidence

- [`task-5-audit-findings.md`](./task-5-audit-findings.md) — original delegated audit (R/E/F findings), now annotated with remediation statuses
- [`task-5-session-handoff.md`](./task-5-session-handoff.md) — historical handoff from the `d1a5dd7` era, annotations added
- [`spec.md`](./spec.md) #9 "Task 5 — Integration Hardening" — requirements source for this task
- CI Run [#51](https://github.com/gerryabel/relaydesk/actions/runs/42214118000) — strict validation, suppressor disabled
- CI Run [#52](https://github.com/gerryabel/relaydesk/actions/runs/42216589228) — validation after suppressor removal (closure-gating run)
- Commits: `02194b7` (R-1..R-5 implementation), `81c9d19` (opt-in gate + strict CI), `ef3d06a` (suppressor removal)
