import { z } from 'zod';
import { AutomationExecutionStatus } from '@/generated/prisma';
import type { AutomationExecutionFilters } from './executions';

/**
 * Query-parameter validation for automation execution history.
 *
 * Mirrors the repository's existing search conventions
 * (`src/lib/tickets/search.ts`): coerce numeric inputs, bound the page size,
 * and reject anything unparseable so bad filters never reach Prisma.
 *
 * Two entry points share one set of field schemas:
 *   - `readExecutionListQuery` — strict, used by the API (answers 400).
 *   - `parseExecutionHistorySearchParams` — lenient, used by the dashboard
 *     page (drops invalid values and falls back to defaults, matching
 *     `src/app/dashboard/tickets/page.tsx`).
 */

export const EXECUTION_LIST_DEFAULT_LIMIT = 20;
export const EXECUTION_LIST_MAX_LIMIT = 100;
export const EXECUTION_LIST_MAX_PAGE = 10_000;

/** All AutomationExecutionStatus members, derived from the Prisma schema. */
export const AUTOMATION_EXECUTION_STATUSES = [
  AutomationExecutionStatus.pending,
  AutomationExecutionStatus.evaluating,
  AutomationExecutionStatus.awaiting_actions,
  AutomationExecutionStatus.executing,
  AutomationExecutionStatus.completed,
  AutomationExecutionStatus.partial_failure,
  AutomationExecutionStatus.failed,
  AutomationExecutionStatus.skipped,
] as const;

export const automationExecutionStatusSchema = z.enum(AUTOMATION_EXECUTION_STATUSES);

/**
 * ISO-8601 instant. `offset: true` accepts explicit offsets so callers may send
 * `+07:00` as well as `Z`; the value is normalized to a UTC instant by `Date`,
 * which keeps the `[from, to)` interval boundaries unambiguous.
 */
const isoInstantSchema = z.iso.datetime({ offset: true });

const fieldSchemas = {
  page: z.coerce.number().int().positive().max(EXECUTION_LIST_MAX_PAGE),
  limit: z.coerce.number().int().positive().max(EXECUTION_LIST_MAX_LIMIT),
  status: automationExecutionStatusSchema,
  ruleId: z.string().trim().min(1).max(64),
  triggerType: z.string().trim().min(1).max(100),
  ticketId: z.string().trim().min(1).max(64),
  from: isoInstantSchema,
  to: isoInstantSchema,
} as const;

export const executionListQuerySchema = z
  .object({
    page: fieldSchemas.page.optional(),
    limit: fieldSchemas.limit.optional(),
    status: fieldSchemas.status.optional(),
    ruleId: fieldSchemas.ruleId.optional(),
    ticketId: fieldSchemas.ticketId.optional(),
    triggerType: fieldSchemas.triggerType.optional(),
    from: fieldSchemas.from.optional(),
    to: fieldSchemas.to.optional(),
  })
  .superRefine((value, ctx) => {
    if (!value.from || !value.to) return;
    if (new Date(value.from).getTime() >= new Date(value.to).getTime()) {
      ctx.addIssue({ code: 'custom', path: ['to'], message: 'to must be strictly after from' });
    }
  });

export type ExecutionListQueryInput = z.infer<typeof executionListQuerySchema>;

export const retryActionParamsSchema = z.object({
  executionId: z.string().trim().min(1).max(64),
  actionIndex: z.coerce.number().int().min(0).max(1_000),
});

export type RetryActionParamsInput = z.infer<typeof retryActionParamsSchema>;

const LIST_QUERY_KEYS = [
  'page',
  'limit',
  'status',
  'ruleId',
  'triggerType',
  'ticketId',
  'from',
  'to',
] as const;

function firstValue(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? value[0] : value;
}

/**
 * Normalizes an already-validated query into the service filter shape.
 *
 * `triggerType` maps onto the execution's `sourceEventType` — the outbox event
 * type that produced the execution (e.g. `TICKET_CREATED`).
 */
