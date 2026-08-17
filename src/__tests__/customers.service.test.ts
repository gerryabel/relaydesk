import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { prisma as sharedPrisma } from '@/lib/db/prisma';
import {
  createCustomer,
  getCustomers,
  getCustomerById,
  updateCustomer,
  CustomerNotFoundError,
} from '@/lib/customers/server';
import type { CreateCustomerInput, UpdateCustomerInput } from '@/lib/customers/schema';
import { getCurrentMembership } from '@/lib/workspace/server';

const fakeMembership = {
  userId: 'user-123',
  workspaceId: 'workspace-123',
  workspace: {
    id: 'workspace-123',
    name: 'Workspace 123',
    createdAt: new Date('2025-01-01T00:00:00Z'),
    updatedAt: new Date('2025-01-01T00:00:00Z'),
  },
} as const;

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

vi.mock('@/lib/workspace/server', () => ({
  getCurrentMembership: vi.fn(),
}));

describe('customer domain services', () => {
  beforeEach(() => {
    vi.mocked(getCurrentMembership).mockResolvedValue(fakeMembership as never);
  });

  afterEach(() => {
    vi.resetAllMocks();
  });

  it('createCustomer creates a customer in the current workspace', async () => {
    const createSpy = vi.spyOn(sharedPrisma.customer, 'create').mockResolvedValue(fakeCustomer as never);

    try {
      const customer = await createCustomer({ name: 'Customer 1', email: 'customer@example.com' } as CreateCustomerInput);

      expect(createSpy).toHaveBeenCalledWith({
        data: {
          workspaceId: 'workspace-123',
          name: 'Customer 1',
          email: 'customer@example.com',
        },
        include: {
          _count: {
            select: {
              tickets: true,
            },
          },
        },
      });
      expect(customer.id).toBe('customer-1');
    } finally {
      createSpy.mockRestore();
    }
  });

  it('getCustomers returns customers scoped to the current workspace', async () => {
    const findManySpy = vi.spyOn(sharedPrisma.customer, 'findMany').mockResolvedValue([fakeCustomer] as never);

    try {
      const customers = await getCustomers();

      expect(findManySpy).toHaveBeenCalledWith({
        where: { workspaceId: 'workspace-123' },
        include: expect.any(Object),
        orderBy: { createdAt: 'desc' },
      });
      expect(customers).toHaveLength(1);
    } finally {
      findManySpy.mockRestore();
    }
  });

  it('getCustomerById returns customer when found in workspace', async () => {
    const findFirstSpy = vi.spyOn(sharedPrisma.customer, 'findFirst').mockResolvedValue(fakeCustomer as never);

    try {
      const customer = await getCustomerById('customer-1');

      expect(findFirstSpy).toHaveBeenCalledWith({
        where: { id: 'customer-1', workspaceId: 'workspace-123' },
        include: expect.any(Object),
      });
      expect(customer.id).toBe('customer-1');
    } finally {
      findFirstSpy.mockRestore();
    }
  });

  it('getCustomerById throws CustomerNotFoundError when missing', async () => {
    vi.spyOn(sharedPrisma.customer, 'findFirst').mockResolvedValue(null as never);

    await expect(getCustomerById('missing')).rejects.toThrow(CustomerNotFoundError);
  });

  it('getCustomerById throws CustomerNotFoundError for another workspace customer', async () => {
    vi.spyOn(sharedPrisma.customer, 'findFirst').mockResolvedValue(null as never);

    await expect(getCustomerById('other-workspace-customer')).rejects.toThrow(CustomerNotFoundError);
  });

  it('updateCustomer rejects invalid input', async () => {
    await expect(updateCustomer('customer-1', { name: '' } as never)).rejects.toThrow();
  });

  it('updateCustomer updates customer in current workspace', async () => {
    const updated = { ...fakeCustomer, name: 'Customer Baru', email: 'baru@example.com', phone: null, notes: null };
    const findFirstSpy = vi.spyOn(sharedPrisma.customer, 'findFirst').mockResolvedValue({ id: 'customer-1' } as never);
    const updateSpy = vi.spyOn(sharedPrisma.customer, 'update').mockResolvedValue(updated as never);

    try {
      const result = await updateCustomer('customer-1', { name: 'Customer Baru', email: 'baru@example.com' } as UpdateCustomerInput);

      expect(findFirstSpy).toHaveBeenCalledWith({
        where: { id: 'customer-1', workspaceId: 'workspace-123' },
        select: { id: true },
      });
      expect(updateSpy).toHaveBeenCalledWith({
        where: { id: 'customer-1' },
        data: {
          name: 'Customer Baru',
          email: 'baru@example.com',
        },
        include: {
          _count: {
            select: {
              tickets: true,
            },
          },
        },
      });
      expect(result.name).toBe('Customer Baru');
    } finally {
      findFirstSpy.mockRestore();
      updateSpy.mockRestore();
    }
  });

  it('updateCustomer throws CustomerNotFoundError for missing customer', async () => {
    vi.spyOn(sharedPrisma.customer, 'findFirst').mockResolvedValue(null as never);

    await expect(updateCustomer('missing', { name: 'Baru' } as UpdateCustomerInput)).rejects.toThrow(CustomerNotFoundError);
  });
});
