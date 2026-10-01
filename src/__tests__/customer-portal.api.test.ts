import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { NextRequest } from 'next/server';
import { GET as listTickets, POST as createTicket } from '@/app/api/portal/[workspaceSlug]/tickets/route';
import { GET as getTicket } from '@/app/api/portal/[workspaceSlug]/tickets/[ticketId]/route';
import { POST as createReply } from '@/app/api/portal/[workspaceSlug]/tickets/[ticketId]/messages/route';
import {
  createCustomerReply,
  createCustomerTicket,
  getCustomerTicket,
  listCustomerTickets,
} from '@/lib/customer-portal/server';
import {
  CustomerTicketNotFoundError,
  CustomerTicketReplyNotAllowedError,
  CustomerTicketValidationError,
} from '@/lib/customer-portal/errors';
import {
  CustomerUnauthenticatedError,
  CustomerWorkspaceMismatchError,
  WorkspaceSlugNotFoundError,
} from '@/lib/customer-access/errors';

/**
 * Customer portal HTTP surface (Phase 9 Task 2; customer replies in Task 3).
 *
 * The service is mocked so the assertions are about the route layer: status
 * codes, the body shape, which query parameters survive, and — most
 * importantly — that every failure mode produces a status and a message a
 * customer can act on without ever revealing that another customer's ticket
 * exists.
 */

vi.mock('@/lib/customer-portal/server', () => ({
  listCustomerTickets: vi.fn(),
  getCustomerTicket: vi.fn(),
  createCustomerTicket: vi.fn(),
  createCustomerReply: vi.fn(),
}));

const mockedList = vi.mocked(listCustomerTickets);
const mockedGet = vi.mocked(getCustomerTicket);
const mockedCreate = vi.mocked(createCustomerTicket);
const mockedReply = vi.mocked(createCustomerReply);

const slug = 'acme-support';
const routeContext = { params: Promise.resolve({ workspaceSlug: slug }) };

function request(path: string, init?: ConstructorParameters<typeof NextRequest>[1]) {
  return new NextRequest(`http://localhost:3000${path}`, init);
}

const emptyPage = {
  data: [],
  page: 1,
  limit: 20,
  total: 0,
  totalPages: 1,
  hasPreviousPage: false,
  hasNextPage: false,
};

beforeEach(() => {
  mockedList.mockResolvedValue(emptyPage);
});

afterEach(() => {
  vi.resetAllMocks();
});

describe('GET /api/portal/[workspaceSlug]/tickets', () => {
  it('returns the customer page', async () => {
    mockedList.mockResolvedValue({ ...emptyPage, total: 2 });

    const response = await listTickets(request(`/api/portal/${slug}/tickets`), routeContext);

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({ total: 2 });
  });

  it('forwards only the documented parameters', async () => {
    await listTickets(
      request(`/api/portal/${slug}/tickets?q=printer&page=2&customerId=attacker&_rsc=xyz`),
      routeContext,
    );

    const params = mockedList.mock.calls[0]?.[0]?.params;

    expect(params).toEqual({
      q: 'printer',
      status: undefined,
      page: '2',
      limit: undefined,
    });
    expect(params).not.toHaveProperty('customerId');
  });

  it('answers 401 without a session', async () => {
    mockedList.mockRejectedValue(new CustomerUnauthenticatedError());

    const response = await listTickets(request(`/api/portal/${slug}/tickets`), routeContext);

    expect(response.status).toBe(401);
    await expect(response.json()).resolves.toEqual({ error: expect.any(String) });
  });

  it('answers 403 for a session bound to another workspace', async () => {
    mockedList.mockRejectedValue(new CustomerWorkspaceMismatchError());

    const response = await listTickets(request(`/api/portal/${slug}/tickets`), routeContext);

    expect(response.status).toBe(403);
  });

  it('answers 400 for an invalid page', async () => {
    mockedList.mockRejectedValue(new CustomerTicketValidationError('Invalid request'));

    const response = await listTickets(request(`/api/portal/${slug}/tickets?page=0`), routeContext);

    expect(response.status).toBe(400);
  });

  it('answers 404 for an unknown workspace', async () => {
    mockedList.mockRejectedValue(new WorkspaceSlugNotFoundError());

    const response = await listTickets(request(`/api/portal/nope/tickets`), {
      params: Promise.resolve({ workspaceSlug: 'nope' }),
    });

    expect(response.status).toBe(404);
  });

  it('hides an unexpected failure behind a generic 500', async () => {
    mockedList.mockRejectedValue(
      new Error('connect ECONNREFUSED 127.0.0.1:5432 relation "Ticket" does not exist'),
    );

    const response = await listTickets(request(`/api/portal/${slug}/tickets`), routeContext);
    const body = await response.json();

    expect(response.status).toBe(500);
    expect(JSON.stringify(body)).not.toContain('ECONNREFUSED');
    expect(JSON.stringify(body)).not.toContain('5432');
  });
});

