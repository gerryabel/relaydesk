import { z } from 'zod';
import { ticketStatusSchema, ticketPrioritySchema } from '@/lib/tickets/schema';
import { ticketSortSchema } from '@/lib/tickets/sort';

export const MAX_SAVED_VIEW_NAME_LENGTH = 100;

export const savedViewTypeSchema = z.enum(['tickets', 'my_queue']);

export type SavedViewType = z.infer<typeof savedViewTypeSchema>;

/**
 * Client-safe schema helpers for saved views. This module deliberately avoids
 * importing `@/lib/tickets/queue.ts` or any module that transitively pulls in
 * `@/lib/db/prisma`, so that client components (the saved-view editor / list)
 * never drag the `pg` driver into the browser bundle.
 */

const persistedFilterSchema = z.object({
  search: z.string().trim().max(200).optional().catch(undefined),
  status: ticketStatusSchema.optional().catch(undefined),
  priority: ticketPrioritySchema.optional().catch(undefined),
  assignee: z.string().trim().max(64).optional().catch(undefined),
  tagId: z.string().trim().max(64).optional().catch(undefined),
});

const persistedSortSchema = ticketSortSchema;

const persistedViewSchema = z.enum(['my-open', 'waiting', 'high-priority', 'sla-risk']);

export const DEFAULT_QUEUE_VIEW = 'my-open' as const;

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
