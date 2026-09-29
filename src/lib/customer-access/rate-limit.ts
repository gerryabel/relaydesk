import { createHash } from 'node:crypto';
import type { RateLimitRule } from '@/lib/rate-limit/limiter';

/**
 * Abuse-protection policy for the public customer portal (Phase 9 Task 1).
 *
 * Customer authentication is an unauthenticated, internet-facing surface, so
 * both endpoints are bounded by several independent dimensions at once. A
 * caller cannot bypass the limits by rotating a single client-controlled
 * field: every request must stay under the workspace bucket, the email bucket
 * and the IP bucket simultaneously.
 *
 * No raw email, IP address or token is ever used as a key component — only
 * SHA-256 digests, so the rate-limit store cannot be mined for personal data.
 */

export const CUSTOMER_RATE_LIMIT_ACTIONS = {
  MAGIC_LINK_REQUEST: 'customer-magic-link-request',
  MAGIC_LINK_VERIFY: 'customer-magic-link-verify',
} as const;

const MINUTE = 60;

export const CUSTOMER_RATE_LIMITS = {
  /** Per workspace + email: stops a targeted inbox-flooding attack. */
  requestPerWorkspaceEmail: { limit: 5, windowSeconds: 10 * MINUTE },
  /** Per workspace: stops bulk flooding spread across many addresses. */
  requestPerWorkspace: { limit: 60, windowSeconds: 10 * MINUTE },
  /** Per IP: stops a single host spraying many workspaces. */
  requestPerIp: { limit: 30, windowSeconds: 10 * MINUTE },
  /** Per IP for token verification: bounds online guessing. */
  verifyPerIp: { limit: 20, windowSeconds: 10 * MINUTE },
  /** Per workspace: bounds guessing even from many hosts. */
  verifyPerWorkspace: { limit: 100, windowSeconds: 10 * MINUTE },
} as const;

export function hashRateLimitDimension(value: string): string {
  return createHash('sha256').update(value, 'utf8').digest('hex').slice(0, 32);
}

/**
 * Best-effort client address for rate limiting.
 *
 * `x-forwarded-for` is only trustworthy behind a proxy that overwrites it, so
 * rate-limit buckets always combine this value with workspace and email
 * dimensions — a spoofed header alone cannot bypass the limits. The value is
 * hashed before it becomes a key, and is never persisted or logged.
 */
export function readClientIp(headers: Headers): string {
  const forwarded = headers.get('x-forwarded-for');
  const first = forwarded?.split(',')[0]?.trim();

  if (first) {
    return first.slice(0, 64);
  }

  return headers.get('x-real-ip')?.slice(0, 64) ?? 'unknown';
}

/**
 * Builds the rules applied to a magic-link request.
 *
 * `workspaceId` is the server-resolved workspace id, never the raw slug from
 * the request body, so an unknown slug cannot mint fresh buckets at will.
 */
export function buildMagicLinkRequestRules(input: {
  workspaceId: string;
  email: string;
  ip: string;
}): RateLimitRule[] {
  const email = hashRateLimitDimension(input.email);
  const ip = hashRateLimitDimension(input.ip);

  return [
    {
      action: CUSTOMER_RATE_LIMIT_ACTIONS.MAGIC_LINK_REQUEST,
      dimensions: ['workspace-email', input.workspaceId, email],
      ...CUSTOMER_RATE_LIMITS.requestPerWorkspaceEmail,
    },
    {
      action: CUSTOMER_RATE_LIMIT_ACTIONS.MAGIC_LINK_REQUEST,
      dimensions: ['workspace', input.workspaceId],
      ...CUSTOMER_RATE_LIMITS.requestPerWorkspace,
    },
    {
      action: CUSTOMER_RATE_LIMIT_ACTIONS.MAGIC_LINK_REQUEST,
      dimensions: ['ip', ip],
      ...CUSTOMER_RATE_LIMITS.requestPerIp,
    },
  ];
}

/**
 * Builds the rules applied to a magic-link verification.
 *
 * No token material is passed in: the workspace bucket bounds distributed
 * guessing, the IP bucket bounds a single host.
 */
export function buildMagicLinkVerifyRules(input: { workspaceId: string; ip: string }): RateLimitRule[] {
  const ip = hashRateLimitDimension(input.ip);

  return [
    {
      action: CUSTOMER_RATE_LIMIT_ACTIONS.MAGIC_LINK_VERIFY,
      dimensions: ['ip', ip],
      ...CUSTOMER_RATE_LIMITS.verifyPerIp,
    },
    {
      action: CUSTOMER_RATE_LIMIT_ACTIONS.MAGIC_LINK_VERIFY,
      dimensions: ['workspace', input.workspaceId],
      ...CUSTOMER_RATE_LIMITS.verifyPerWorkspace,
    },
  ];
}
