import { describe, it, expect, afterEach } from 'vitest';
import { getTestDatabaseUrl } from '../../lib/test/db';

describe('getTestDatabaseUrl', () => {
  const original = process.env.DATABASE_URL_TEST;

  afterEach(() => {
    if (original === undefined) {
      delete process.env.DATABASE_URL_TEST;
    } else {
      process.env.DATABASE_URL_TEST = original;
    }
  });

  it('throws when DATABASE_URL_TEST is missing', () => {
    delete process.env.DATABASE_URL_TEST;

    expect(() => getTestDatabaseUrl()).toThrow(
      'DATABASE_URL_TEST is not set. Refusing to run database tests without a dedicated test database.'
    );
  });

  it('returns DATABASE_URL_TEST when provided', () => {
    process.env.DATABASE_URL_TEST = 'postgresql://localhost/relaydesk_test';

    expect(getTestDatabaseUrl()).toBe('postgresql://localhost/relaydesk_test');
  });
});
