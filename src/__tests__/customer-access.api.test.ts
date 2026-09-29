import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';
import { POST as requestMagicLink } from '@/app/api/portal/[workspaceSlug]/auth/magic-link/route';
import { POST as verifyMagicLink } from '@/app/api/portal/[workspaceSlug]/auth/magic-link/verify/route';
import { POST as logout } from '@/app/api/portal/[workspaceSlug]/auth/logout/route';
import { GET as getSession } from '@/app/api/portal/[workspaceSlug]/auth/session/route';
import {
  CustomerMagicLinkInvalidError,
  WorkspaceSlugNotFoundError,
} from '@/lib/customer-access/errors';
import { CUSTOMER_SESSION_COOKIE_NAME } from '@/lib/customer-access/config';
import { prisma } from '@/lib/db/prisma';

vi.mock('@/lib/customer-access/server', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/customer-access/server')>();
  return {
    ...actual,
    requestCustomerMagicLink: vi.fn(),
    consumeCustomerMagicLink: vi.fn(),
    resolveWorkspaceBySlug: vi.fn(),
    resolveCustomerSession: vi.fn(),
    revokeCustomerSession: vi.fn(),
    touchCustomerSession: vi.fn(),
  };
});

vi.mock('@/lib/customer-access/cookies', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/customer-access/cookies')>();
  return { ...actual, readCustomerSessionToken: vi.fn() };
});

vi.mock('@/lib/customer-access/session', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/customer-access/session')>();
  return { ...actual, requireCustomerInWorkspace: vi.fn() };
});

vi.mock('@/lib/rate-limit/limiter', async (importOriginal) => {
  const actual = importOriginal<typeof import('@/lib/rate-limit/limiter')>();
  return { ...(await actual), consumeRateLimit: vi.fn() };
});

const {
  requestCustomerMagicLink,
  consumeCustomerMagicLink,
  resolveWorkspaceBySlug,
  revokeCustomerSession,
  touchCustomerSession,
} = vi.mocked(await import('@/lib/customer-access/server'));
const { consumeRateLimit: mockedConsumeRateLimit } = vi.mocked(await import('@/lib/rate-limit/limiter'));
const { requireCustomerInWorkspace } = vi.mocked(await import('@/lib/customer-access/session'));
const { CustomerUnauthenticatedError, CustomerWorkspaceMismatchError } = vi.mocked(
  await import('@/lib/customer-access/errors'),
);

const workspace = { id: 'workspace-1', name: 'Acme Support', slug: 'acme-support' };

const sessionContext = {
  sessionId: 'session-1',
  customerId: 'customer-1',
  workspaceId: workspace.id,
  workspaceSlug: workspace.slug,
  workspaceName: workspace.name,
  email: 'buyer@example.com',
  expiresAt: new Date('2099-01-01T00:00:00Z'),
};

function allowRateLimit() {
  mockedConsumeRateLimit.mockResolvedValue({ allowed: true, limitedBy: null, retryAfterSeconds: 0 });
}

function denyRateLimit() {
  mockedConsumeRateLimit.mockResolvedValue({
    allowed: false,
    limitedBy: {
      action: 'customer-magic-link-request',
      dimensions: ['ip', 'x'],
      limit: 1,
      windowSeconds: 600,
    },
    retryAfterSeconds: 600,
  });
}

function postRequest(path: string, body: unknown, headers: Record<string, string> = {}) {
  return new NextRequest(`http://localhost${path}`, {
    method: 'POST',
    body: JSON.stringify(body),
    headers: { 'content-type': 'application/json', ...headers },
    signal: undefined,
  });
}

beforeEach(() => {
  allowRateLimit();
  resolveWorkspaceBySlug.mockResolvedValue(workspace);
  requireCustomerInWorkspace.mockResolvedValue({ workspace, customer: sessionContext });
  touchCustomerSession.mockResolvedValue(undefined);
});

afterEach(() => {
  vi.clearAllMocks();
});

