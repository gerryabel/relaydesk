import 'dotenv/config';
import { getTestDatabaseUrl } from '@/lib/test/db';

const testDatabaseUrl = getTestDatabaseUrl();

process.env.DATABASE_URL = testDatabaseUrl;
process.env.BETTER_AUTH_SECRET = 'relaydesk-test-only-secret-at-least-32-characters';
process.env.BETTER_AUTH_URL = 'http://localhost:3000';

// Suppress a known undici/NextRequest stream-lifetime artifact in the Node.js
// test environment: manual `getReader()` consumption of a `FormData`-backed
// request body can leave a nextTick queued that tries to enqueue into an
// already-closed `ReadableByteStreamController`, producing `ERR_INVALID_STATE`.
// This does not affect runtime behavior.
process.on('unhandledRejection', (reason) => {
  const err = reason instanceof Error ? reason : new Error(String(reason));
  const code = (err as Error & { code?: string }).code;
  if (
    code === 'ERR_INVALID_STATE' &&
    /ReadableStream is already closed/.test(err.message) &&
    /ReadableByteStreamController\.enqueue/.test(err.stack || '')
  ) {
    return;
  }
  throw reason;
});
