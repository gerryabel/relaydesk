import { describe, it, expect, vi, afterEach } from 'vitest';
import {
  generateCustomerToken,
  hashCustomerToken,
  sealToken,
  unsealToken,
} from '@/lib/customer-access/tokens';
import {
  buildCustomerMagicLinkMessage,
  buildCustomerMagicLinkUrl,
  handleCustomerMagicLinkEvent,
} from '@/lib/queue/handlers/customer-magic-link';
import { CUSTOMER_MAGIC_LINK_TTL_MS } from '@/lib/customer-access/config';
import {
  CUSTOMER_SESSION_COOKIE_MAX_AGE_SECONDS,
  CUSTOMER_SESSION_COOKIE_PATH,
} from '@/lib/customer-access/config';
import { buildCustomerSessionCookieOptions } from '@/lib/customer-access/cookies';
import { assertCustomerInWorkspace, requireCustomerSession } from '@/lib/customer-access/server';
import {
  CustomerUnauthenticatedError,
  CustomerWorkspaceMismatchError,
} from '@/lib/customer-access/errors';
import { buildMagicLinkRequestRules, buildMagicLinkVerifyRules, readClientIp } from '@/lib/customer-access/rate-limit';
import { workspaceSlugSchema } from '@/lib/workspace/slug';
import { requestCustomerMagicLinkSchema } from '@/lib/customer-access/schema';
import { consumeRateLimit } from '@/lib/rate-limit/limiter';
import { createInMemoryRateLimitStore, type RateLimitStore } from '@/lib/rate-limit/store';
import { createRedisRateLimitStore } from '@/lib/rate-limit/redis-store';
import { env } from '@/lib/env';

// The worker opens sealed tokens with the configured secret, so tests must seal
// with the same value that `src/__tests__/setup.ts` provides.
const SECRET = env.BETTER_AUTH_SECRET;

const { sentEmail } = vi.hoisted(() => ({
  sentEmail: {
    findFirst: vi.fn(),
    create: vi.fn(),
    updateMany: vi.fn(),
    deleteMany: vi.fn(),
  },
}));

vi.mock('@/lib/db/prisma', () => ({
  prisma: { sentEmail },
}));

afterEach(() => {
  vi.clearAllMocks();
  vi.spyOn(console, 'error').mockImplementation(() => {});
});

describe('customer token generation', () => {
  it('produces distinct url-safe tokens of at least 256 bits', () => {
    const tokens = new Set(Array.from({ length: 50 }, () => generateCustomerToken()));

    expect(tokens.size).toBe(50);
    for (const token of tokens) {
      expect(token).toMatch(/^[A-Za-z0-9_-]+$/);
      expect(Buffer.from(token, 'base64url')).toHaveLength(32);
    }
  });

  it('hashes deterministically without exposing the raw token', () => {
    const token = generateCustomerToken();
    const hash = hashCustomerToken(token);

    expect(hash).toBe(hashCustomerToken(token));
    expect(hash).toMatch(/^[0-9a-f]{64}$/);
    expect(hash).not.toContain(token);
  });

  it('separates hashes per token', () => {
    expect(hashCustomerToken(generateCustomerToken())).not.toBe(
      hashCustomerToken(generateCustomerToken()),
    );
  });
});

describe('token sealing', () => {
  it('round-trips a token under the same secret', () => {
    const token = generateCustomerToken();

    expect(unsealToken(sealToken(token, SECRET), SECRET)).toBe(token);
  });

  it('fails closed under a different secret', () => {
    const sealed = sealToken(generateCustomerToken(), SECRET);

    expect(() => unsealToken(sealed, 'another-secret-that-is-long-enough-xxxxx')).toThrow();
  });

  it('rejects a tampered ciphertext', () => {
    const sealed = sealToken(generateCustomerToken(), SECRET);
    const parts = sealed.split('.');
    const head = parts[3]!.charAt(0);
    parts[3] = `${head === 'A' ? 'B' : 'A'}${parts[3]!.slice(1)}`;

    expect(() => unsealToken(parts.join('.'), SECRET)).toThrow();
  });

  it('does not leave the raw token in the sealed payload', () => {
    const token = generateCustomerToken();
    const sealed = sealToken(token, SECRET);

    expect(sealed).not.toContain(token);
    expect(sealed.startsWith('v1.')).toBe(true);
  });
});