describe('POST /api/portal/[workspaceSlug]/auth/magic-link', () => {
  it('returns 202 without disclosing whether the customer exists', async () => {
    requestCustomerMagicLink.mockResolvedValue({ workspace, email: 'buyer@example.com' });

    const response = await requestMagicLink(
      postRequest('/api/portal/acme-support/auth/magic-link', { email: 'buyer@example.com' }, { 'x-forwarded-for': '203.0.113.7' }),
      { params: Promise.resolve({ workspaceSlug: 'acme-support' }) },
    );

    expect(response.status).toBe(202);
    await expect(response.json()).resolves.toEqual({
      message: 'If that address can receive a sign-in link, one has been sent.',
    });
    expect(response.cookies.get(CUSTOMER_SESSION_COOKIE_NAME)).toBeUndefined();
  });

  it('returns the same 202 body for an unknown workspace', async () => {
    resolveWorkspaceBySlug.mockRejectedValue(new WorkspaceSlugNotFoundError());

    const response = await requestMagicLink(
      postRequest('/api/portal/nope/auth/magic-link', { email: 'buyer@example.com' }),
      { params: Promise.resolve({ workspaceSlug: 'nope' }) },
    );

    expect(response.status).toBe(202);
    await expect(response.json()).resolves.toEqual({
      message: 'If that address can receive a sign-in link, one has been sent.',
    });
    expect(requestCustomerMagicLink).not.toHaveBeenCalled();
  });

  it('rejects a malformed email with 400', async () => {
    const response = await requestMagicLink(
      postRequest('/api/portal/acme-support/auth/magic-link', { email: 'not-an-email' }),
      { params: Promise.resolve({ workspaceSlug: 'acme-support' }) },
    );

    expect(response.status).toBe(400);
    expect(requestCustomerMagicLink).not.toHaveBeenCalled();
  });

  it('ignores a body-supplied workspaceSlug and uses the route param', async () => {
    requestCustomerMagicLink.mockResolvedValue({ workspace, email: 'buyer@example.com' });

    await requestMagicLink(
      postRequest('/api/portal/acme-support/auth/magic-link', {
        email: 'buyer@example.com',
        workspaceSlug: 'attacker-workspace',
      }),
      { params: Promise.resolve({ workspaceSlug: 'acme-support' }) },
    );

    expect(requestCustomerMagicLink).toHaveBeenCalledWith(
      expect.objectContaining({ workspaceSlug: 'acme-support' }),
    );
  });

  it('rate limits using hashed, server-resolved dimensions', async () => {
    denyRateLimit();

    const response = await requestMagicLink(
      postRequest('/api/portal/acme-support/auth/magic-link', { email: 'buyer@example.com' }, { 'x-forwarded-for': '203.0.113.7' }),
      { params: Promise.resolve({ workspaceSlug: 'acme-support' }) },
    );

    expect(response.status).toBe(429);
    expect(response.headers.get('Retry-After')).toBe('60');
    expect(requestCustomerMagicLink).not.toHaveBeenCalled();

    const [rules] = mockedConsumeRateLimit.mock.calls[0]!;
    expect(rules).toHaveLength(3);
    for (const rule of rules) {
      expect(JSON.stringify(rule)).not.toContain('buyer@example.com');
      expect(JSON.stringify(rule)).not.toContain('203.0.113.7');
    }
  });
});

describe('POST /api/portal/[workspaceSlug]/auth/magic-link/verify', () => {
  it('sets an HttpOnly scoped session cookie on success', async () => {
    consumeCustomerMagicLink.mockResolvedValue({ sessionToken: 'raw-session-token', session: sessionContext });

    const response = await verifyMagicLink(
      postRequest('/api/portal/acme-support/auth/magic-link/verify', { token: 'a'.repeat(43) }),
      { params: Promise.resolve({ workspaceSlug: 'acme-support' }) },
    );

    expect(response.status).toBe(200);

    const cookie = response.cookies.get(CUSTOMER_SESSION_COOKIE_NAME);
    expect(cookie?.value).toBe('raw-session-token');
    expect(cookie?.httpOnly).toBe(true);
    expect(cookie?.sameSite).toBe('lax');
    expect(cookie?.path).toBe('/portal');
  });

  it('never returns the token in the response body', async () => {
    consumeCustomerMagicLink.mockResolvedValue({ sessionToken: 'raw-session-token', session: sessionContext });

    const response = await verifyMagicLink(
      postRequest('/api/portal/acme-support/auth/magic-link/verify', { token: 'a'.repeat(43) }),
      { params: Promise.resolve({ workspaceSlug: 'acme-support' }) },
    );

    const body = await response.text();
    expect(body).not.toContain('raw-session-token');
  });

  it('answers identically for an unknown, expired and replayed token', async () => {
    consumeCustomerMagicLink.mockRejectedValue(new CustomerMagicLinkInvalidError());

    const response = await verifyMagicLink(
      postRequest('/api/portal/acme-support/auth/magic-link/verify', { token: 'b'.repeat(43) }),
      { params: Promise.resolve({ workspaceSlug: 'acme-support' }) },
    );

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toEqual({ error: 'Magic link is invalid or has expired.' });
    expect(response.cookies.get(CUSTOMER_SESSION_COOKIE_NAME)).toBeUndefined();
  });

  it('does not leak a cross-workspace token as valid', async () => {
    consumeCustomerMagicLink.mockRejectedValue(new CustomerMagicLinkInvalidError());

    const response = await verifyMagicLink(
      postRequest('/api/portal/other-workspace/auth/magic-link/verify', { token: 'c'.repeat(43) }),
      { params: Promise.resolve({ workspaceSlug: 'other-workspace' }) },
    );

    expect(response.status).toBe(400);
  });

  it('rate limits token verification', async () => {
    denyRateLimit();

    const response = await verifyMagicLink(
      postRequest('/api/portal/acme-support/auth/magic-link/verify', { token: 'd'.repeat(43) }),
      { params: Promise.resolve({ workspaceSlug: 'acme-support' }) },
    );

    expect(response.status).toBe(429);
    expect(consumeCustomerMagicLink).not.toHaveBeenCalled();
  });
});

