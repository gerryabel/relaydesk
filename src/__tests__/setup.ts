import 'dotenv/config';
import { getTestDatabaseUrl } from '@/lib/test/db';

const testDatabaseUrl = getTestDatabaseUrl();

process.env.DATABASE_URL = testDatabaseUrl;
process.env.BETTER_AUTH_SECRET = 'relaydesk-test-only-secret-at-least-32-characters';
process.env.BETTER_AUTH_URL = 'http://localhost:3000';
