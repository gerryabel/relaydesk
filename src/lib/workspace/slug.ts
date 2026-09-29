import { randomBytes } from 'node:crypto';
import { z } from 'zod';

/**
 * Public workspace identity (Phase 9 Task 1).
 *
 * The slug is a *lookup key* for the customer portal, never a credential.
 * Every security-sensitive operation re-resolves the workspace from the
 * database after the slug is parsed, and customer authorization is always
 * derived from persisted (workspace, customer, session) records.
 */

/** Maximum length of the slug derived from the workspace name. */
export const WORKSPACE_SLUG_MAX_LENGTH = 48;

/** Fallback used when a name contains no ASCII alphanumeric characters. */
export const WORKSPACE_SLUG_FALLBACK = 'workspace';

/** Upper bound for numeric collision suffixes before falling back to a random suffix. */
export const WORKSPACE_SLUG_MAX_ATTEMPTS = 20;

const SLUG_PATTERN = /^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?$/;

/**
 * Normalizes an arbitrary workspace name into a URL-safe slug base.
 *
 * Deliberately ASCII-only: characters outside [a-z0-9] collapse into a single
 * `-` so the result is deterministic and matches the SQL backfill in
 * `prisma/migrations/20260923000000_add_customer_access/migration.sql`.
 */
export function buildWorkspaceSlugBase(name: string): string {
  const slug = name
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, WORKSPACE_SLUG_MAX_LENGTH)
    .replace(/-+$/g, '');

  return slug.length > 0 ? slug : WORKSPACE_SLUG_FALLBACK;
}

function truncateWithSuffix(base: string, suffix: string): string {
  // Reserve one character for the separator as well as the suffix, so the
  // result never exceeds WORKSPACE_SLUG_MAX_LENGTH.
  const keep = Math.max(1, WORKSPACE_SLUG_MAX_LENGTH - suffix.length - 1);

  return `${base.slice(0, keep)}-${suffix}`;
}

/**
 * Builds the ordered list of slug candidates to try for a workspace name.
 *
 * `base`, `base-2`, `base-3`, ... Exposed so both the persistence-backed
 * allocator and the unit tests can assert the exact same ordering.
 */
export function buildWorkspaceSlugCandidates(name: string): string[] {
  const base = buildWorkspaceSlugBase(name);
  const candidates = [base];

  for (let attempt = 2; attempt <= WORKSPACE_SLUG_MAX_ATTEMPTS; attempt += 1) {
    candidates.push(truncateWithSuffix(base, String(attempt)));
  }

  return candidates;
}

/**
 * Zod schema for a workspace slug supplied by a client.
 *
 * Server-side validation is authoritative; the parsed value is only ever used
 * to look up a workspace, never to authorize anything.
 */
export const workspaceSlugSchema = z
  .string({ error: 'Workspace slug is required' })
  .trim()
  .min(1, 'Workspace slug is required')
  .max(
    WORKSPACE_SLUG_MAX_LENGTH + 6,
    `Workspace slug cannot exceed ${WORKSPACE_SLUG_MAX_LENGTH + 6} characters`,
  )
  .toLowerCase()
  .refine((value) => SLUG_PATTERN.test(value), {
    message: 'Workspace slug is invalid',
  });

export type WorkspaceSlugInput = z.infer<typeof workspaceSlugSchema>;

type SlugAllocator = {
  workspace: {
    findUnique: (args: { where: { slug: string }; select: { id: true } }) => Promise<{ id: string } | null>;
  };
};

/**
 * Allocates a globally unique slug for a new workspace.
 *
 * Deterministic when the name is free (`acme-support`), collision-safe
 * otherwise (`acme-support-2`). The caller is still responsible for handling
 * `P2002` from the actual INSERT, because the read-then-write check cannot
 * close the race by itself.
 */
export async function generateWorkspaceSlug(
  client: SlugAllocator,
  name: string,
): Promise<string> {
  const candidates = buildWorkspaceSlugCandidates(name);

  for (const candidate of candidates) {
    const existing = await client.workspace.findUnique({
      where: { slug: candidate },
      select: { id: true },
    });

    if (!existing) {
      return candidate;
    }
  }

  const random = randomBytes(4).toString('hex');
  return truncateWithSuffix(candidates[0], random);
}
