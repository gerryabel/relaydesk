import { describe, it, expect } from 'vitest';
import {
  EXECUTION_LIST_DEFAULT_LIMIT,
  EXECUTION_LIST_MAX_LIMIT,
  AUTOMATION_EXECUTION_STATUSES,
  executionListQuerySchema,
  retryActionParamsSchema,
  readExecutionListQuery,
  parseExecutionHistorySearchParams,
  toExecutionFilters,
  toUtcDateTimeLocalValue,
  utcInputToInstant,
} from '@/lib/automation/executions-schema';

describe('execution status enumeration', () => {
  it('mirrors the Prisma AutomationExecutionStatus members', () => {
    expect([...AUTOMATION_EXECUTION_STATUSES].sort()).toEqual(
      [
        'awaiting_actions',
        'completed',
        'evaluating',
        'executing',
        'failed',
        'partial_failure',
        'pending',
        'skipped',
      ].sort(),
    );
  });

  it('uses the documented page size bounds', () => {
    expect(EXECUTION_LIST_DEFAULT_LIMIT).toBe(20);
    expect(EXECUTION_LIST_MAX_LIMIT).toBe(100);
  });
});

describe('executionListQuerySchema', () => {
  it('coerces numeric strings', () => {
    const parsed = executionListQuerySchema.parse({ page: '3', limit: '25' });
    expect(parsed).toEqual({ page: 3, limit: 25 });
  });

  it('rejects an inverted or empty date interval', () => {
    expect(
      executionListQuerySchema.safeParse({
        from: '2026-02-01T00:00:00Z',
        to: '2026-01-01T00:00:00Z',
      }).success,
    ).toBe(false);
    expect(
      executionListQuerySchema.safeParse({
        from: '2026-01-01T00:00:00Z',
        to: '2026-01-01T00:00:00Z',
      }).success,
    ).toBe(false);
  });

  it('allows either bound to be omitted', () => {
    expect(executionListQuerySchema.safeParse({ from: '2026-01-01T00:00:00Z' }).success).toBe(true);
    expect(executionListQuerySchema.safeParse({ to: '2026-01-01T00:00:00Z' }).success).toBe(true);
  });
});

describe('readExecutionListQuery', () => {
  it('reports failure for invalid input', () => {
    const parsed = readExecutionListQuery(new URLSearchParams('limit=0'));
    expect(parsed.success).toBe(false);
  });

  it('succeeds with an empty query', () => {
    const parsed = readExecutionListQuery(new URLSearchParams(''));
    expect(parsed.success).toBe(true);
    if (parsed.success) {
      expect(toExecutionFilters(parsed.data)).toEqual({ page: 1, limit: 20 });
    }
  });
});

describe('toExecutionFilters', () => {
  it('maps triggerType onto sourceEventType', () => {
    expect(toExecutionFilters({ triggerType: 'SLA_BREACHED' })).toEqual({
      page: 1,
      limit: 20,
      sourceEventType: 'SLA_BREACHED',
    });
  });

  it('omits absent filters entirely', () => {
    expect(toExecutionFilters({})).toEqual({ page: 1, limit: 20 });
  });

  it('converts ISO instants into Date bounds', () => {
    const filters = toExecutionFilters({
      from: '2026-01-01T00:00:00Z',
      to: '2026-02-01T00:00:00Z',
    });

    expect(filters.from).toBeInstanceOf(Date);
    expect(filters.to).toBeInstanceOf(Date);
    expect(filters.from!.toISOString()).toBe('2026-01-01T00:00:00.000Z');
    expect(filters.to!.toISOString()).toBe('2026-02-01T00:00:00.000Z');
  });
});

describe('utcInputToInstant', () => {
  it('treats a bare datetime-local value as UTC', () => {
    expect(utcInputToInstant('2026-01-31T09:30')?.toISOString()).toBe('2026-01-31T09:30:00.000Z');
  });

  it('passes through an explicit Z or offset', () => {
    expect(utcInputToInstant('2026-01-31T09:30:00Z')?.toISOString()).toBe(
      '2026-01-31T09:30:00.000Z',
    );
    expect(utcInputToInstant('2026-01-31T09:30:00+07:00')?.toISOString()).toBe(
      '2026-01-31T02:30:00.000Z',
    );
  });

  it('rejects empty and malformed values', () => {
    expect(utcInputToInstant(undefined)).toBeUndefined();
    expect(utcInputToInstant('')).toBeUndefined();
    expect(utcInputToInstant('   ')).toBeUndefined();
    expect(utcInputToInstant('yesterday')).toBeUndefined();
    expect(utcInputToInstant(12345)).toBeUndefined();
  });
});

describe('toUtcDateTimeLocalValue', () => {
  it('round-trips a datetime-local value', () => {
    expect(toUtcDateTimeLocalValue(new Date('2026-01-31T09:30:15.000Z'))).toBe('2026-01-31T09:30');
  });

  it('returns an empty string for no date', () => {
    expect(toUtcDateTimeLocalValue(undefined)).toBe('');
  });
});

describe('parseExecutionHistorySearchParams', () => {
  it('defaults to page 1 and the default page size', () => {
    expect(parseExecutionHistorySearchParams({})).toEqual({ limit: 20 });
  });

  it('reads every supported filter', () => {
    expect(
      parseExecutionHistorySearchParams({
        page: '2',
        limit: '50',
        status: 'partial_failure',
        ruleId: 'rule-1',
        triggerType: 'TICKET_CREATED',
        ticketId: 'ticket-1',
        from: '2026-01-01T00:00',
        to: '2026-02-01T00:00',
      }),
    ).toEqual({
      page: 2,
      limit: 50,
      status: 'partial_failure',
      ruleId: 'rule-1',
      sourceEventType: 'TICKET_CREATED',
      ticketId: 'ticket-1',
      from: new Date('2026-01-01T00:00:00.000Z'),
      to: new Date('2026-02-01T00:00:00.000Z'),
    });
  });

  it('drops an invalid field while keeping the valid ones', () => {
    const filters = parseExecutionHistorySearchParams({
      status: 'nonsense',
      limit: '9999',
      ruleId: 'rule-1',
      from: 'not-a-date',
    });

    expect(filters.status).toBeUndefined();
    expect(filters.limit).toBe(20);
    expect(filters.from).toBeUndefined();
    expect(filters.ruleId).toBe('rule-1');
  });

  it('clamps an over-large page size to the maximum', () => {
    expect(parseExecutionHistorySearchParams({ limit: '9999' }).limit).toBe(20);
    expect(parseExecutionHistorySearchParams({ limit: '100' }).limit).toBe(100);
  });

  it('uses the first value when a parameter is repeated', () => {
    expect(parseExecutionHistorySearchParams({ ruleId: ['rule-1', 'rule-2'] }).ruleId).toBe(
      'rule-1',
    );
  });
});

describe('retryActionParamsSchema', () => {
  it('coerces a path segment into a non-negative integer', () => {
    expect(retryActionParamsSchema.parse({ executionId: 'exec-1', actionIndex: '2' })).toEqual({
      executionId: 'exec-1',
      actionIndex: 2,
    });
    expect(
      retryActionParamsSchema.safeParse({ executionId: 'exec-1', actionIndex: '-1' }).success,
    ).toBe(false);
    expect(
      retryActionParamsSchema.safeParse({ executionId: '  ', actionIndex: '0' }).success,
    ).toBe(false);
  });
});
