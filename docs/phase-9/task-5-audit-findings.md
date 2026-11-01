# Phase 9 Task 5 — Delegated Audit Findings

**Baseline:** `d1a5dd7`  
**Branch:** `phase-9/task-5-integration-hardening`  
**Date:** 2026-11-01  
**Status:** READ-ONLY AUDIT — findings preserved for later remediation

---

## A. Redis Rate Limiter Audit

**Subagent role:** Security Reviewer (read-only)  
**Files inspected:**
- `src/lib/rate-limit/redis-store.ts`
- `src/lib/rate-limit/limiter.ts`
- `src/lib/customer-access/rate-limit.ts`

**Tests executed:** `npm test -- --run src/__tests__/customer-access*` → 65 passed, 0 failed. Tests do not cover the findings below.

### Finding R-1: Non-atomic INCR + EXPIRE leaves keys without TTL on crash
- **Severity:** HIGH
- **File:** `src/lib/rate-limit/redis-store.ts`
- **Lines:** 31, 39–41
- **Evidence:**
  ```ts
  const count = Number(await redis.incr(fullKey));
  if (count === 1) {
    await redis.expire(fullKey, windowSeconds);
  }
  ```
  Two separate round-trips. If the process crashes after `INCR` returns 1 but before `EXPIRE`, the counter key persists indefinitely.
- **Failure scenario:** An attacker triggers a burst of requests. The first request creates the key, the process crashes, and the key never expires — permanently blocking that bucket.
- **Status:** Confirmed by code inspection. No reproducing test exists.
- **Recommended remediation:** Use `SET key value NX EX seconds` (atomic set-if-not-exists with TTL) instead of separate `INCR` + `EXPIRE`.

### Finding R-2: Retry-After returns full window duration instead of remaining TTL
- **Severity:** MEDIUM
- **File:** `src/lib/rate-limit/limiter.ts`
- **Line:** 76
- **Evidence:**
  ```ts
  rejection = {
    allowed: false,
    limitedBy: rule,
    retryAfterSeconds: rule.windowSeconds,
  };
  ```
  The comment states the value should be "seconds until the tightest exhausted window resets", but no Redis `TTL` is queried. A request arriving 9 minutes into a 10-minute window is told to wait 10 more seconds, not 1.
- **Failure scenario:** A legitimate user hitting the rate limit is given an inaccurate Retry-After, causing unnecessary wait times or premature retries.
- **Status:** Confirmed by code inspection.
- **Recommended remediation:** Query `TTL key` from Redis after increment and return the actual remaining seconds.

### Finding R-3: EXPIRE return value is unchecked
- **Severity:** MEDIUM
- **File:** `src/lib/rate-limit/redis-store.ts`
- **Line:** 40
- **Evidence:**
  ```ts
  await redis.expire(fullKey, windowSeconds);
  ```
  `EXPIRE` returns 0 if the key is missing (e.g., deleted between `INCR` and `EXPIRE`). The code does not check the result, so a missing key silently loses its TTL.
- **Failure scenario:** A race condition or external cleanup deletes the key between `INCR` and `EXPIRE`. The key is recreated without a TTL.
- **Status:** Confirmed by code inspection.
- **Recommended remediation:** Check the return value of `EXPIRE`; if it returns 0, re-apply the TTL or treat it as a miss.

### Finding R-4: All clients without detectable IP share a single bucket
- **Severity:** LOW-MEDIUM
- **File:** `src/lib/customer-access/rate-limit.ts`
- **Line:** 57
- **Evidence:**
  ```ts
  return headers.get('x-real-ip')?.slice(0, 64) ?? 'unknown';
  ```
  Requests lacking both `x-forwarded-for` and `x-real-ip` fall into the same `unknown` bucket. A single attacker can exhaust this bucket, affecting all legitimate clients on that path.
- **Failure scenario:** A reverse proxy strips IP headers. An attacker sends 30 requests from a single source, exhausting the `unknown` bucket for all users behind that proxy.
- **Status:** Confirmed by code inspection. Acceptable as a fallback, but should be documented as a known limitation.
- **Recommended remediation:** Include the `User-Agent` hash or a session-derived dimension in the fallback bucket to increase entropy.