describe('POST /api/portal/[workspaceSlug]/tickets', () => {
  it('creates a ticket and answers 201', async () => {
    mockedCreate.mockResolvedValue({
      ticket: { id: 'ticket-1', reference: '#AB12CD34', title: 'Offline' },
    } as never);

    const response = await createTicket(
      request(`/api/portal/${slug}/tickets`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ title: 'Printer is offline' }),
      }),
      routeContext,
    );

    expect(response.status).toBe(201);
    await expect(response.json()).resolves.toMatchObject({ id: 'ticket-1', reference: '#AB12CD34' });
  });

  it('passes the body through for the service to validate', async () => {
    mockedCreate.mockResolvedValue({ ticket: { id: 'ticket-1' } } as never);

    await createTicket(
      request(`/api/portal/${slug}/tickets`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ title: 'Offline', customerId: 'attacker' }),
      }),
      routeContext,
    );

    // The route does not filter ownership keys — the strict schema in the
    // service rejects them, so a caller is told their value was ignored.
    expect(mockedCreate.mock.calls[0]?.[0]?.rawInput).toEqual({
      title: 'Offline',
      customerId: 'attacker',
    });
  });

  it('answers 400 for a malformed JSON body', async () => {
    mockedCreate.mockRejectedValue(
      new CustomerTicketValidationError('Title is required', { title: ['Title is required'] }),
    );

    const response = await createTicket(
      request(`/api/portal/${slug}/tickets`, { method: 'POST', body: 'not json' }),
      routeContext,
    );

    expect(response.status).toBe(400);
  });

  it('answers 400 when a required field is missing', async () => {
    mockedCreate.mockRejectedValue(new CustomerTicketValidationError('Title is required'));

    const response = await createTicket(
      request(`/api/portal/${slug}/tickets`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ description: 'no title' }),
      }),
      routeContext,
    );

    expect(response.status).toBe(400);
  });

  it('answers 401 without a session', async () => {
    mockedCreate.mockRejectedValue(new CustomerUnauthenticatedError());

    const response = await createTicket(
      request(`/api/portal/${slug}/tickets`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ title: 'Offline' }),
      }),
      routeContext,
    );

    expect(response.status).toBe(401);
  });

  it('answers 404 for an unknown workspace', async () => {
    mockedCreate.mockRejectedValue(new WorkspaceSlugNotFoundError());

    const response = await createTicket(
      request('/api/portal/nope/tickets', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ title: 'Offline' }),
      }),
      { params: Promise.resolve({ workspaceSlug: 'nope' }) },
    );

    expect(response.status).toBe(404);
  });

  it('hides an unexpected failure behind a generic 500', async () => {
    mockedCreate.mockRejectedValue(new Error('SlaPolicyNotFoundError: no policy for medium'));

    const response = await createTicket(
      request(`/api/portal/${slug}/tickets`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ title: 'Offline' }),
      }),
      routeContext,
    );

    expect(response.status).toBe(500);
    expect(JSON.stringify(await response.json())).not.toContain('SlaPolicy');
  });
});