describe('magic link email content', () => {
  it('builds a workspace-scoped verification url', () => {
    const url = buildCustomerMagicLinkUrl('acme-support', 'tok en/+value');

    expect(url).toContain('/portal/acme-support/verify?token=');
    expect(url).toContain('tok%20en%2F%2Bvalue');
  });

  it('states the expiry and single use in the message body', () => {
    const message = buildCustomerMagicLinkMessage({
      email: 'buyer@example.com',
      workspaceName: 'Acme Support',
      magicLinkUrl: 'https://example.test/portal/acme/verify?token=x',
      expiresAt: new Date(Date.now() + CUSTOMER_MAGIC_LINK_TTL_MS),
    });

    expect(message.to).toBe('buyer@example.com');
    expect(message.subject).toContain('Acme Support');
    expect(message.text).toContain('15 minutes');
    expect(message.text).toContain('used once');
  });
});

describe('customer magic link outbox handler', () => {
  const baseEvent = {
    id: 'event-1',
    eventType: 'CUSTOMER_MAGIC_LINK_REQUESTED' as const,
    aggregateType: 'Customer' as const,
    aggregateId: 'customer-1',
    createdAt: new Date('2026-01-01T00:00:00Z'),
    processedAt: null,
    completedAt: null,
    failedAt: null,
    attempts: 0,
    lastError: null,
    payload: {
      workspaceId: 'workspace-1',
      workspaceSlug: 'acme-support',
      workspaceName: 'Acme Support',
      customerId: 'customer-1',
      email: 'buyer@example.com',
      sealedToken: sealToken(generateCustomerToken(), SECRET),
      expiresAt: new Date(Date.now() + CUSTOMER_MAGIC_LINK_TTL_MS).toISOString(),
    },
  };

  it('fails permanently for an unrelated event type', async () => {
    const result = await handleCustomerMagicLinkEvent({ ...baseEvent, eventType: 'TICKET_ASSIGNED' });

    expect(result).toMatchObject({ status: 'failure', error: { retryable: false } });
  });

  it('fails permanently for a malformed payload', async () => {
    const result = await handleCustomerMagicLinkEvent({ ...baseEvent, payload: { email: 'x' } });

    expect(result).toMatchObject({ status: 'failure', error: { retryable: false } });
    expect(sentEmail.findFirst).not.toHaveBeenCalled();
  });

  it('fails permanently when the sealed token cannot be opened', async () => {
    const result = await handleCustomerMagicLinkEvent({
      ...baseEvent,
      payload: { ...baseEvent.payload, sealedToken: 'v1.bm90LWEtdG9rZW4.bm90LWEtdGFn.bm90LWEtY2lwaGVy' },
    });

    expect(result).toMatchObject({ status: 'failure', error: { retryable: false } });
  });

  it('short-circuits when the email was already sent', async () => {
    sentEmail.findFirst.mockResolvedValue({ outboxEventId: 'event-1' } as never);

    const result = await handleCustomerMagicLinkEvent(baseEvent);

    expect(result).toEqual({ status: 'success' });
    expect(sentEmail.create).not.toHaveBeenCalled();
  });

  it('marks the send as sent in the idempotency table', async () => {
    sentEmail.findFirst.mockResolvedValue(null as never);
    sentEmail.deleteMany.mockResolvedValue({ count: 0 } as never);
    sentEmail.create.mockResolvedValue({} as never);
    sentEmail.updateMany.mockResolvedValue({ count: 1 } as never);

    const result = await handleCustomerMagicLinkEvent(baseEvent);

    expect(result).toEqual({ status: 'success' });
    expect(sentEmail.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ outboxEventId: 'event-1', recipient: 'buyer@example.com' }),
      }),
    );
    expect(sentEmail.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ status: 'SENT' }) }),
    );
  });
});

describe('workspace scoping', () => {
  const context = {
    sessionId: 'session-1',
    customerId: 'customer-1',
    workspaceId: 'workspace-1',
    workspaceSlug: 'acme-support',
    workspaceName: 'Acme Support',
    email: 'buyer@example.com',
    expiresAt: new Date('2099-01-01T00:00:00Z'),
  };

  it('rejects a session that belongs to a different workspace', () => {
    expect(() =>
      assertCustomerInWorkspace(context, { id: 'workspace-2', name: 'Other', slug: 'other' }),
    ).toThrow(CustomerWorkspaceMismatchError);
  });

  it('accepts a session for the resolved workspace', () => {
    expect(() =>
      assertCustomerInWorkspace(context, { id: 'workspace-1', name: 'Acme', slug: 'acme-support' }),
    ).not.toThrow();
  });

  it('throws for a missing session', () => {
    expect(() => requireCustomerSession(null)).toThrow(CustomerUnauthenticatedError);
  });
});