### Finding R-5: One-way degradation to in-memory store
- **Severity:** LOW-MEDIUM
- **File:** `src/lib/rate-limit/redis-store.ts`
- **Lines:** 86, 96, 103–104
- **Evidence:**
  ```ts
  let degraded = false;
  if (degraded) {
    return fallback.increment(key, windowSeconds);
  }
  ```
  Once a Redis error occurs, `degraded` flips to `true` and never resets, so a transient failure permanently weakens the process to per-instance bounds.
- **Failure scenario:** A temporary Redis blip during deployment weakens rate limiting for the entire process lifetime.
- **Status:** Confirmed by code inspection.
- **Recommended remediation:** Add a reset timer (e.g., retry Redis connectivity every 30 seconds) so degradation is temporary, not permanent.

---

## B. Customer Email Pipeline Audit

**Subagent role:** QA/Research Engineer (read-only)  
**Files inspected:**
- `src/lib/queue/handlers/email-handler.ts`
- `src/lib/queue/handlers/customer-email.ts`
- `src/lib/customer-notifications/events.ts`
- `src/lib/customer-notifications/email-content.ts`

**Tests executed:** `npm test -- --run src/__tests__/customer-email.*.test.ts src/__tests__/*email*.test.ts` → 71 passed, 0 failed. Tests do not cover the findings below.

### Finding E-1: Provider success + markEmailSent failure → duplicate delivery
- **Severity:** HIGH
- **File:** `src/lib/queue/handlers/email-handler.ts`
- **Line:** 142
- **Evidence:**
  ```ts
  const providerResult = await sendEmail(config, message);
  if (providerResult.status === 'success') {
    await markEmailSent(event.id);   // <-- if this throws, catch block releases claim
    return { status: 'success' };
  }
  ```
  The catch block at lines 164–178 unconditionally releases the claim and throws `RetryableError`. On retry, the worker claims and sends again because no `SENT` record exists.
- **Failure scenario:** `sendEmail` succeeds (customer receives email), but `markEmailSent` fails (database error). The worker releases the claim and throws. BullMQ retries. The retry claims and sends a second email.
- **Status:** Confirmed by code inspection. No reproducing test exists.
- **Recommended remediation:** After `markEmailSent` failure, verify whether the provider actually delivered before releasing the claim, or implement an idempotency key at the provider level.

### Finding E-2: Same provider-success/DB-failure gap in customer email path
- **Severity:** HIGH
- **File:** `src/lib/queue/handlers/customer-email.ts`
- **Line:** 75
- **Evidence:**
  ```ts
  if (providerResult.status === 'success') {
    await markEmailSent(event.id);
    return { status: 'success' };
  }
  ```
  Identical pattern to E-1. The customer-email handler shares the same race.
- **Status:** Confirmed by code inspection.
- **Recommended remediation:** Same as E-1.

### Finding E-3: Claim collision with in-progress worker returns success
- **Severity:** HIGH
- **File:** `src/lib/queue/handlers/email-handler.ts`
- **Line:** 131
- **Evidence:**
  ```ts
  const claim = await claimEmailSend(event.id, message.to);
  if (!claim.claimed) {
    const sentAfterClaim = await getSentEmail(event.id);
    if (sentAfterClaim) {
      return { status: 'success' };
    }
    return { status: 'success' };   // <-- falls through even if no SENT record
  }
  ```
  When another worker holds the claim (`SENDING`), the current worker returns `success` without verifying the email was actually sent.
- **Failure scenario:** Worker A claims and sends. Worker B (racing) sees the claim, finds no `SENT` record, and returns `success`. The event is marked done, but Worker A crashes before `markEmailSent`. The email is lost.
- **Status:** Confirmed by code inspection.
- **Recommended remediation:** When `claim.claimed` is false, poll/wait for the `SENT` record up to a short timeout (e.g., 10 seconds) before giving up.

### Finding E-4: Same idempotency gap in customer email without SENT recheck
- **Severity:** HIGH
- **File:** `src/lib/queue/handlers/customer-email.ts`
- **Line:** 63
- **Evidence:**
  ```ts
  const claim = await claimEmailSend(event.id, message.to);
  if (!claim.claimed) {
    return { status: 'success' };   // <-- no getSentEmail recheck at all
  }
  ```
  The customer email path does not even attempt `getSentEmail` on claim collision.