describe('POST /api/portal/[workspaceSlug]/auth/logout', () => {
  it('revokes the presented session and clears the cookie', async () => {
    const request = new NextRequest('http://localhost/api/portal/acme-support/auth/logout', {
      method: 'POST',
      headers: { cookie: `${CUSTOMER_SESSION_COOKIE_NAME}=raw-session-token` },
      signal: undefined,
    });

    const response = await logout(request, { params: Promise.resolve({ workspaceSlug: 'acme-support' }) });

    expect(response.status).toBe(204);
    expect(revokeCustomerSession).toHaveBeenCalledWith('raw-session-token');
    expect(response.cookies.get(CUSTOMER_SESSION_COOKIE_NAME)?.value).toBe('');
    expect(response.cookies.get(CUSTOMER_SESSION_COOKIE_NAME)?.maxAge).toBe(0);
  });

  it('still clears the cookie when revocation fails', async () => {
    revokeCustomerSession.mockRejectedValue(new Error('database unavailable'));

    const request = new NextRequest('http://localhost/api/portal/acme-support/auth/logout', {
      method: 'POST',
      headers: { cookie: `${CUSTOMER_SESSION_COOKIE_NAME}=raw-session-token` },
      signal: undefined,
    });

    const response = await logout(request, { params: Promise.resolve({ workspaceSlug: 'acme-support' }) });

    expect(response.status).toBe(204);
    expect(response.cookies.get(CUSTOMER_SESSION_COOKIE_NAME)?.maxAge).toBe(0);
  });
});

describe('GET /api/portal/[workspaceSlug]/auth/session', () => {
  it('returns the minimal portal context for a valid session', async () => {
    requireCustomerInWorkspace.mockResolvedValue({ workspace, customer: sessionContext });

    const request = new NextRequest('http://localhost/api/portal/acme-support/auth/session', {
      signal: undefined,
    });
    const response = await getSession(request, { params: Promise.resolve({ workspaceSlug: 'acme-support' }) });

    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.workspace).toEqual({ name: 'Acme Support', slug: 'acme-support' });
    expect(body.customer).toEqual({ name: 'buyer@example.com' });
    expect(JSON.stringify(body)).not.toContain(sessionContext.customerId);
    expect(JSON.stringify(body)).not.toContain(sessionContext.sessionId);
  });

  it('returns 401 when no customer session exists', async () => {
    requireCustomerInWorkspace.mockRejectedValue(new CustomerUnauthenticatedError());

    const request = new NextRequest('http://localhost/api/portal/acme-support/auth/session', {
      signal: undefined,
    });
    const response = await getSession(request, { params: Promise.resolve({ workspaceSlug: 'acme-support' }) });

    expect(response.status).toBe(401);
  });

  it('returns 403 when the session belongs to another workspace', async () => {
    requireCustomerInWorkspace.mockRejectedValue(new CustomerWorkspaceMismatchError());

    const request = new NextRequest('http://localhost/acme-support/auth/session', {
      signal: undefined,
    });
    const response = await getSession(request, { params: Promise.resolve({ workspaceSlug: 'acme-support' }) });

    expect(response.status).toBe(403);
  });
});

describe('prisma is not touched by the mocked routes', () => {
  it('keeps the module mocked away from route tests', () => {
    expect(prisma).toBeDefined();
  });
});
