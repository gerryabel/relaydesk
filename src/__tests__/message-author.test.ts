import { describe, it, expect } from 'vitest';
import {
  assertMessageAuthor,
  isMessageAuthorType,
  MESSAGE_AUTHOR_KEYS,
  MessageAuthorshipError,
  messageAuthorTypeSchema,
} from '@/lib/messages/authorship';

/**
 * Message authorship contract (Phase 9 Task 3).
 *
 * The three PostgreSQL CHECK constraints added by the Task 3 migration enforce
 * this same table of rules; these tests cover the side of it that a unit test
 * can prove — that the write-side assertion used by the agent and customer
 * services rejects every shape the database would also reject.
 *
 * A mismatch between the two would be the dangerous kind of bug: the service
 * would accept a write in tests and fail at runtime, or worse, the service
 * would reject a valid write and the migration's backfill would be wrong.
 */
describe('author type enumeration', () => {
  it('accepts exactly the three values the database enum declares', () => {
    expect(messageAuthorTypeSchema.options).toEqual(['agent', 'customer', 'system']);
  });

  it('recognises only those three', () => {
    expect(isMessageAuthorType('agent')).toBe(true);
    expect(isMessageAuthorType('customer')).toBe(true);
    expect(isMessageAuthorType('system')).toBe(true);

    expect(isMessageAuthorType('ADMIN')).toBe(false);
    expect(isMessageAuthorType(null)).toBe(false);
    expect(isMessageAuthorType(undefined)).toBe(false);
    expect(isMessageAuthorType(1)).toBe(false);
  });
});

describe('MESSAGE_AUTHOR_KEYS', () => {
  it('states the same table the migration encodes', () => {
    expect(MESSAGE_AUTHOR_KEYS).toEqual({
      agent: { createdById: 'required', customerId: 'forbidden' },
      customer: { createdById: 'forbidden', customerId: 'required' },
      system: { createdById: 'forbidden', customerId: 'forbidden' },
    });
  });
});

describe('assertMessageAuthor', () => {
  it('accepts a well-formed agent message', () => {
    expect(() =>
      assertMessageAuthor({ authorType: 'agent', createdById: 'user-1', customerId: null }),
    ).not.toThrow();
  });

  it('accepts a well-formed customer message', () => {
    expect(() =>
      assertMessageAuthor({ authorType: 'customer', createdById: null, customerId: 'customer-1' }),
    ).not.toThrow();
  });

  it('accepts a well-formed system message', () => {
    expect(() =>
      assertMessageAuthor({ authorType: 'system', createdById: null, customerId: null }),
    ).not.toThrow();
  });

  it('rejects an agent message with no author', () => {
    // `message_author_agent` in the migration.
    expect(() =>
      assertMessageAuthor({ authorType: 'agent', createdById: null, customerId: null }),
    ).toThrow(MessageAuthorshipError);
  });

  it('rejects an agent message that also carries a customer', () => {
    expect(() =>
      assertMessageAuthor({ authorType: 'agent', createdById: 'user-1', customerId: 'customer-1' }),
    ).toThrow(/Agent-authored/);
  });

  it('rejects a customer message with no customer', () => {
    // `message_author_customer` in the migration.
    expect(() =>
      assertMessageAuthor({ authorType: 'customer', createdById: null, customerId: null }),
    ).toThrow(/Customer-authored/);
  });

  it('rejects a customer message that also claims a workspace user', () => {
    expect(() =>
      assertMessageAuthor({ authorType: 'customer', createdById: 'user-1', customerId: 'customer-1' }),
    ).toThrow(/Customer-authored/);
  });

  it('rejects a system message with either author', () => {
    // `message_author_system` in the migration.
    expect(() =>
      assertMessageAuthor({ authorType: 'system', createdById: 'user-1', customerId: null }),
    ).toThrow(/System-authored/);

    expect(() =>
      assertMessageAuthor({ authorType: 'system', createdById: null, customerId: 'customer-1' }),
    ).toThrow(/System-authored/);
  });

  it('names the broken half in the error code', () => {
    // A failing test should say which rule broke, not just "invalid".
    try {
      assertMessageAuthor({ authorType: 'agent', createdById: null, customerId: null });
      expect.unreachable('expected MessageAuthorshipError');
    } catch (error) {
      expect(error).toBeInstanceOf(MessageAuthorshipError);
      expect((error as MessageAuthorshipError).code).toBe('missing_agent_author');
      expect((error as MessageAuthorshipError).authorType).toBe('agent');
    }
  });
});
