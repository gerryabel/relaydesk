import { describe, it, expect, vi } from 'vitest';
import {
  WORKSPACE_SLUG_MAX_LENGTH,
  buildWorkspaceSlugBase,
  buildWorkspaceSlugCandidates,
  generateWorkspaceSlug,
  workspaceSlugSchema,
} from '@/lib/workspace/slug';

/**
 * The SQL backfill in
 * `prisma/migrations/20260923000000_add_customer_access/migration.sql` mirrors
 * `buildWorkspaceSlugBase` and `truncateWithSuffix` step for step. These tests
 * pin the JavaScript side of that contract.
 */

describe('buildWorkspaceSlugBase', () => {
  it('lowercases and hyphenates a workspace name', () => {
    expect(buildWorkspaceSlugBase('Acme Support')).toBe('acme-support');
  });

  it('collapses runs of non-alphanumerics into a single hyphen', () => {
    expect(buildWorkspaceSlugBase('Acme   ////  Corp!!!')).toBe('acme-corp');
  });

  it('strips leading and trailing hyphens', () => {
    expect(buildWorkspaceSlugBase('  ---Acme---  ')).toBe('acme');
  });

  it('falls back when no ascii alphanumeric survives', () => {
    expect(buildWorkspaceSlugBase(' Kantor  東京 ')).toBe('kantor');
    expect(buildWorkspaceSlugBase('東京')).toBe('workspace');
    expect(buildWorkspaceSlugBase('!!!')).toBe('workspace');
    expect(buildWorkspaceSlugBase('')).toBe('workspace');
  });

  it('keeps digits', () => {
    expect(buildWorkspaceSlugBase('Acme 24')).toBe('acme-24');
  });

  it('never leaves a trailing hyphen after truncating to the cap', () => {
    // The 49th character is a hyphen, which the 48-char cut lands on.
    const name = `${'a'.repeat(47)} tail`;
    const slug = buildWorkspaceSlugBase(name);

    expect(slug).toHaveLength(WORKSPACE_SLUG_MAX_LENGTH - 1);
    expect(slug.endsWith('-')).toBe(false);
  });

  it('respects the length cap', () => {
    expect(buildWorkspaceSlugBase('b'.repeat(200))).toHaveLength(WORKSPACE_SLUG_MAX_LENGTH);
  });
});

describe('buildWorkspaceSlugCandidates', () => {
  it('starts from the base and appends numeric suffixes in order', () => {
    const candidates = buildWorkspaceSlugCandidates('Acme Support');

    expect(candidates[0]).toBe('acme-support');
    expect(candidates[1]).toBe('acme-support-2');
    expect(candidates[2]).toBe('acme-support-3');
  });

  it('keeps every candidate within the length cap', () => {
    for (const candidate of buildWorkspaceSlugCandidates('a'.repeat(200))) {
      expect(candidate.length).toBeLessThanOrEqual(WORKSPACE_SLUG_MAX_LENGTH);
      expect(workspaceSlugSchema.safeParse(candidate).success).toBe(true);
    }
  });

  it('produces distinct candidates', () => {
    const candidates = buildWorkspaceSlugCandidates('Acme Support');

    expect(new Set(candidates).size).toBe(candidates.length);
  });
});

describe('generateWorkspaceSlug', () => {
  function allocatorWith(taken: string[]) {
    return {
      workspace: {
        findUnique: vi.fn(async ({ where }: { where: { slug: string } }) =>
          taken.includes(where.slug) ? { id: 'existing' } : null,
        ),
      },
    };
  }

  it('returns the base slug when it is free', async () => {
    const client = allocatorWith([]);

    expect(await generateWorkspaceSlug(client, 'Acme Support')).toBe('acme-support');
  });

  it('skips to the next candidate on collision', async () => {
    const client = allocatorWith(['acme-support', 'acme-support-2']);

    expect(await generateWorkspaceSlug(client, 'Acme Support')).toBe('acme-support-3');
  });

  it('falls back to a random suffix once candidates are exhausted', async () => {
    const client = allocatorWith(buildWorkspaceSlugCandidates('Acme Support'));

    const slug = await generateWorkspaceSlug(client, 'Acme Support');

    expect(slug).toMatch(/-[0-9a-f]{8}$/);
    expect(slug.length).toBeLessThanOrEqual(WORKSPACE_SLUG_MAX_LENGTH);
    expect(workspaceSlugSchema.safeParse(slug).success).toBe(true);
  });
});

describe('workspaceSlugSchema', () => {
  it('accepts a well-formed slug', () => {
    expect(workspaceSlugSchema.parse('acme-support')).toBe('acme-support');
    expect(workspaceSlugSchema.parse(' Acme-Support ')).toBe('acme-support');
  });

  it('rejects slugs that are not url safe', () => {
    expect(workspaceSlugSchema.safeParse('-acme').success).toBe(false);
    expect(workspaceSlugSchema.safeParse('acme-').success).toBe(false);
    expect(workspaceSlugSchema.safeParse('acme support').success).toBe(false);
    expect(workspaceSlugSchema.safeParse('acme/support').success).toBe(false);
    expect(workspaceSlugSchema.safeParse('acme_support').success).toBe(false);
    expect(workspaceSlugSchema.safeParse('').success).toBe(false);
  });

  it('rejects an overlong slug', () => {
    expect(workspaceSlugSchema.safeParse('a'.repeat(WORKSPACE_SLUG_MAX_LENGTH + 7)).success).toBe(false);
  });
});