export function toExecutionFilters(input: ExecutionListQueryInput): AutomationExecutionFilters {
  return {
    page: input.page ?? 1,
    limit: input.limit ?? EXECUTION_LIST_DEFAULT_LIMIT,
    ...(input.status ? { status: input.status } : {}),
    ...(input.ruleId ? { ruleId: input.ruleId } : {}),
    ...(input.triggerType ? { sourceEventType: input.triggerType } : {}),
    ...(input.ticketId ? { ticketId: input.ticketId } : {}),
    ...(input.from ? { from: new Date(input.from) } : {}),
    ...(input.to ? { to: new Date(input.to) } : {}),
  };
}

/**
 * Strict query reader for `GET /api/automation-executions`.
 *
 * Unknown keys are ignored so links may carry extra state; known keys must
 * validate, otherwise the caller answers 400.
 */
export function readExecutionListQuery(searchParams: URLSearchParams) {
  const raw: Record<string, string | undefined> = {};
  for (const key of LIST_QUERY_KEYS) {
    raw[key] = searchParams.get(key) ?? undefined;
  }
  return executionListQuerySchema.safeParse(raw);
}

/**
 * Interprets a `datetime-local` value (`YYYY-MM-DDTHH:mm`, no zone) as an
 * explicit UTC instant. Dashboard date inputs are labelled "UTC" and are
 * always converted, so `[from, to)` never depends on the viewer's timezone.
 */
export function utcInputToInstant(value: unknown): Date | undefined {
  if (typeof value !== 'string' || value.trim() === '') return undefined;
  const raw = value.trim();
  const hasZone = /(Z|[+-]\d{2}:?\d{2})$/.test(raw);
  const candidate = hasZone ? raw : raw.length === 16 ? `${raw}:00Z` : `${raw}Z`;
  const parsed = new Date(candidate);
  return Number.isNaN(parsed.getTime()) ? undefined : parsed;
}

/** Formats a UTC instant back into a `datetime-local` input value. */
export function toUtcDateTimeLocalValue(date: Date | undefined): string {
  return date ? date.toISOString().slice(0, 16) : '';
}

/**
 * Lenient query reader for the dashboard history page.
 *
 * Each field is validated independently; an invalid value is dropped so the
 * rest of the filters still apply. `from`/`to` accept `datetime-local` values
 * (interpreted as UTC) in addition to full ISO instants.
 */
export function parseExecutionHistorySearchParams(
  input: Record<string, string | string[] | undefined>,
): AutomationExecutionFilters {
  const filters: AutomationExecutionFilters = {};

  const page = fieldSchemas.page.safeParse(firstValue(input.page));
  if (page.success) filters.page = page.data;

  const limit = fieldSchemas.limit.safeParse(firstValue(input.limit));
  filters.limit = limit.success ? limit.data : EXECUTION_LIST_DEFAULT_LIMIT;

  const status = fieldSchemas.status.safeParse(firstValue(input.status));
  if (status.success) filters.status = status.data;

  const ruleId = fieldSchemas.ruleId.safeParse(firstValue(input.ruleId));
  if (ruleId.success) filters.ruleId = ruleId.data;

  const triggerType = fieldSchemas.triggerType.safeParse(firstValue(input.triggerType));
  if (triggerType.success) filters.sourceEventType = triggerType.data;

  const ticketId = fieldSchemas.ticketId.safeParse(firstValue(input.ticketId));
  if (ticketId.success) filters.ticketId = ticketId.data;

  const from = fieldSchemas.from.safeParse(utcInputToInstant(firstValue(input.from))?.toISOString());
  if (from.success) filters.from = new Date(from.data);

  const to = fieldSchemas.to.safeParse(utcInputToInstant(firstValue(input.to))?.toISOString());
  if (to.success) filters.to = new Date(to.data);

  return filters;
}
