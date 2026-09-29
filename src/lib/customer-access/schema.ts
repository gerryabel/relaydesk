import { z } from 'zod';
import { workspaceSlugSchema } from '@/lib/workspace/slug';

/**
 * Input validation for the customer portal (Phase 9 Task 1).
 *
 * Server-side validation is authoritative. Nothing here is a substitute for
 * authorization: a syntactically valid slug or token still resolves to a
 * server-side workspace/customer check.
 */

export const CUSTOMER_EMAIL_MAX_LENGTH = 320;

/**
 * Email addresses submitted through the public portal.
 *
 * Normalized to lowercase + trimmed so the same person cannot create parallel
 * customer identities by changing case. This matches the canonical form used
 * for the `(workspaceId, email)` uniqueness constraint.
 */
export const customerAuthEmailSchema = z
  .string({ error: 'Email is required' })
  .trim()
  .min(1, 'Email is required')
  .max(CUSTOMER_EMAIL_MAX_LENGTH, `Email cannot exceed ${CUSTOMER_EMAIL_MAX_LENGTH} characters`)
  .toLowerCase()
  .refine((value) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value), {
    message: 'Email format is invalid',
  });

/** Opaque customer token as it appears in a magic link or session cookie. */
export const customerTokenSchema = z
  .string({ error: 'Token is required' })
  .trim()
  .min(32, 'Token is required')
  .max(128, 'Token is invalid')
  .regex(/^[A-Za-z0-9_-]+$/, 'Token is invalid');

export const requestCustomerMagicLinkSchema = z.object({
  workspaceSlug: workspaceSlugSchema,
  email: customerAuthEmailSchema,
});

export const consumeCustomerMagicLinkSchema = z.object({
  workspaceSlug: workspaceSlugSchema,
  token: customerTokenSchema,
});

export type RequestCustomerMagicLinkInput = z.infer<typeof requestCustomerMagicLinkSchema>;
export type ConsumeCustomerMagicLinkInput = z.infer<typeof consumeCustomerMagicLinkSchema>;
