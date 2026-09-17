import { z } from 'zod';

/**
 * Date-range validation and UTC boundary construction for Analytics.
 *
 * Time semantics (docs/phase-7/spec.md §5.5):
 *  - Timezone: UTC
 *  - Calendar-day boundary: 00:00:00 UTC
 *  - Range: [start, end) — inclusive start, exclusive end
 *  - Daily granularity
 *
 * Date-only UI values such as `2026-09-17` are interpreted as UTC calendar
 * dates and constructed explicitly via Date.UTC to avoid host-timezone
 * ambiguity (e.g. `new Date("YYYY-MM-DD")` is parsed as UTC in some engines
 * but the spec requires explicit, unambiguous construction).
 */

const DATE_ONLY_RE = /^\d{4}-\d{2}-\d{2}$/;

/** Default analytics window: most recent N UTC calendar days, inclusive. */
export const DEFAULT_RANGE_DAYS = 30;

/** Hard cap on the selectable window to keep queries bounded. */
export const MAX_RANGE_DAYS = 365;

export const dateOnlySchema = z
  .string()
  .trim()
  .regex(DATE_ONLY_RE, 'Date must be in YYYY-MM-DD format')
  .refine((value) => !Number.isNaN(parseDateOnlyUtc(value).getTime()), {
    message: 'Invalid calendar date',
  });

export const dateRangeQuerySchema = z
  .object({
    from: z.string().optional(),
    to: z.string().optional(),
  })
  .transform((input) => {
    const range = resolveDateRange(input.from, input.to);
    // Fall back to the default range for any invalid/malformed/inverted input
    // rather than throwing, so the analytics page always renders.
    return range ?? getDefaultDateRange();
  });

export type DateRangeQueryInput = z.infer<typeof dateRangeQuerySchema>;

/**
 * Parses a `YYYY-MM-DD` string into a UTC-midnight Date.
 * Returns an Invalid Date for malformed/nonexistent calendar dates.
 */
export function parseDateOnlyUtc(value: string): Date {
  if (!DATE_ONLY_RE.test(value)) {
    return new Date(Number.NaN);
  }

  const [yearStr, monthStr, dayStr] = value.split('-');
  const year = Number(yearStr);
  const monthIndex = Number(monthStr) - 1;
  const day = Number(dayStr);

  if (!isValidCalendarDate(year, monthIndex, day)) {
    return new Date(Number.NaN);
  }

  return new Date(Date.UTC(year, monthIndex, day));
}

function isValidCalendarDate(year: number, monthIndex: number, day: number): boolean {
  if (!Number.isInteger(year) || !Number.isInteger(monthIndex) || !Number.isInteger(day)) {
    return false;
  }
  if (monthIndex < 0 || monthIndex > 11) return false;
  if (day < 1 || day > 31) return false;

  // Verify the date is real by round-tripping through Date.UTC.
  const ms = Date.UTC(year, monthIndex, day);
  const date = new Date(ms);
  return (
    date.getUTCFullYear() === year &&
    date.getUTCMonth() === monthIndex &&
    date.getUTCDate() === day
  );
}

/**
 * Builds a UTC [start, end) range from inclusive `from`/`to` calendar dates.
 * `start` is UTC midnight of `from`; `end` is UTC midnight immediately after
 * `to` (i.e. `to + 1 day`), so queries use `>= start AND < end`.
 *
 * Returns null when the input cannot be resolved to a valid range.
 */
export function resolveDateRange(
  from: string | undefined,
  to: string | undefined,
): {
  from: string;
  to: string;
  start: Date;
  end: Date;
  totalDays: number;
} | null {
  let start = from ? parseDateOnlyUtc(from) : null;
  let endExclusive = to ? parseDateOnlyUtc(to) : null;

  if (start && Number.isNaN(start.getTime())) start = null;
  if (endExclusive && Number.isNaN(endExclusive.getTime())) endExclusive = null;

  if (!start || !endExclusive) {
    return null;
  }

  // `end` is exclusive: the day after `to`.
  const end = new Date(endExclusive.getTime() + 24 * 60 * 60 * 1000);

  if (start.getTime() > endExclusive.getTime()) {
    return null;
  }

  const totalMs = end.getTime() - start.getTime();
  const totalDays = Math.round(totalMs / (24 * 60 * 60 * 1000));

  if (totalDays > MAX_RANGE_DAYS) {
    return null;
  }

  return {
    from: from!,
    to: to!,
    start,
    end,
    totalDays,
  };
}

/**
 * Returns the default range: the most recent `DEFAULT_RANGE_DAYS` UTC calendar
 * days ending today (UTC). `from` is `DEFAULT_RANGE_DAYS - 1` days before today,
 * `to` is today, both inclusive.
 */
export function getDefaultDateRange(now: Date = new Date()): {
  from: string;
  to: string;
  start: Date;
  end: Date;
  totalDays: number;
} {
  const today = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
  const fromDate = new Date(today.getTime() - (DEFAULT_RANGE_DAYS - 1) * 24 * 60 * 60 * 1000);
  const end = new Date(today.getTime() + 24 * 60 * 60 * 1000);

  return {
    from: formatDateOnly(fromDate),
    to: formatDateOnly(today),
    start: fromDate,
    end,
    totalDays: DEFAULT_RANGE_DAYS,
  };
}

/** Formats a Date as `YYYY-MM-DD` in UTC. */
export function formatDateOnly(date: Date): string {
  const year = date.getUTCFullYear();
  const month = String(date.getUTCMonth() + 1).padStart(2, '0');
  const day = String(date.getUTCDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

/**
 * Generates the complete ordered list of UTC calendar-day buckets for a range.
 * Each entry is `YYYY-MM-DD`. Length equals `totalDays` (from..to inclusive).
 */
export function buildDailyBuckets(range: {
  from: string;
  to: string;
  start: Date;
  end: Date;
  totalDays: number;
}): string[] {
  const buckets: string[] = [];
  for (let i = 0; i < range.totalDays; i += 1) {
    const day = new Date(range.start.getTime() + i * 24 * 60 * 60 * 1000);
    buckets.push(formatDateOnly(day));
  }
  return buckets;
}

/**
 * Formats a millisecond duration into a compact human-readable string.
 * Returns null for null/zero/negative input.
 *
 * Examples: "2d 5h 30m", "45m", "3h 0m", "10d 0h 0m".
 */
export function formatDuration(ms: number | null): string | null {
  if (ms == null || ms <= 0 || !Number.isFinite(ms)) return null;

  const totalMinutes = Math.floor(ms / 60000);
  const days = Math.floor(totalMinutes / (24 * 60));
  const hours = Math.floor((totalMinutes % (24 * 60)) / 60);
  const minutes = totalMinutes % 60;

  const parts: string[] = [];
  if (days > 0) parts.push(`${days}d`);
  if (days > 0 || hours > 0) parts.push(`${hours}h`);
  parts.push(`${minutes}m`);

  return parts.join(' ');
}
