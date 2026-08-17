import { describe, it, expect, vi, afterEach } from 'vitest';
import { NextRequest } from 'next/server';
import { GET, POST } from '@/app/api/tickets/[id]/tags/route';
import { DELETE } from '@/app/api/tickets/[id]/tags/[tagId]/route';

vi.mock('@/lib/workspace/server', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/workspace/server')>();
  return {
    ...actual,
    getCurrentMembership: vi.fn(),
  };
});

vi.mock('@/lib/tags/server', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/tags/server')>();
  return {
    ...actual,
    getTicketTags: vi.fn(),
    addTagToTicket: vi.fn(),
    removeTagFromTicket: vi.fn(),
  };
});

const mockedTagServer = await import('@/lib/tags/server');

const mockedGetTicketTags = vi.mocked(mockedTagServer.getTicketTags);
const mockedAddTagToTicket = vi.mocked(mockedTagServer.addTagToTicket);
const mockedRemoveTagFromTicket = vi.mocked(mockedTagServer.removeTagFromTicket);

afterEach(() => {
  vi.resetAllMocks();
});

function createTicketTagsRequest(ticketId: string, init?: RequestInit) {
  return new NextRequest(`http://localhost/api/tickets/${ticketId}/tags`, {
    ...init,
    signal: undefined,
  });
}

function createTicketTagRequest(ticketId: string, tagId: string, init?: RequestInit) {
  return new NextRequest(`http://localhost/api/tickets/${ticketId}/tags/${tagId}`, {
    ...init,
    signal: undefined,
  });
}

describe('ticket tags API', () => {
  it('GET returns ticket tags', async () => {
    mockedGetTicketTags.mockResolvedValueOnce([
      { id: 'tag-1', name: 'Billing', normalizedName: 'billing' },
    ] as never);

    const response = await GET(createTicketTagsRequest('ticket-1'), { params: Promise.resolve({ id: 'ticket-1' }) });
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body).toEqual([{ id: 'tag-1', name: 'Billing', normalizedName: 'billing' }]);
  });

  it('GET returns 401 when membership resolution fails', async () => {
    mockedGetTicketTags.mockRejectedValueOnce(new (await import('@/lib/workspace/server')).UnauthorizedError('Unauthorized') as never);

    const response = await GET(createTicketTagsRequest('ticket-1'), { params: Promise.resolve({ id: 'ticket-1' }) });
    const body = await response.json();

    expect(response.status).toBe(401);
    expect(body.error).toBe('Unauthorized');
  });

  it('GET returns 403 when membership is missing', async () => {
    mockedGetTicketTags.mockRejectedValueOnce(new (await import('@/lib/workspace/server')).ForbiddenError('Forbidden') as never);

    const response = await GET(createTicketTagsRequest('ticket-1'), { params: Promise.resolve({ id: 'ticket-1' }) });
    const body = await response.json();

    expect(response.status).toBe(403);
    expect(body.error).toBe('Forbidden');
  });

  it('POST attaches a tag to a ticket', async () => {
    mockedAddTagToTicket.mockResolvedValueOnce(undefined as never);

    const response = await POST(createTicketTagsRequest('ticket-1', { method: 'POST', body: JSON.stringify({ tagId: 'tag-1' }) }), { params: Promise.resolve({ id: 'ticket-1' }) });
    const body = await response.json();

    expect(response.status).toBe(201);
    expect(body.ok).toBe(true);
  });

  it('POST returns 400 when tagId is missing', async () => {
    const response = await POST(createTicketTagsRequest('ticket-1', { method: 'POST', body: JSON.stringify({}) }), { params: Promise.resolve({ id: 'ticket-1' }) });
    const body = await response.json();

    expect(response.status).toBe(400);
    expect(body.error).toBe('Tag ID wajib diisi');
  });

  it('POST returns 409 when attachment already exists', async () => {
    mockedAddTagToTicket.mockRejectedValueOnce(new (await import('@/lib/tags/server')).TicketTagAlreadyExistsError());

    const response = await POST(createTicketTagsRequest('ticket-1', { method: 'POST', body: JSON.stringify({ tagId: 'tag-1' }) }), { params: Promise.resolve({ id: 'ticket-1' }) });
    const body = await response.json();

    expect(response.status).toBe(409);
    expect(body.error).toBe('Tiket sudah memiliki tag ini.');
  });

  it('DELETE removes a tag from a ticket', async () => {
    mockedRemoveTagFromTicket.mockResolvedValueOnce(undefined as never);

    const response = await DELETE(createTicketTagRequest('ticket-1', 'tag-1', { method: 'DELETE' }), { params: Promise.resolve({ id: 'ticket-1', tagId: 'tag-1' }) });
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.ok).toBe(true);
  });
});