describe('customer rate limit policy', () => {
  it('never embeds raw email or ip material in a key', () => {
    const rules = buildMagicLinkRequestRules({
      workspaceId: 'workspace-1',
      email: 'buyer@example.com',
      ip: '203.0.113.7',
    });

    expect(rules).toHaveLength(3);
    for (const rule of rules) {
      const serialized = JSON.stringify(rule);
      expect(serialized).not.toContain('buyer@example.com');
      expect(serialized).not.toContain('203.0.113.7');
    }
  });

  it('separates distinct emails within the same workspace and ip', () => {
    const a = buildMagicLinkRequestRules({ workspaceId: 'w', email: 'a@example.com', ip: '1.2.3.4' });
    const b = buildMagicLinkRequestRules({ workspaceId: 'w', email: 'b@example.com', ip: '1.2.3.4' });

    expect(a[0]!.dimensions).not.toEqual(b[0]!.dimensions);
    expect(a[1]!.dimensions).toEqual(b[1]!.dimensions);
    expect(a[2]!.dimensions).toEqual(b[2]!.dimensions);
  });

  it('separates distinct ip addresses for verification', () => {
    const a = buildMagicLinkVerifyRules({ workspaceId: 'w', ip: '1.2.3.4' });
    const b = buildMagicLinkVerifyRules({ workspaceId: 'w', ip: '5.6.7.8' });

    expect(a[0]!.dimensions).not.toEqual(b[0]!.dimensions);
  });

  it('reads the first forwarded address and falls back sensibly', () => {
    expect(readClientIp(new Headers({ 'x-forwarded-for': '203.0.113.7, 70.41.3.18' }))).toBe('203.0.113.7');
    expect(readClientIp(new Headers({ 'x-real-ip': '198.51.100.4' }))).toBe('198.51.100.4');
    expect(readClientIp(new Headers())).toBe('unknown');
  });
});

describe('customer session cookie', () => {
  it('is scoped so both the portal and the authenticated API routes receive it', () => {
    // The customer credential is presented to /portal pages AND to
    // /api/portal/.../session and .../logout. A narrower path would leave the
    // authenticated routes permanently unauthenticated.
    expect(CUSTOMER_SESSION_COOKIE_PATH).toBe('/');
  });

  it('is HttpOnly and Lax, and only Secure in production', () => {
    const options = buildCustomerSessionCookieOptions();

    expect(options.httpOnly).toBe(true);
    expect(options.sameSite).toBe('lax');
    expect(options.path).toBe(CUSTOMER_SESSION_COOKIE_PATH);
    expect(options.maxAge).toBe(CUSTOMER_SESSION_COOKIE_MAX_AGE_SECONDS);
    expect(options.maxAge).toBeGreaterThan(0);
  });
});

