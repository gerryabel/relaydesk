import { describe, it, expect, vi, afterEach } from 'vitest';
import { NextRequest } from 'next/server';
import { POST } from '@/app/api/tickets/bulk/route';
import { UnauthorizedError, ForbiddenError } from '@/lib/workspace/server';
import { BulkTicketIdsRequiredError, BulkTicketLimitExceededError, BulkDuplicateTicketIdsError, BulkActionNotSupportedError, BulkAssigneeNotInWorkspaceError, BulkInvalidTransitionError, BulkTagNotFoundError, BulkTagNotInWorkspaceError } from '@/lib/tickets/bulk';

const { bulkUpdateTicketsMock, getCurrentMembershipMock } = vi.hoisted(() => ({
  bulkUpdateTicketsMock: vi.fn(),
  getCurrentMembershipMock: vi.fn(),
}));

vi.mock('@/lib/tickets/bulk', async () => ({
  ...(await import('@/lib/tickets/bulk')),
  bulkUpdateTickets: bulkUpdateTicketsMock,
}));

vi.mock('@/lib/workspace/server', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/workspace/server')>();
  return {
    ...actual,
    getCurrentMembership: getCurrentMembershipMock,
  };
});

function createBulkRequest(payload: unknown) {
  return new NextRequest('http://localhost/api/tickets/bulk', {
    method: 'POST',
    body: JSON.stringify(payload),
    headers: { 'Content-Type': 'application/json' },
    signal: undefined,
  });
}

afterEach(() => {
  bulkUpdateTicketsMock.mockReset();
  getCurrentMembershipMock.mockReset();
});

describe('bulk tickets API', () => {
  it('returns 401 when membership resolution fails', async () => {
    getCurrentMembershipMock.mockRejectedValueOnce(new UnauthorizedError('No authenticated session'));

    const response = await POST(createBulkRequest({ ticketIds: ['ticket-1'], action: 'status', value: 'open' }));
    const body = await response.json();

    expect(response.status).toBe(401);
    expect(body.error).toBe('Unauthorized');
  });

  it('returns 403 when membership resolution fails', async () => {
    getCurrentMembershipMock.mockRejectedValueOnce(new ForbiddenError('No workspace membership found'));

    const response = await POST(createBulkRequest({ ticketIds: ['ticket-1'], action: 'status', value: 'open' }));
    const body = await response.json();

    expect(response.status).toBe(403);
    expect(body.error).toBe('Forbidden');
  });

  it('returns 400 when payload requires ticket ids', async () => {
    bulkUpdateTicketsMock.mockRejectedValueOnce(new BulkTicketIdsRequiredError('Pilih minimal satu tiket.'));

    const response = await POST(createBulkRequest({ ticketIds: [], action: 'status', value: 'open' }));
    const body = await response.json();

    expect(response.status).toBe(400);
    expect(body.error).toBe('Bulk update failed. No tickets were changed.');
    expect(body.reason).toBe('Pilih minimal satu tiket.');
  });

  it('returns 400 when selection exceeds 100', async () => {
    bulkUpdateTicketsMock.mockRejectedValueOnce(new BulkTicketLimitExceededError('Maksimal 100 tiket.'));

    const response = await POST(createBulkRequest({ ticketIds: Array.from({ length: 101 }, (_, index) => `ticket-${index}`), action: 'status', value: 'open' }));
    const body = await response.json();

    expect(response.status).toBe(400);
    expect(body.reason).toBe('Maksimal 100 tiket.');
  });

  it('returns 400 when ticket ids are duplicated', async () => {
    bulkUpdateTicketsMock.mockRejectedValueOnce(new BulkDuplicateTicketIdsError('ID tiket tidak boleh duplikat.'));

    const response = await POST(createBulkRequest({ ticketIds: ['ticket-1', 'ticket-1'], action: 'status', value: 'open' }));
    const body = await response.json();

    expect(response.status).toBe(400);
    expect(body.reason).toBe('ID tiket tidak boleh duplikat.');
  });

  it('returns 400 for unsupported action', async () => {
    bulkUpdateTicketsMock.mockRejectedValueOnce(new BulkActionNotSupportedError('Aksi tidak didukung.'));

    const response = await POST(createBulkRequest({ ticketIds: ['ticket-1'], action: 'delete', value: null }));
    const body = await response.json();

    expect(response.status).toBe(400);
    expect(body.reason).toBe('Aksi tidak didukung.');
  });

  it('returns 400 when assignee is outside workspace', async () => {
    bulkUpdateTicketsMock.mockRejectedValueOnce(new BulkAssigneeNotInWorkspaceError('Assignee bukan member workspace ini.'));

    const response = await POST(createBulkRequest({ ticketIds: ['ticket-1'], action: 'assign', value: 'user-999' }));
    const body = await response.json();

    expect(response.status).toBe(400);
    expect(body.reason).toBe('Assignee bukan member workspace ini.');
  });

  it('returns 409 when status transition is invalid', async () => {
    bulkUpdateTicketsMock.mockRejectedValueOnce(new BulkInvalidTransitionError('Satu atau lebih transisi status tidak diizinkan.'));

    const response = await POST(createBulkRequest({ ticketIds: ['ticket-1'], action: 'status', value: 'resolved' }));
    const body = await response.json();

    expect(response.status).toBe(409);
    expect(body.reason).toBe('Satu atau lebih transisi status tidak diizinkan.');
  });

  it('returns 404 when tag is missing', async () => {
    bulkUpdateTicketsMock.mockRejectedValueOnce(new BulkTagNotFoundError('Tag tidak ditemukan.'));

    const response = await POST(createBulkRequest({ ticketIds: ['ticket-1'], action: 'add_tag', value: 'tag-missing' }));
    const body = await response.json();

    expect(response.status).toBe(404);
    expect(body.reason).toBe('Tag tidak ditemukan.');
  });

  it('returns 400 when tag is outside workspace', async () => {
    bulkUpdateTicketsMock.mockRejectedValueOnce(new BulkTagNotInWorkspaceError('Tag bukan bagian dari workspace ini.'));

    const response = await POST(createBulkRequest({ ticketIds: ['ticket-1'], action: 'add_tag', value: 'tag-other' }));
    const body = await response.json();

    expect(response.status).toBe(400);
    expect(body.reason).toBe('Tag bukan bagian dari workspace ini.');
  });

  it('returns updated result on success', async () => {
    bulkUpdateTicketsMock.mockResolvedValueOnce({ updatedCount: 2, noOpCount: 1 } as never);

    const response = await POST(createBulkRequest({ ticketIds: ['ticket-1', 'ticket-2'], action: 'priority', value: 'high' }));
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body).toEqual({ updatedCount: 2, noOpCount: 1 });
  });

  it('returns generic failure without stack trace on unexpected errors', async () => {
    bulkUpdateTicketsMock.mockRejectedValueOnce(new Error('Unexpected failure'));

    const response = await POST(createBulkRequest({ ticketIds: ['ticket-1'], action: 'status', value: 'open' }));
    const body = await response.json();

    expect(response.status).toBe(500);
    expect(body).toEqual({ error: 'Bulk update failed. No tickets were changed.' });
  });
});
