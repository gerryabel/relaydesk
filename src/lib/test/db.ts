const TEST_DATABASE_URL_ERROR = 'DATABASE_URL_TEST is not set. Refusing to run database tests without a dedicated test database.';

export function getTestDatabaseUrl(): string {
  const value = process.env.DATABASE_URL_TEST;

  if (!value) {
    throw new Error(TEST_DATABASE_URL_ERROR);
  }

  return value;
}
