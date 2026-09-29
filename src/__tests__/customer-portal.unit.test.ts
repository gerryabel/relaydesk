import { describe, it, expect } from 'vitest';
import {
  formatTicketReference,
  toTicketReferenceCode,
} from '@/lib/customer-portal/reference';
import {
  buildLastVisibleActivityMap,
  resolveLastVisibleActivity,
} from '@/lib/customer-portal/activity';
import {
  resolveCustomerMessageAuthor,
  toCustomerMessageView,
  toCustomerTicketDetail,
  toCustomerTicketSummary,
} from '@/lib/customer-portal/dto';
import {
  createCustomerTicketSchema,
  customerTicketListQuerySchema,
  normalizeCustomerTicketListParams,
  parseCreateCustomerTicketInput,
  parseCustomerTicketListQuery,
} from '@/lib/customer-portal/schema';
import { CustomerTicketValidationError } from '@/lib/customer-portal/errors';

/**
 * Pure logic behind the customer portal (Phase 9 Task 2).
 *
 * No database, no session, no Prisma. These are the parts where a regression
 * is both most likely and most damaging: the DTO allowlist is the only thing
 * standing between an internal column and a customer, and the activity rule is
 * what keeps internal edits invisible.
 */

describe('ticket reference', () => {
  it('is deterministic for the same id', () => {
    expect(toTicketReferenceCode('ticket-abc')).toBe(toTicketReferenceCode('ticket-abc'));
  });

  it('differs between ids', () => {
    expect(toTicketReferenceCode('ticket-abc')).not.toBe(toTicketReferenceCode('ticket-abd'));
  });

  it('is fixed width and uses only 0-9A-Z', () => {
    for (let index = 0; index < 200; index += 1) {
      const code = toTicketReferenceCode(`ticket-${index}`);

      expect(code).toHaveLength(8);
      expect(code).toMatch(/^[0-9A-Z]{8}$/);
    }
  });

  it('renders with a leading hash', () => {
    expect(formatTicketReference('ticket-abc')).toBe(`#${toTicketReferenceCode('ticket-abc')}`);
    expect(formatTicketReference('ticket-abc')).toMatch(/^#[0-9A-Z]{8}$/);
  });

  it('does not preserve the id in the reference', () => {
    expect(formatTicketReference('ticket-abc')).not.toContain('ticket-abc');
  });

  it('is roughly uniform, so it leaks no ordering', () => {
    // A counter would produce a tightly clustered alphabet. Distinct ids
    // should not.
    const codes = new Set(
      Array.from({ length: 500 }, (_, index) => toTicketReferenceCode(`ticket-${index}`)),
    );

    expect(codes.size).toBe(500);
  });
});

describe('last visible activity', () => {
  const createdAt = new Date('2026-01-01T10:00:00Z');

  it('falls back to creation time when there are no messages', () => {
    expect(resolveLastVisibleActivity(createdAt, null).getTime()).toBe(createdAt.getTime());
    expect(resolveLastVisibleActivity(createdAt, undefined).getTime()).toBe(createdAt.getTime());
  });

  it('uses the newest message when one is later than creation', () => {
    const messageAt = new Date('2026-01-02T10:00:00Z');

    expect(resolveLastVisibleActivity(createdAt, messageAt).getTime()).toBe(messageAt.getTime());
  });

  it('ignores a message that predates creation', () => {
    // Defensive: a message cannot legitimately precede its ticket, but if a
    // clock skew or a bad import produced one, it must not make the ticket
    // look stale.
    const earlier = new Date('2025-12-31T10:00:00Z');

    expect(resolveLastVisibleActivity(createdAt, earlier).getTime()).toBe(createdAt.getTime());
  });

  it('maps every ticket, defaulting to creation', () => {
    const a = { id: 'a', createdAt };
    const b = { id: 'b', createdAt };
    const messageAt = new Date('2026-01-03T10:00:00Z');
    const activity = buildLastVisibleActivityMap([a, b], new Map([['b', messageAt]]));

    expect(activity.get('a')?.getTime()).toBe(createdAt.getTime());
    expect(activity.get('b')?.getTime()).toBe(messageAt.getTime());
  });
});

describe('customer DTOs', () => {
  const now = new Date('2026-01-01T10:00:00Z');

  it('summary carries no internal fields', () => {
    const summary = toCustomerTicketSummary({
      id: 'ticket-1',
      title: 'Printer is offline',
      status: 'open',
      priority: 'medium',
      createdAt: now,
      lastActivityAt: now,
    });

    expect(Object.keys(summary).sort()).toEqual([
      'createdAt',
      'id',
      'lastActivityAt',
      'priority',
      'reference',
      'status',
      'title',
    ]);

    const serialized = JSON.stringify(summary);

    for (const forbidden of [
      'workspaceId',
      'customerId',
      'createdById',
      'assignedToId',
      'updatedAt',
      'firstResponseAt',
      'responseSlaDeadline',
      'resolutionSlaDeadline',
      'internal',
    ]) {
      expect(serialized).not.toContain(forbidden);
    }
  });

  it('detail carries no internal fields and no actions in Task 2', () => {
    const detail = toCustomerTicketDetail({
      id: 'ticket-1',
      title: 'Printer is offline',
      description: 'It stopped this morning.',
      status: 'open',
      priority: 'medium',
      createdAt: now,
      lastActivityAt: now,
      resolvedAt: null,
      conversation: [],
    });

    expect(Object.keys(detail).sort()).toEqual([
      'availableActions',
      'conversation',
      'createdAt',
      'description',
      'id',
      'lastActivityAt',
      'priority',
      'reference',
      'resolvedAt',
      'status',
      'title',
    ]);

    // Task 3 adds `reply`, Task 4 adds `attach`. Neither is available yet, and
    // the UI must render from this list rather than from a hard-coded absence.
    expect(detail.availableActions).toEqual([]);
  });

  it('classifies message authors without exposing member identity', () => {
    expect(resolveCustomerMessageAuthor('user-1')).toBe('support');
    expect(resolveCustomerMessageAuthor(null)).toBe('system');
  });

  it('message view never serializes the raw message id', () => {
    const view = toCustomerMessageView({
      id: 'message-secret-id',
      createdById: 'user-1',
      body: 'Looking into it.',
      createdAt: now,
    });

    expect(view).not.toHaveProperty('id');
    expect(view).not.toHaveProperty('createdById');
    expect(JSON.stringify(view)).not.toContain('message-secret-id');
    expect(view.reference).toBe(toTicketReferenceCode('message-secret-id'));
  });
});

describe('create ticket input', () => {
  it('accepts only title and description', () => {
    const parsed = createCustomerTicketSchema.parse({ title: '  Offline  ', description: 'Help' });

    expect(parsed).toEqual({ title: 'Offline', description: 'Help' });
  });

  it('normalizes a blank description to null', () => {
    expect(createCustomerTicketSchema.parse({ title: 'Offline', description: '   ' }).description).toBeNull();
    expect(createCustomerTicketSchema.parse({ title: 'Offline' }).description).toBeNull();
  });

  it.each([
    'customerId',
    'workspaceId',
    'priority',
    'status',
    'assignedToId',
    'createdById',
    'responseSlaDeadline',
  ])('rejects a caller-supplied %s', (key) => {
    const payload: Record<string, unknown> = { title: 'Offline' };
    payload[key] = 'anything';

    // Strict, not lenient: a caller must be told their value was ignored,
    // rather than silently believing it took effect.
    expect(() => createCustomerTicketSchema.parse(payload)).toThrow();
  });

  it('enforces title bounds', () => {
    expect(() => createCustomerTicketSchema.parse({ title: '   ' })).toThrow();
    expect(() => createCustomerTicketSchema.parse({ title: 'a'.repeat(141) })).toThrow();
  });

  it('enforces description bounds', () => {
    expect(() => createCustomerTicketSchema.parse({ title: 'ok', description: 'a'.repeat(5001) })).toThrow();
  });

  it('surfaces a portal-safe error rather than a raw ZodError', () => {
    expect(() => parseCreateCustomerTicketInput({})).toThrow(CustomerTicketValidationError);
  });
});

describe('list query input', () => {
  it('accepts the four documented parameters', () => {
    expect(
      customerTicketListQuerySchema.parse({ q: 'printer', status: 'open', page: '2', limit: '10' }),
    ).toEqual({ q: 'printer', status: 'open', page: 2, limit: 10 });
  });

  it('rejects an unknown parameter', () => {
    expect(() => customerTicketListQuerySchema.parse({ q: 'ok', customerId: 'x' })).toThrow();
  });

  it('rejects a nonsensical page or limit', () => {
    expect(() => customerTicketListQuerySchema.parse({ page: '0' })).toThrow();
    expect(() => customerTicketListQuerySchema.parse({ page: 'abc' })).toThrow();
    expect(() => customerTicketListQuerySchema.parse({ limit: '1000' })).toThrow();
  });

  it('rejects an unknown status', () => {
    expect(() => customerTicketListQuerySchema.parse({ status: 'escalated' })).toThrow();
  });

  it('keeps only the allowlisted keys from a real query string', () => {
    const params = normalizeCustomerTicketListParams({
      q: 'printer',
      page: '3',
      customerId: 'attacker-controlled',
      _rsc: 'abc',
    });

    expect(params).toEqual({ q: 'printer', status: undefined, page: '3', limit: undefined });
    expect(params).not.toHaveProperty('customerId');
    expect(params).not.toHaveProperty('_rsc');
  });

  it('treats a repeated parameter as its first value', () => {
    expect(normalizeCustomerTicketListParams({ q: ['first', 'second'] })).toMatchObject({
      q: 'first',
    });
  });

  it('treats an empty value as absent', () => {
    // Collapsing happens in the normalizer, which is what both the route and
    // the page use — a blank `?page=` must not become `Number('')` → `0`.
    const params = normalizeCustomerTicketListParams({ page: '', limit: '   ' });

    expect(params).toEqual({ q: undefined, status: undefined, page: undefined, limit: undefined });
    expect(parseCustomerTicketListQuery(params)).toEqual({});
  });
});
