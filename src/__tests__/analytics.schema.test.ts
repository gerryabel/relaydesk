import { describe, it, expect, vi } from 'vitest';
import {
  parseDateOnlyUtc,
  resolveDateRange,
  getDefaultDateRange,
  buildDailyBuckets,
  formatDuration,
  dateOnlySchema,
  dateRangeQuerySchema,
  DEFAULT_RANGE_DAYS,
} from '@/lib/analytics/schema';

describe('parseDateOnlyUtc', () => {
  it('parses a valid date to UTC midnight', () => {
    const d = parseDateOnlyUtc('2026-09-17');
    expect(d.getUTCFullYear()).toBe(2026);
    expect(d.getUTCMonth()).toBe(8); // September, 0-indexed
    expect(d.getUTCDate()).toBe(17);
    expect(d.getUTCHours()).toBe(0);
    expect(d.getUTCMinutes()).toBe(0);
    expect(d.getUTCSeconds()).toBe(0);
    expect(d.getUTCMilliseconds()).toBe(0);
  });

  it('rejects malformed strings', () => {
    expect(Number.isNaN(parseDateOnlyUtc('2026-9-17').getTime())).toBe(true);
    expect(Number.isNaN(parseDateOnlyUtc('2026/09/17').getTime())).toBe(true);
    expect(Number.isNaN(parseDateOnlyUtc('not-a-date').getTime())).toBe(true);
    expect(Number.isNaN(parseDateOnlyUtc('').getTime())).toBe(true);
  });

  it('rejects invalid calendar dates', () => {
    // month 13, day 32, Feb 30
    expect(Number.isNaN(parseDateOnlyUtc('2026-13-01').getTime())).toBe(true);
    expect(Number.isNaN(parseDateOnlyUtc('2026-00-01').getTime())).toBe(true);
    expect(Number.isNaN(parseDateOnlyUtc('2026-01-32').getTime())).toBe(true);
    expect(Number.isNaN(parseDateOnlyUtc('2026-02-30').getTime())).toBe(true);
    // 2026 is not a leap year → Feb 29 invalid
    expect(Number.isNaN(parseDateOnlyUtc('2026-02-29').getTime())).toBe(true);
  });

  it('accepts leap day on leap years', () => {
    const d = parseDateOnlyUtc('2024-02-29');
    expect(Number.isNaN(d.getTime())).toBe(false);
    expect(d.getUTCDate()).toBe(29);
  });
});

describe('resolveDateRange', () => {
  it('builds [start, end) range with end = day after `to`', () => {
    const range = resolveDateRange('2026-09-01', '2026-09-03');
    expect(range).not.toBeNull();
    expect(range!.from).toBe('2026-09-01');
    expect(range!.to).toBe('2026-09-03');
    // start = midnight Sep 1
    expect(range!.start.toISOString()).toBe('2026-09-01T00:00:00.000Z');
    // end = midnight Sep 4 (day after to)
    expect(range!.end.toISOString()).toBe('2026-09-04T00:00:00.000Z');
    expect(range!.totalDays).toBe(3);
  });

  it('excludes the exact end day (end is exclusive)', () => {
    const range = resolveDateRange('2026-09-10', '2026-09-10');
    expect(range).not.toBeNull();
    // start == to; end is to+1
    expect(range!.start.toISOString()).toBe('2026-09-10T00:00:00.000Z');
    expect(range!.end.toISOString()).toBe('2026-09-11T00:00:00.000Z');
    expect(range!.totalDays).toBe(1);
  });

  it('returns null for malformed from/to', () => {
    expect(resolveDateRange('garbage', '2026-09-10')).toBeNull();
    expect(resolveDateRange('2026-09-10', 'garbage')).toBeNull();
    expect(resolveDateRange('2026-13-01', '2026-09-10')).toBeNull();
    expect(resolveDateRange(undefined, undefined)).toBeNull();
  });

  it('rejects inverted ranges (from > to)', () => {
    expect(resolveDateRange('2026-09-10', '2026-09-01')).toBeNull();
  });

  it('rejects ranges exceeding MAX_RANGE_DAYS', () => {
    const range = resolveDateRange('2020-01-01', '2026-01-01');
    expect(range).toBeNull();
  });
});