- **Status:** Confirmed by code inspection.
- **Recommended remediation:** Same as E-3.

### Finding E-5: Stale claim window (5 min) enables duplicate or lost emails after worker crash
- **Severity:** MEDIUM
- **File:** `src/lib/queue/handlers/email-handler.ts`
- **Line:** 11
- **Evidence:**
  ```ts
  export const STALE_SEND_CLAIM_MS = 5 * 60 * 1000;
  ```
  A worker that crashes after provider send but before `markEmailSent` leaves a `SENDING` claim. Retries within 5 minutes see the stale claim and return `success` (lines 132–138), losing the email. After 5 minutes, stale cleanup removes it and the retry sends again, duplicating delivery.
- **Failure scenario:** Worker sends email, crashes before DB commit. Within 5 minutes, retry sees stale claim → success (email lost). After 5 minutes, retry sees cleared claim → sends again (duplicate email).
- **Status:** Confirmed by code inspection.
- **Recommended remediation:** Reduce `STALE_SEND_CLAIM_MS` or implement a reconciliation loop that checks provider-side idempotency keys.

### Test Gaps Identified
- **E-T1:** `src/__tests__/customer-email.handler.test.ts` line 139 mocks `sentEmail.updateMany` to always succeed; no test simulates `sendEmail` succeeding and `markEmailSent` throwing.
- **E-T2:** `src/__tests__/customer-email.handler.test.ts` lines 364–374 test claim collision (P2002) but do not simulate another worker holding the claim and still processing.

---

## C. Previously Reported Integration Test Failure

**File:** `src/__tests__/customer-portal.integration.test.ts`  
**Line:** 431  
**Issue:** `InternalNote_authorId_fkey` foreign key violation  
**Root cause:** Test created an `InternalNote` with `authorId: createId('user')` (a random ID not present in the `User` table).  
**Fix applied:** Changed to `authorId: await seedAgentUser()`, which creates a real user before use.  
**Status:** Resolved. Test now passes.

---

## D. T5.1 Attachment Transport — Current Status

### Completed
- Fixed internal download path to sanitize filenames and normalize MIME types on the way out.
- Added `Content-Length` to internal download response.
- Scoped integration test assertions to the correct message.
- Fixed transaction mock to target the module singleton.
- Added `attachments.transport.test.ts` with 7 regression tests.
- Added bounded request-body handling to customer upload route:
  - `Content-Length` early rejection
  - `file.size` early rejection
- Added 2 API tests for oversized upload rejection.
- Resolved pre-existing `InternalNote_authorId_fkey` test failure.

### Verification (all green)
- Attachment tests: 7 files, 233 tests passed
- Full suite: 118 files, 1687 tests passed
- Lint: 0 errors, 0 warnings
- Typecheck: passes
- Build: passes

### Outstanding (preserved for T5.2–T5.5)
- Redis rate limiter findings R-1 through R-5
- Customer email findings E-1 through E-5
- **F-1: Upload API concurrent resource exhaustion**
  - **Severity:** MEDIUM
  - **Scope:** `src/app/api/portal/[workspaceSlug]/tickets/[ticketId]/messages/[messageId]/attachments/route.ts` and the per-IP rate limiter in `src/lib/customer-access/rate-limit.ts`
  - **Maximum buffered request body per request:** 11 MiB (`maxFileSizeBytes` 10 MiB + 1 MiB stream overhead enforced by `readFormDataWithLimit`)
  - **Concurrent upload impact:** The upload endpoint has no per-customer or per-IP rate limit and no concurrent-upload throttle. A single customer or IP can open N simultaneous 11 MiB requests, consuming N × 11 MiB of server-side memory and disk I/O. With no ingress-level concurrency control, this is a viable low-bandwidth denial-of-service vector.
  - **Deployment ingress:** Unknown from current evidence. No ingress rate limit or request-size cap has been identified in the codebase or deployment docs reviewed so far.
  - **Recommended mitigation:** Address the Redis reliability findings (R-1 through R-5) first so the existing rate-limiter store is trustworthy, then add an upload-specific rate-limit key that caps requests per customer/IP per minute and a semaphore-style concurrency guard around the attachment storage path.
