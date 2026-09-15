import { describe, it, expect } from 'vitest';
import {
  createSavedViewSchema,
  updateSavedViewSchema,
  savedViewTypeSchema,
  sanitizeFilterState,
  sanitizeSortState,
  sanitizeViewState,
  buildSearchParamsFromView,
  MAX_SAVED_VIEW_NAME_LENGTH,
} from '@/lib/saved-views/schema';

describe('createSavedViewSchema validation', () => {
  it('trims and accepts a valid payload', () => {
    const parsed = createSavedViewSchema.parse({
      name: '  High priority  ',
      type: 'tickets',
    });

    expect(parsed.name).toBe('High priority');
    expect(parsed.type).toBe('tickets');
  });

  it('rejects whitespace-only name', () => {
    expect(() => createSavedViewSchema.parse({ name: '     ' })).toThrow(
      'Saved view name cannot be empty',
    );
  });

  it('rejects empty name', () => {
    expect(() => createSavedViewSchema.parse({ name: '' })).toThrow();
  });

  it('rejects over-max-length name', () => {
    const tooLong = 'a'.repeat(MAX_SAVED_VIEW_NAME_LENGTH + 1);
    expect(() => createSavedViewSchema.parse({ name: tooLong })).toThrow(
      `Saved view name cannot exceed ${MAX_SAVED_VIEW_NAME_LENGTH} characters`,
    );
  });

  it('accepts a name exactly at max length', () => {
    const name = 'a'.repeat(MAX_SAVED_VIEW_NAME_LENGTH);
    const parsed = createSavedViewSchema.parse({ name });
    expect(parsed.name).toBe(name);
  });

  it('rejects non-string name', () => {
    expect(() => createSavedViewSchema.parse({ name: 123 })).toThrow();
  });

  it('applies defaults for optional fields when provided', () => {
    const parsed = createSavedViewSchema.parse({
      name: 'My View',
      filterState: {},
      sortState: { field: 'createdAt', direction: 'desc' },
      viewState: 'my-open',
    });
    expect(parsed.type).toBe('tickets');
    expect(parsed.filterState).toEqual({});
    expect(parsed.sortState).toEqual({ field: 'createdAt', direction: 'desc' });
    expect(parsed.viewState).toBe('my-open');
  });

  it('rejects unknown type', () => {
    expect(() => createSavedViewSchema.parse({ name: 'Bad', type: 'shared' })).toThrow();
  });

  it('silently normalizes unknown filter status at create time (lenient persistence)', () => {
    // The persisted filter schema is intentionally lenient per-field: a
    // present-but-invalid value is dropped rather than failing creation.
    // Invalid state is always normalized again at apply time.
    const parsed = createSavedViewSchema.parse({
      name: 'Bad',
      filterState: { status: 'unknown' },
    });
    expect(parsed.filterState).toEqual({});
  });

  it('silently normalizes unknown filter priority at create time', () => {
    const parsed = createSavedViewSchema.parse({
      name: 'Bad',
      filterState: { priority: 'extreme' },
    });
    expect(parsed.filterState).toEqual({});
  });

  it('rejects unknown queue/view state', () => {
    expect(() => createSavedViewSchema.parse({ name: 'Bad', viewState: 'unknown' })).toThrow();
  });
});

describe('updateSavedViewSchema validation', () => {
  it('allows a partial update with only a name', () => {
    const parsed = updateSavedViewSchema.parse({ name: 'Renamed' });
    expect(parsed.name).toBe('Renamed');
    // Unspecified fields are not present in partial update; schema defaults
    // only apply to the create schema.
    expect('type' in parsed).toBe(false);
  });

  it('rejects whitespace-only name when provided', () => {
    expect(() => updateSavedViewSchema.parse({ name: '   ' })).toThrow();
  });
});

