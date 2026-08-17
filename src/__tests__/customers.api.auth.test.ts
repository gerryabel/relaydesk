import { describe, it, expect, vi, afterEach } from 'vitest';
import { NextRequest } from 'next/server';
import { GET, PATCH } from '@/app/api/customers/[id]/route';
import { GET as listCustomers, POST as createCustomerRoute } from '@/app/api/customers/route';
import { createCustomer, getCustomers, getCustomerById, updateCustomer, CustomerNotFoundError } from '@/lib/customers/server';
import { UnauthorizedError, ForbiddenError, getCurrentMembership } from '@/lib/workspace/server';

vi.mock('@/lib/customers/server', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/customers/server')>();
  return {
    ...actual,
    createCustomer: vi.fn(actual.createCustomer),
    getCustomers: vi.fn(actual.getCustomers),
    getCustomerById: vi.fn(actual.getCustomerById),
    updateCustomer: vi.fn(actual.updateCustomer),
  };
});

vi.mock('@/lib/workspace/server', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/workspace/server')>();
  return {
    ...actual,
    getCurrentMembership: vi.fn(),
  };
});

const mockedCreateCustomer = vi.mocked(createCustomer);
const mockedGetCustomers = vi.mocked(getCustomers);
const mockedGetCustomerById = vi.mocked(getCustomerById);
const mockedUpdateCustomer = vi.mocked(updateCustomer);
const mockedGetCurrentMembership = vi.mocked(getCurrentMembership);

function createRequest(init?: RequestInit) {
  return new NextRequest('http://localhost/api/customers', { ...init, signal: undefined });
}

function createDetailRequest(init?: RequestInit) {
  return new NextRequest('http://localhost/api/customers/customer-1', { ...init, signal: undefined });
}

const fakeMembership = {
  userId: 'user-123',
  workspaceId: 'workspace-123',
  workspace: {
    id: 'workspace-123',
    name: 'Workspace 123',
    createdAt: new Date('2025-01-01T00:00:00Z'),
    updatedAt: new Date('2025-01-01T00:00:00Z'),
  },
};

const fakeCustomer = {
  id: 'customer-1',
  workspaceId: 'workspace-123',
  name: 'Customer 1',
  email: 'customer@example.com',
  phone: '081234567890',
  notes: 'Catatan penting.',
  createdAt: new Date('2025-01-01T00:00:00Z'),
  updatedAt: new Date('2025-01-01T00:00:00Z'),
  _count: { tickets: 2 },
};

afterEach(() => {
  mockedCreateCustomer.mockReset();
  mockedGetCustomers.mockReset();
  mockedGetCustomerById.mockReset();
  mockedUpdateCustomer.mockReset();
  mockedGetCurrentMembership.mockReset();
  vi.restoreAllMocks();
});

describe('customer list API auth and behavior', () => {
  it('GET returns 401 when membership resolution fails', async () => {
    mockedGetCustomers.mockRejectedValueOnce(new UnauthorizedError('No authenticated session'));
    const response = await listCustomers();
    const body = await response.json();

    expect(response.status).toBe(401);
    expect(body.error).toBe('Unauthorized');
  });

  it('GET returns 403 when membership resolution fails', async () => {
    mockedGetCustomers.mockRejectedValueOnce(new ForbiddenError('No workspace membership found'));
    const response = await listCustomers();
    const body = await response.json();

    expect(response.status).toBe(403);
    expect(body.error).toBe('Forbidden');
  });

  it('GET returns customers when authorized', async () => {
    mockedGetCurrentMembership.mockResolvedValueOnce(fakeMembership as never);
    mockedGetCustomers.mockResolvedValueOnce([fakeCustomer] as never);

    const response = await listCustomers();
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body).toHaveLength(1);
    expect(body[0].id).toBe('customer-1');
  });

  it('POST returns 400 for invalid payload', async () => {
    const response = await createCustomerRoute(
      createRequest({ method: 'POST', body: JSON.stringify({ name: '' }) }),
    );
    const body = await response.json();

    expect(response.status).toBe(400);
    expect(body.error).toBe('Nama customer wajib diisi');
  });

  it('POST returns 401 when membership resolution fails', async () => {
    mockedCreateCustomer.mockRejectedValueOnce(new UnauthorizedError('No authenticated session'));

    const response = await createCustomerRoute(
      createRequest({ method: 'POST', body: JSON.stringify({ name: 'Customer', email: 'x@y.com' }) }),
    );
    const body = await response.json();

    expect(response.status).toBe(401);
    expect(body.error).toBe('Unauthorized');
  });

  it('POST returns created customer when authorized and valid', async () => {
    mockedCreateCustomer.mockResolvedValueOnce(fakeCustomer as never);

    const response = await createCustomerRoute(
      createRequest({ method: 'POST', body: JSON.stringify({ name: 'Customer', email: 'x@y.com' }) }),
    );
    const body = await response.json();

    expect(response.status).toBe(201);
    expect(body.id).toBe('customer-1');
    expect(mockedCreateCustomer).toHaveBeenCalledWith({ name: 'Customer', email: 'x@y.com' });
  });
});

describe('customer detail API auth and behavior', () => {
  it('GET returns 404 when customer is not found', async () => {
    mockedGetCustomerById.mockRejectedValueOnce(new CustomerNotFoundError());
    const response = await GET(createDetailRequest(), { params: Promise.resolve({ id: 'customer-1' }) });

    expect(response.status).toBe(404);
  });

  it('GET returns customer when authorized', async () => {
    mockedGetCurrentMembership.mockResolvedValueOnce(fakeMembership as never);
    mockedGetCustomerById.mockResolvedValueOnce(fakeCustomer as never);

    const response = await GET(createDetailRequest(), { params: Promise.resolve({ id: 'customer-1' }) });
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.id).toBe('customer-1');
  });

  it('PATCH returns 400 for invalid payload', async () => {
    const response = await PATCH(
      createDetailRequest({ method: 'PATCH', body: JSON.stringify({ name: '   ' }) }),
      { params: Promise.resolve({ id: 'customer-1' }) },
    );
    const body = await response.json();

    expect(response.status).toBe(400);
    expect(body.error).toBe('Nama customer wajib diisi');
  });

  it('PATCH returns 404 when customer is not found', async () => {
    mockedUpdateCustomer.mockRejectedValueOnce(new CustomerNotFoundError());
    const response = await PATCH(
      createDetailRequest({ method: 'PATCH', body: JSON.stringify({ name: 'Baru' }) }),
      { params: Promise.resolve({ id: 'missing' }) },
    );

    expect(response.status).toBe(404);
  });

  it('PATCH returns updated customer when authorized and valid', async () => {
    mockedUpdateCustomer.mockResolvedValueOnce({ ...fakeCustomer, name: 'Customer Baru' } as never);

    const response = await PATCH(
      createDetailRequest({ method: 'PATCH', body: JSON.stringify({ name: 'Customer Baru' }) }),
      { params: Promise.resolve({ id: 'customer-1' }) },
    );
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.name).toBe('Customer Baru');
    expect(mockedUpdateCustomer).toHaveBeenCalledWith('customer-1', { name: 'Customer Baru' });
  });
});
