import { z } from 'zod';
import { ticketStatusSchema, ticketPrioritySchema } from '@/lib/tickets/schema';
import { ticketSortSchema } from '@/lib/tickets/sort';
import { DEFAULT_QUEUE_VIEW, QUEUE_VIEW_ORDER } from '@/lib/tickets/queue';

export const savedViewTypeSchema = z.enum(['tickets', 'my_queue']);

export const MAX_SAVED_VIEW_NAME_LENGTH = 100;

/**
 * Serializes the existing ticket filter model into a SavedView. Validation
 * reuses the existing ticket filter/sort schemas — we do not duplicate their
 * semantics. Unknown optional fields (assignee, tagIds) are tolerated to keep
 * saved views safe when the referenced assignee/tag no longer exists.
 */
const persistedFilterSchema = z.object({
  search: z.string().trim().max(200).optional().catch(undefined),
  status: ticketStatusSchema.optional().catch(undefined),
  priority: ticketPrioritySchema.optional().catch(undefined),
  assignee: z.string().trim().max(64).optional().catch(undefined),
  tagId: z.string().trim().max(64).optional().catch(undefined),
});

const persistedSortSchema = ticketSortSchema;

const persistedViewSchema = z.enum(QUEUE_VIEW_ORDER);

export const savedViewPayloadSchema = z.object({
  name: z
    .string({ error: 'Saved view name is required' })
    .trim()
    .min(1, 'Saved view name cannot be empty')
    .max(
      MAX_SAVED_VIEW_NAME_LENGTH,
      `Saved view name cannot exceed ${MAX_SAVED_VIEW_NAME_LENGTH} characters`,
    ),
  type: savedViewTypeSchema.default('tickets'),
  filterState: persistedFilterSchema.default({}),
  sortState: persistedSortSchema.default({ field: 'createdAt', direction: 'desc' }),
  viewState: persistedViewSchema.default(DEFAULT_QUEUE_VIEW),
});

export const createSavedViewSchema = savedViewPayloadSchema;

export const updateSavedViewSchema = z.object({
  name: savedViewPayloadSchema.shape.name.optional(),
  type: savedViewTypeSchema.optional(),
  filterState: persistedFilterSchema.optional(),
  sortState: persistedSortSchema.optional(),
  viewState: persistedViewSchema.optional(),
});

export const applySavedViewSchema = z.object({
  id: z.string().trim().min(1, 'Saved view ID is required'),
});

export type SavedViewType = z.infer<typeof savedViewTypeSchema>;
export type SavedViewPayload = z.infer<typeof savedViewPayloadSchema>;
export type CreateSavedViewInput = z.infer<typeof createSavedViewSchema>;
export type UpdateSavedViewInput = z.infer<typeof updateSavedViewSchema>;
export type ApplySavedViewInput = z.infer<typeof applySavedViewSchema>;

export type SavedViewContentType = {
  name: string;
  type: SavedViewType;
  filterState: z.infer<typeof persistedFilterSchema>;
  sortState: z.infer<typeof persistedSortSchema>;
  viewState: SavedViewType extends string ? z.infer<typeof persistedViewSchema> : never;
};

/**
 * Narrows an arbitrary parsed JSON object to a safe, persistable filter shape.
 * Any field that does not match the existing filter schema is dropped so that
 * outdated or tampered saved views never crash the ticket page.
 */
export function sanitizeFilterState(raw: unknown): z.infer<typeof persistedFilterSchema> {
  const parsed = persistedFilterSchema.safeParse(raw ?? {});
  return parsed.success ? parsed.data : {};
}

export function sanitizeSortState(raw: unknown): z.infer<typeof persistedSortSchema> {
  const parsed = persistedSortSchema.safeParse(raw ?? {});
  return parsed.success ? parsed.data : { field: 'createdAt', direction: 'desc' };
}

export function sanitizeViewState(raw: unknown): z.infer<typeof persistedViewSchema> {
  const parsed = persistedViewSchema.safeParse(raw ?? {});
  return parsed.success ? parsed.data : DEFAULT_QUEUE_VIEW;
}

/**
 * Builds the URL search params a saved view applies to. Used by the apply
 * action to redirect the user to the existing ticket/queue interface with the
 * saved state restored. Invalid persisted state is normalized before use.
 */
export function buildSearchParamsFromView(view: {
  type: SavedViewType;
  filterState: unknown;
  sortState: unknown;
  viewState: unknown;
}): URLSearchParams {
  const params = new URLSearchParams();
  const filter = sanitizeFilterState(view.filterState);
  const sort = sanitizeSortState(view.sortState);
  const queueView = sanitizeViewState(view.viewState);

  if (filter.search) {
    params.set('search', filter.search);
  }
  if (filter.status) {
    params.set('status', filter.status);
  }
  if (filter.priority) {
    params.set('priority', filter.priority);
  }
  if (filter.assignee) {
    params.set('assignee', filter.assignee);
  }
  if (filter.tagId) {
    params.set('tagId', filter.tagId);
  }

  params.set('sort', `${sort.field}:${sort.direction}`);

  if (view.type === 'my_queue' && queueView && queueView !== DEFAULT_QUEUE_VIEW) {
    params.set('view', queueView);
  }

  return params;
}
