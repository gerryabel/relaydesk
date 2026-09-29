import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

/**
 * Portal page guard and presentation layer (Phase 9 Task 2).
 *
 * The repository has no component-rendering harness, and adding one for this
 * task would mean a new test dependency and a new testing convention for two
 * files. What is worth testing here is the logic the pages delegate to: the
 * decision to redirect versus to 404, and the vocabulary the pages render.
 *
 * The components themselves are thin — they map a DTO to markup and hold no
 * state that is not a form field — so what is verified here is that the
 * decisions behind them are the intended ones.
 */

vi.mock('next/navigation', () => ({
  redirect: vi.fn((target: string) => {
    const error = new Error(`NEXT_REDIRECT:${target}`);

    error.name = 'NEXT_REDIRECT';

    throw error;
  }),
  notFound: vi.fn(() => {
    const error = new Error('NEXT_NOT_FOUND');

    error.name = 'NEXT_NOT_FOUND';

    throw error;
  }),
}));

vi.mock('@/lib/customer-portal/session', async (importOriginal) => {
  // The guard identifies authorization failures with the error classes the
  // session module re-exports, so those must stay real here — only the session
  // lookup itself is stubbed.
  const actual = await importOriginal<typeof import('@/lib/customer-portal/session')>();

  return { ...actual, requireCustomerInWorkspace: vi.fn() };
});

const { redirect } = vi.mocked(await import('next/navigation'));
const { requireCustomerInWorkspace } = vi.mocked(await import('@/lib/customer-portal/session'));
const {
  CustomerUnauthenticatedError,
  CustomerWorkspaceMismatchError,
} = vi.mocked(await import('@/lib/customer-access/errors'));
const { requirePortalSession, withPortalSession } = await import('@/lib/customer-portal/guards');
const {
  customerPriorityLabel,
  customerStatusLabel,
  customerStatusTone,
  formatCustomerDate,
  formatCustomerDateOnly,
} = await import('@/lib/customer-portal/presentation');

const slug = 'acme-support';
const session = {
  workspace: { id: 'workspace-1', name: 'Acme Support', slug },
  customer: {
    sessionId: 'session-1',
    customerId: 'customer-1',
    workspaceId: 'workspace-1',
    workspaceSlug: slug,
    workspaceName: 'Acme Support',
    email: 'buyer@example.com',
    expiresAt: new Date('2099-01-01T00:00:00Z'),
  },
};

beforeEach(() => {
  requireCustomerInWorkspace.mockResolvedValue(session as never);
});

afterEach(() => {
  vi.resetAllMocks();
});

describe('requirePortalSession', () => {
  it('returns the resolved session for a valid customer', async () => {
    await expect(requirePortalSession(slug)).resolves.toBe(session);
  });

  it('redirects an unauthenticated visitor to the workspace login page', async () => {
    requireCustomerInWorkspace.mockRejectedValue(new CustomerUnauthenticatedError());

    await expect(requirePortalSession(slug)).rejects.toThrow('NEXT_REDIRECT');

    expect(redirect).toHaveBeenCalledWith(`/portal/${slug}/login`);
  });

  it('treats a wrong-workspace session as signed out rather than forbidden', async () => {
    requireCustomerInWorkspace.mockRejectedValue(new CustomerWorkspaceMismatchError());

    await expect(requirePortalSession(slug)).rejects.toThrow('NEXT_REDIRECT');

    // A `403` here would confirm to a stranger that the slug they guessed
    // names a real workspace.
    expect(redirect).toHaveBeenCalledWith(`/portal/${slug}/login`);
  });

  it('rethrows an unexpected failure instead of redirecting', async () => {
    requireCustomerInWorkspace.mockRejectedValue(new Error('ECONNREFUSED 127.0.0.1:5432'));

    await expect(requirePortalSession(slug)).rejects.toThrow('ECONNREFUSED');
    expect(redirect).not.toHaveBeenCalled();
  });
});

describe('withPortalSession', () => {
  it('returns the operation result when authorized', async () => {
    await expect(withPortalSession(slug, async () => 'result')).resolves.toBe('result');
  });

  it('does not redirect when the operation itself is fine', async () => {
    await withPortalSession(slug, async () => null);

    expect(redirect).not.toHaveBeenCalled();
  });

  it('redirects when the operation reports no session', async () => {
    await expect(
      withPortalSession(slug, async () => {
        throw new CustomerUnauthenticatedError();
      }),
    ).rejects.toThrow('NEXT_REDIRECT');

    expect(redirect).toHaveBeenCalledWith(`/portal/${slug}/login`);
  });

  it('redirects when the operation reports a workspace mismatch', async () => {
    await expect(
      withPortalSession(slug, async () => {
        throw new CustomerWorkspaceMismatchError();
      }),
    ).rejects.toThrow('NEXT_REDIRECT');
  });

  it('rethrows a real failure so the error boundary can handle it', async () => {
    await expect(
      withPortalSession(slug, async () => {
        throw new Error('relation "Ticket" does not exist');
      }),
    ).rejects.toThrow('relation "Ticket" does not exist');

    expect(redirect).not.toHaveBeenCalled();
  });
});

describe('customer vocabulary', () => {
  it('never renders internal enum values', () => {
    // spec §13: the portal speaks the customer's language, not the agent's.
    const internalValues = ['open', 'in_progress', 'waiting_customer', 'resolved', 'closed'] as const;

    expect(internalValues.map(customerStatusLabel)).toEqual([
      'Open',
      'In progress',
      'Waiting for you',
      'Resolved',
      'Closed',
    ]);

    for (const label of internalValues.map(customerStatusLabel)) {
      expect(label).not.toContain('_');
    }
  });

  it('maps priority to plain language', () => {
    expect(customerPriorityLabel('medium')).toBe('Normal');
    expect(customerPriorityLabel('urgent')).toBe('Urgent');
    expect(customerPriorityLabel('low')).toBe('Low');
  });

  it('gives every status a badge tone', () => {
    for (const status of ['open', 'in_progress', 'waiting_customer', 'resolved', 'closed'] as const) {
      expect(customerStatusTone(status)).toBeTruthy();
    }
  });
});

describe('customer date formatting', () => {
  it('formats in UTC regardless of the server locale', () => {
    // A customer quoting "14:05" and a support agent in another timezone must
    // mean the same instant.
    expect(formatCustomerDate('2026-01-05T14:05:00.000Z')).toContain('14:05');
    expect(formatCustomerDate('2026-01-05T00:30:00.000Z')).toContain('Jan 5, 2026');
  });

  it('omits the time for list rows', () => {
    expect(formatCustomerDateOnly('2026-01-05T14:05:00.000Z')).toBe('Jan 5, 2026');
    expect(formatCustomerDateOnly('2026-01-05T14:05:00.000Z')).not.toContain('14:05');
  });

  it('degrades to the raw value rather than rendering Invalid Date', () => {
    expect(formatCustomerDate('not-a-date')).toBe('not-a-date');
    expect(formatCustomerDateOnly('')).toBe('');
  });
});