describe('GET /api/portal/[workspaceSlug]/tickets/[ticketId]', () => {
  const detailContext = {
    params: Promise.resolve({ workspaceSlug: slug, ticketId: 'ticket-1' }),
  };

  it('returns the ticket', async () => {
    mockedGet.mockResolvedValue({ id: 'ticket-1', reference: '#AB12CD34' } as never);

    const response = await getTicket(request(`/api/portal/${slug}/tickets/ticket-1`), detailContext);

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({ id: 'ticket-1' });
  });

  it('answers 404 for a ticket owned by another customer', async () => {
    mockedGet.mockRejectedValue(new CustomerTicketNotFoundError());

    const response = await getTicket(request(`/api/portal/${slug}/tickets/ticket-1`), detailContext);

    // Identical to an unknown id. The response must not distinguish them, or
    // it becomes an oracle for guessing ticket ids.
    expect(response.status).toBe(404);
    const body = await response.json();

    expect(Object.keys(body)).toEqual(['error']);
  });

  it('uses the same 404 body for an unknown id', async () => {
    mockedGet.mockRejectedValue(new CustomerTicketNotFoundError());

    const response = await getTicket(request(`/api/portal/${slug}/tickets/nope`), {
      params: Promise.resolve({ workspaceSlug: slug, ticketId: 'nope' }),
    });

    expect(response.status).toBe(404);
    expect(Object.keys(await response.json())).toEqual(['error']);
  });

  it('answers 401 without a session', async () => {
    mockedGet.mockRejectedValue(new CustomerUnauthenticatedError());

    const response = await getTicket(request(`/api/portal/${slug}/tickets/ticket-1`), detailContext);

    expect(response.status).toBe(401);
  });

  it('answers 403 for a session bound to another workspace', async () => {
    mockedGet.mockRejectedValue(new CustomerWorkspaceMismatchError());

    const response = await getTicket(request(`/api/portal/${slug}/tickets/ticket-1`), detailContext);

    expect(response.status).toBe(403);
  });

  it('hides an unexpected failure behind a generic 500', async () => {
    mockedGet.mockRejectedValue(new Error('relation "Message" does not exist'));

    const response = await getTicket(request(`/api/portal/${slug}/tickets/ticket-1`), detailContext);

    expect(response.status).toBe(500);
    expect(JSON.stringify(await response.json())).not.toContain('relation');
  });
});