describe('getDefaultDateRange', () => {
  it('returns the most recent DEFAULT_RANGE_DAYS days including today', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-09-17T14:25:00Z'));

    const range = getDefaultDateRange();
    expect(range.totalDays).toBe(DEFAULT_RANGE_DAYS);
    expect(range.to).toBe('2026-09-17');
    expect(range.from).toBe('2026-08-19'); // 29 days before inclusive
    // start is UTC midnight of from; end is day after to
    expect(range.start.toISOString()).toBe('2026-08-19T00:00:00.000Z');
    expect(range.end.toISOString()).toBe('2026-09-18T00:00:00.000Z');

    vi.useRealTimers();
  });
});

describe('dateOnlySchema', () => {
  it('accepts valid YYYY-MM-DD', () => {
    expect(dateOnlySchema.safeParse('2026-09-17').success).toBe(true);
  });

  it('rejects invalid formats', () => {
    expect(dateOnlySchema.safeParse('2026/09/17').success).toBe(false);
    expect(dateOnlySchema.safeParse('2026-9-17').success).toBe(false);
    expect(dateOnlySchema.safeParse('2026-02-30').success).toBe(false);
    expect(dateOnlySchema.safeParse('not-a-date').success).toBe(false);
    expect(dateOnlySchema.safeParse('').success).toBe(false);
  });
});

describe('dateRangeQuerySchema', () => {
  it('returns a valid range for valid input', () => {
    const result = dateRangeQuerySchema.parse({ from: '2026-09-01', to: '2026-09-10' });
    expect(result.from).toBe('2026-09-01');
    expect(result.to).toBe('2026-09-10');
  });

  it('falls back to default range when params missing', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-09-17T14:25:00Z'));

    const result = dateRangeQuerySchema.parse({});
    expect(result.to).toBe('2026-09-17');
    expect(result.totalDays).toBe(DEFAULT_RANGE_DAYS);

    vi.useRealTimers();
  });

  it('falls back to default range for malformed input', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-09-17T14:25:00Z'));

    const result = dateRangeQuerySchema.parse({ from: 'garbage', to: '2026-09-10' });
    expect(result.to).toBe('2026-09-17');
    expect(result.totalDays).toBe(DEFAULT_RANGE_DAYS);

    vi.useRealTimers();
  });

  it('falls back to default range for inverted range', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-09-17T14:25:00Z'));

    const result = dateRangeQuerySchema.parse({ from: '2026-09-10', to: '2026-09-01' });
    expect(result.to).toBe('2026-09-17');
    expect(result.totalDays).toBe(DEFAULT_RANGE_DAYS);

    vi.useRealTimers();
  });
});

describe('buildDailyBuckets', () => {
  it('produces consecutive UTC calendar days for the range', () => {
    const range = resolveDateRange('2026-09-01', '2026-09-05')!;
    const buckets = buildDailyBuckets(range);
    expect(buckets).toEqual([
      '2026-09-01',
      '2026-09-02',
      '2026-09-03',
      '2026-09-04',
      '2026-09-05',
    ]);
  });

  it('generates zero-filled buckets even with no data', () => {
    const range = resolveDateRange('2026-09-10', '2026-09-10')!;
    const buckets = buildDailyBuckets(range);
    expect(buckets).toEqual(['2026-09-10']);
    expect(buckets).toHaveLength(1);
  });
});

describe('formatDuration', () => {
  it('returns null for null/zero/negative', () => {
    expect(formatDuration(null)).toBeNull();
    expect(formatDuration(0)).toBeNull();
    expect(formatDuration(-1)).toBeNull();
  });

  it('formats minutes', () => {
    expect(formatDuration(45 * 60 * 1000)).toBe('45m');
  });

  it('formats hours and minutes', () => {
    expect(formatDuration((3 * 60 + 30) * 60 * 1000)).toBe('3h 30m');
  });

  it('formats days, hours and minutes', () => {
    expect(formatDuration(2 * 24 * 60 * 60 * 1000 + 5 * 60 * 60 * 1000 + 30 * 60 * 1000)).toBe('2d 5h 30m');
  });

  it('formats whole hours as 0m minutes', () => {
    expect(formatDuration(3 * 60 * 60 * 1000)).toBe('3h 0m');
  });
});
