import { describe, it, expect, vi, afterEach } from 'vitest';
import { NextRequest } from 'next/server';
import { POST } from '@/app/api/tickets/bulk/route';
import { UnauthorizedError, ForbiddenError } from '@/lib/workspace/server';
import { BulkTicketIdsRequiredError, BulkTicketLimitExceededError, BulkDuplicateTicketIdsError, BulkActionNotSupportedError, BulkAssigneeNotInWorkspaceError, BulkInvalidTransitionError, BulkTagNotFoundError, BulkTagNotInWorkspaceError } from '@/lib/tickets/bulk';

function createBulkRequest(payload: unknown, init?: RequestInit) {
  return new NextRequest('http://localhost/api/tickets/bulk', {
    ...init,
    method: 'POST',
    body: JSON.stringify(payload),
    headers: { 'Content-Type': 'application/json' },
    signal: undefined,
  });
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe('bulk tickets API', () => {
  it('returns 401 when membership resolution fails', async () => {
    const response = await POST(createBulkRequest({}), { params: Promise.resolve({}) });
    const body = await response.json();

    expect(response.status).toBe(401);
    expect(body.error).toBe('Unauthorized');
  });

  it('returns 400 when action payload is invalid', async () => {
    const response = await POST(createBulkRequest({ ticketIds: [], action: 'status', value: 'open' }));
    const body = await response.json();

    expect(response.status).toBe(400);
    expect(body.reason).toBe('Pilih minimal satu tiket.');
  });

  it('returns 400 when bulk update fails due to invalid transition', async () => {
    vi.mock('@/lib/tickets/bulk', async () => {
      const actual = await vi.importActual<typeof import('@/lib/tickets/bulk')>('@/lib/tickets/bulk');
      return {
        ...actual,
        bulkUpdateTickets: vi.fn().mockRejectedValue(new BulkInvalidTransitionError()),
      };
    });

    const { bulkUpdateTickets } = await import('@/lib/tickets/bulk');
    vi.mocked(bulkUpdateTickets).mockRejectedValueOnce(new BulkInvalidTransitionError());

    const response = await POST(createBulkRequest({ ticketIds: ['ticket-1'], action: 'status', value: 'open' }));
    const body = await response.json();

    expect(response.status).toBe(409);
    expect(body.error).toBe('Bulk update failed. No tickets were changed.');
    expect(body.reason).toBe('Satu atau lebih transisi status tidak diizinkan.');
  });
});