describe('POST /api/portal/[workspaceSlug]/tickets/[ticketId]/messages', () => {
  const detailContext = {
    params: Promise.resolve({ workspaceSlug: slug, ticketId: 'ticket-1' }),
  };

  const replyBody = { body: 'Any update on this?' };

  function postReply(body: unknown, context = detailContext) {
    return createReply(
      request(`/api/portal/${slug}/tickets/ticket-1/messages`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(body),
      }),
      context,
    );
  }

  it('stores the reply and answers 201 with the customer-safe message', async () => {
    mockedReply.mockResolvedValue({
      message: { id: 'message-1', author: 'customer', authorLabel: 'You', body: replyBody.body, createdAt: 'now' } as never,
    } as never);

    const response = await postReply(replyBody);

    expect(response.status).toBe(201);
    await expect(response.json()).resolves.toEqual({
      id: 'message-1',
      author: 'customer',
      authorLabel: 'You',
      body: replyBody.body,
      createdAt: 'now',
    });
  });

  it('sends only the body, the ticket from the path, and no identity of its own', async () => {
    mockedReply.mockResolvedValue({ message: { id: 'message-1' } as never } as never);

    await postReply(replyBody);

    // No customerId, no authorType, no status: identity is the session's job and
    // the ticket comes from the URL, so neither may be overridable from a body.
    expect(mockedReply).toHaveBeenCalledWith({
      workspaceSlug: slug,
      ticketId: 'ticket-1',
      rawInput: replyBody,
    });
  });

  it('rejects a body that tries to set the author, answering 400', async () => {
    // The route forwards the body untouched; the service's strict schema is
    // what refuses it. Both halves are asserted — here, that the answer is a
    // 400, and in the service tests, that nothing was written.
    mockedReply.mockRejectedValue(
      new CustomerTicketValidationError('Unrecognized key: "authorType"'),
    );

    const response = await postReply({ body: 'hi', authorType: 'agent', createdById: 'user-1' });

    expect(response.status).toBe(400);
    expect(mockedReply).toHaveBeenCalledWith({
      workspaceSlug: slug,
      ticketId: 'ticket-1',
      rawInput: { body: 'hi', authorType: 'agent', createdById: 'user-1' },
    });
  });

  it('rejects a body that tries to move the ticket status, answering 400', async () => {
    mockedReply.mockRejectedValue(new CustomerTicketValidationError('Unrecognized key: "status"'));

    const response = await postReply({ body: 'hi', status: 'closed' });

    expect(response.status).toBe(400);
    expect(mockedReply).toHaveBeenCalledWith(expect.objectContaining({ ticketId: 'ticket-1' }));
  });

  it('rejects an empty body, answering 400', async () => {
    mockedReply.mockRejectedValue(new CustomerTicketValidationError('Message cannot be empty'));

    const response = await postReply({ body: '   ' });

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toEqual({ error: 'Message cannot be empty' });
  });

  it('answers 400 for a malformed JSON body', async () => {
    mockedReply.mockRejectedValue(new CustomerTicketValidationError('Message is required'));

    const response = await createReply(
      request(`/api/portal/${slug}/tickets/ticket-1/messages`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: '{not json',
      }),
      detailContext,
    );

    expect(response.status).toBe(400);
    expect(mockedReply).toHaveBeenCalledWith(expect.objectContaining({ rawInput: {} }));
  });

  it('answers 400 for a reply to a closed ticket', async () => {
    mockedReply.mockRejectedValue(new CustomerTicketReplyNotAllowedError());

    const response = await postReply(replyBody);

    expect(response.status).toBe(400);
    expect(JSON.stringify(await response.json())).toContain('closed');
  });

  it('answers 404 for a ticket owned by another customer', async () => {
    mockedReply.mockRejectedValue(new CustomerTicketNotFoundError());

    const response = await postReply(replyBody);

    expect(response.status).toBe(404);
    expect(Object.keys(await response.json())).toEqual(['error']);
  });

  it('answers 401 without a session', async () => {
    mockedReply.mockRejectedValue(new CustomerUnauthenticatedError());

    const response = await postReply(replyBody);

    expect(response.status).toBe(401);
  });

  it('answers 403 for a session bound to another workspace', async () => {
    mockedReply.mockRejectedValue(new CustomerWorkspaceMismatchError());

    const response = await postReply(replyBody);

    expect(response.status).toBe(403);
  });

  it('answers 404 for an unknown workspace', async () => {
    mockedReply.mockRejectedValue(new WorkspaceSlugNotFoundError());

    const response = await postReply(replyBody);

    expect(response.status).toBe(404);
  });

  it('hides an unexpected failure behind a generic 500', async () => {
    mockedReply.mockRejectedValue(new Error('violates check constraint "message_author_customer"'));

    const response = await postReply(replyBody);

    expect(response.status).toBe(500);
    expect(JSON.stringify(await response.json())).not.toContain('message_author');
  });

  it('does not echo the submitted body back in an error', async () => {
    mockedReply.mockRejectedValue(new Error('boom'));

    const response = await postReply({ body: 'my card number is 4111 1111 1111 1111' });

    expect(JSON.stringify(await response.json())).not.toContain('4111');
  });
});
