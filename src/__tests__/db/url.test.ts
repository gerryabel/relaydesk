import { describe, it, expect, afterEach } from 'vitest';
import { getTestDatabaseUrl } from '../../lib/test/db';

describe('getTestDatabaseUrl', () => {
  const original = process.env.DATABASE_URL_TEST;
  const originalDev = process.env.DATABASE_URL;

  afterEach(() => {
    if (original === undefined) {
      delete process.env.DATABASE_URL_TEST;
    } else {
      process.env.DATABASE_URL_TEST = original;
    }

    if (originalDev === undefined) {
      delete process.env.DATABASE_URL;
    } else {
      process.env.DATABASE_URL = originalDev;
    }
  });

  it('throws when DATABASE_URL_TEST is missing', () => {
    delete process.env.DATABASE_URL_TEST;
    delete process.env.DATABASE_URL;

    expect(() => getTestDatabaseUrl()).toThrow(
      'DATABASE_URL_TEST is not set. Refusing to run database tests without a dedicated test database.'
    );
  });

  it('does not fall back to DATABASE_URL', () => {
    delete process.env.DATABASE_URL_TEST;
    process.env.DATABASE_URL = 'postgresql://localhost/dev';

    expect(() => getTestDatabaseUrl()).toThrow(
      'DATABASE_URL_TEST is not set. Refusing to run database tests without a dedicated test database.'
    );
  });

  it('returns DATABASE_URL_TEST when provided', () => {
    process.env.DATABASE_URL_TEST = 'postgresql://localhost/test';

    expect(getTestDatabaseUrl()).toBe('postgresql://localhost/test');
  });

  it('ignores DATABASE_URL when DATABASE_URL_TEST is present', () => {
    process.env.DATABASE_URL_TEST = 'postgresql://localhost/test';
    process.env.DATABASE_URL = 'postgresql://localhost/dev';

    expect(getTestDatabaseUrl()).toBe('postgresql://localhost/test');
  });
});