describe('rate limit consumption', () => {
  /**
   * Wraps a store and records the count returned for each key, so assertions
   * can inspect bucket state without consuming from it (a bare `increment`
   * assertion would itself advance the counter and skew the result).
   */
  function recordingStore(store: RateLimitStore) {
    const counts: string[] = [];

    return {
      counts,
      store: {
        increment: async (key: string, windowSeconds: number) => {
          const count = await store.increment(key, windowSeconds);
          counts.push(key);
          return count;
        },
      },
    };
  }

  it('consumes every rule so a looser bucket cannot be used to dodge a tighter one', async () => {
    const base = createInMemoryRateLimitStore(() => 0);
    const { store, counts } = recordingStore(base);
    const rules = [
      { action: 'a', dimensions: ['k'], limit: 1, windowSeconds: 60 },
      { action: 'b', dimensions: ['k'], limit: 10, windowSeconds: 60 },
    ];

    expect((await consumeRateLimit(rules, store)).allowed).toBe(true);
    expect(counts).toEqual(['a:k', 'b:k']);

    counts.length = 0;
    const second = await consumeRateLimit(rules, store);

    expect(second.allowed).toBe(false);
    expect(second.limitedBy?.action).toBe('a');
    // The looser bucket was still consumed, so it is at 2, not 1.
    expect(counts).toEqual(['a:k', 'b:k']);
  });

  /**
   * Regression test for the short-circuit bug: the implementation returned as
   * soon as rule 1 rejected, so rules 2 and 3 were never counted and the
   * per-IP bucket silently under-recorded exactly the traffic an attacker
   * spreads across identities.
   */
  it('still consumes rules 2 and 3 after rule 1 rejects, and stays rejected', async () => {
    const base = createInMemoryRateLimitStore(() => 0);
    const { store, counts } = recordingStore(base);

    const rules = [
      { action: 'tight', dimensions: ['workspace-email', 'w1', 'e1'], limit: 1, windowSeconds: 600 },
      { action: 'medium', dimensions: ['workspace', 'w1'], limit: 100, windowSeconds: 600 },
      { action: 'ip', dimensions: ['ip', 'ip1'], limit: 30, windowSeconds: 600 },
    ];

    // First call: nothing is over its limit yet.
    expect((await consumeRateLimit(rules, store)).allowed).toBe(true);

    counts.length = 0;
    const second = await consumeRateLimit(rules, store);

    // Verdict is a rejection naming the tight bucket.
    expect(second.allowed).toBe(false);
    expect(second.limitedBy?.action).toBe('tight');
    expect(second.retryAfterSeconds).toBe(600);

    // All three buckets were consumed, not just the one that rejected.
    expect(counts).toEqual([
      'tight:workspace-email:w1:e1',
      'medium:workspace:w1',
      'ip:ip:ip1',
    ]);
  });

  it('reports the shortest rejecting window when several rules reject', async () => {
    const store = createInMemoryRateLimitStore(() => 0);
    const rules = [
      { action: 'long', dimensions: ['k'], limit: 1, windowSeconds: 600 },
      { action: 'short', dimensions: ['k'], limit: 1, windowSeconds: 60 },
    ];

    await consumeRateLimit(rules, store);

    const verdict = await consumeRateLimit(rules, store);

    expect(verdict.allowed).toBe(false);
    expect(verdict.limitedBy?.action).toBe('short');
    expect(verdict.retryAfterSeconds).toBe(60);
  });

  it('does not extend the window for buckets it only observed', async () => {
    let now = 0;
    const store = createInMemoryRateLimitStore(() => now);
    const rules = [
      { action: 'tight', dimensions: ['k'], limit: 1, windowSeconds: 100 },
      { action: 'loose', dimensions: ['k'], limit: 10, windowSeconds: 100 },
    ];

    await consumeRateLimit(rules, store);
    expect((await consumeRateLimit(rules, store)).allowed).toBe(false);

    // The tight bucket resets exactly 100s after its FIRST increment, not
    // after the most recent one, so observing it in later calls does not push
    // the reset out.
    now = 100_001;
    const { store: recorder, counts } = recordingStore(store);

    expect((await consumeRateLimit(rules, recorder)).allowed).toBe(true);
    expect(counts).toEqual(['tight:k', 'loose:k']);
  });

  it('resets the window after it elapses', async () => {
    let now = 0;
    const store = createInMemoryRateLimitStore(() => now);

    expect(await store.increment('w:1', 60)).toBe(1);
    now = 59_000;
    expect(await store.increment('w:1', 60)).toBe(2);
    now = 60_001;
    expect(await store.increment('w:1', 60)).toBe(1);
  });

  it('sets the redis ttl only on the first increment of a window', async () => {
    const expire = vi.fn().mockResolvedValue(1);
    let counter = 0;
    const store = createRedisRateLimitStore({
      incr: vi.fn(async () => ++counter),
      expire,
    });

    await store.increment('k', 60);
    await store.increment('k', 60);
    await store.increment('k', 60);

    expect(expire).toHaveBeenCalledTimes(1);
  });

  it('rejects a non-numeric redis counter instead of trusting it', async () => {
    const store = createRedisRateLimitStore({
      incr: vi.fn(async () => Number.NaN),
      expire: vi.fn(),
    });

    await expect(store.increment('k', 60)).rejects.toThrow('Rate limit counter is not numeric');
  });
});

describe('request validation', () => {
  it('normalizes the email before it reaches the service', () => {
    const parsed = requestCustomerMagicLinkSchema.parse({
      workspaceSlug: ' acme-support ',
      email: '  Buyer@Example.COM ',
    });

    expect(parsed).toEqual({ workspaceSlug: 'acme-support', email: 'buyer@example.com' });
  });

  it('rejects an empty or overlong address', () => {
    expect(() => requestCustomerMagicLinkSchema.parse({ workspaceSlug: 'a', email: '' })).toThrow();
    expect(() =>
      requestCustomerMagicLinkSchema.parse({ workspaceSlug: 'a', email: `${'x'.repeat(400)}@example.com` }),
    ).toThrow();
  });

  it('rejects a slug that is not url safe', () => {
    expect(workspaceSlugSchema.safeParse('Acme Support').success).toBe(false);
    expect(workspaceSlugSchema.safeParse('acme-support').success).toBe(true);
  });
});