describe('savedViewTypeSchema', () => {
  it('accepts tickets', () => {
    expect(savedViewTypeSchema.parse('tickets')).toBe('tickets');
  });

  it('accepts my_queue', () => {
    expect(savedViewTypeSchema.parse('my_queue')).toBe('my_queue');
  });

  it('rejects other values', () => {
    expect(() => savedViewTypeSchema.parse('shared')).toThrow();
  });
});

describe('sanitize functions (invalid persisted state)', () => {
  it('sanitizeFilterState keeps only known fields', () => {
    const result = sanitizeFilterState({
      status: 'open',
      search: 'hello',
    });
    expect(result).toEqual({ status: 'open', search: 'hello' });
  });

  it('sanitizeFilterState returns empty object for garbage', () => {
    expect(sanitizeFilterState({ status: 'garbage', priority: 'extreme' })).toEqual({});
  });

  it('sanitizeFilterState accepts assignee and tagId', () => {
    const result = sanitizeFilterState({ assignee: 'u-1', tagId: 't-1' });
    expect(result).toEqual({ assignee: 'u-1', tagId: 't-1' });
  });

  it('sanitizeFilterState handles undefined/null', () => {
    expect(sanitizeFilterState(undefined)).toEqual({});
    expect(sanitizeFilterState(null)).toEqual({});
  });

  it('sanitizeSortState returns default for invalid', () => {
    expect(sanitizeSortState({ field: 'bogus' })).toEqual({ field: 'createdAt', direction: 'desc' });
  });

  it('sanitizeSortState passes through valid sort', () => {
    expect(sanitizeSortState({ field: 'priority', direction: 'asc' })).toEqual({
      field: 'priority',
      direction: 'asc',
    });
  });

  it('sanitizeViewState returns default for invalid', () => {
    expect(sanitizeViewState('bogus')).toBe('my-open');
  });

  it('sanitizeViewState passes through valid view', () => {
    expect(sanitizeViewState('sla-risk')).toBe('sla-risk');
  });
});

describe('buildSearchParamsFromView', () => {
  it('builds tickets search params from a saved view', () => {
    const params = buildSearchParamsFromView({
      type: 'tickets',
      filterState: { search: 'outage', status: 'open', priority: 'urgent' },
      sortState: { field: 'priority', direction: 'asc' },
      viewState: 'my-open',
    });

    expect(params.get('search')).toBe('outage');
    expect(params.get('status')).toBe('open');
    expect(params.get('priority')).toBe('urgent');
    expect(params.get('sort')).toBe('priority:asc');
    expect(params.has('view')).toBe(false);
  });

  it('search filter value is trimmed by the persisted schema', () => {
    // persistedFilterSchema trims search, so the builder receives a trimmed
    // value. This documents the normalization that protects the ticket page.
    const params = buildSearchParamsFromView({
      type: 'tickets',
      filterState: { search: '  spaced  ' },
      sortState: { field: 'createdAt', direction: 'desc' },
      viewState: 'my-open',
    });

    expect(params.get('search')).toBe('spaced');
  });

  it('includes view param for my_queue type when not default', () => {
    const params = buildSearchParamsFromView({
      type: 'my_queue',
      filterState: { status: 'in_progress' },
      sortState: { field: 'updatedAt', direction: 'desc' },
      viewState: 'sla-risk',
    });

    expect(params.get('view')).toBe('sla-risk');
    expect(params.get('status')).toBe('in_progress');
    expect(params.get('sort')).toBe('updatedAt:desc');
  });

  it('normalizes invalid persisted filter state', () => {
    const params = buildSearchParamsFromView({
      type: 'tickets',
      filterState: { status: 'garbage', search: '  keep  ' },
      sortState: { field: 'bogus' },
      viewState: 'garbage',
    });

    expect(params.has('status')).toBe(false);
    // search is trimmed by sanitizeFilterState via persistedFilterSchema
    expect(params.get('search')).toBe('keep');
    expect(params.get('sort')).toBe('createdAt:desc');
  });
});
