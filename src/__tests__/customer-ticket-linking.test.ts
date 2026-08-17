import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { prisma as sharedPrisma } from '@/lib/db/prisma';
import { updateTicket, CustomerNotInWorkspaceError } from '@/lib/tickets/server';
import { getCurrentMembership } from '@/lib/workspace/server';
import * as customersModule from '@/lib/customers/server';

vi.mock('@/lib/workspace/server', () => ({
  getCurrentMembership: vi.fn(),
}));

vi.mock('@/lib/customers/server', async () => {
  const actual = await vi.importActual<typeof import('@/lib/customers/server')>('@/lib/customers/server');
  return {
    ...actual,
    assertCustomerInWorkspace: vi.fn(),
    getCustomerTickets: vi.fn(),
  };
});

const mockedGetCurrentMembership = vi.mocked(getCurrentMembership);
const mockedAssertCustomerInWorkspace = vi.mocked(customersModule.assertCustomerInWorkspace);
const mockedGetCustomerTickets = vi.mocked(customersModule.getCustomerTickets);

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

const fakeCustomerA = {
  id: 'customer-1',
  workspaceId: 'workspace-123',
  name: 'Customer A',
  email: 'a@example.com',
  phone: '081234567890',
  notes: null,
  createdAt: new Date('2025-01-01T00:00:00Z'),
  updatedAt: new Date('2025-01-01T00:00:00Z'),
};

const fakeCustomerB = {
  id: 'customer-2',
  workspaceId: 'workspace-123',
  name: 'Customer B',
  email: 'b@example.com',
  phone: null,
  notes: null,
  createdAt: new Date('2025-01-01T00:00:00Z'),
  updatedAt: new Date('2025-01-01T00:00:00Z'),
};

const fakeTicket = {
  id: 'ticket-1',
  workspaceId: 'workspace-123',
  createdById: 'user-123',
  title: 'Judul Tiket',
  description: 'Deskripsi',
  status: 'open',
  priority: 'medium',
  createdAt: new Date('2025-01-01T00:00:00Z'),
  updatedAt: new Date('2025-01-01T00:00:00Z'),
  responseSlaDeadline: new Date('2025-01-01T12:00:00Z'),
  resolutionSlaDeadline: new Date('2025-01-02T00:00:00Z'),
  firstResponseAt: null,
  resolvedAt: null,
  createdBy: {
    id: 'user-123',
    email: 'user@example.com',
    emailVerified: true,
    name: 'User 123',
    image: null,
    createdAt: new Date('2025-01-01T00:00:00Z'),
    updatedAt: new Date('2025-01-01T00:00:00Z'),
  },
};

beforeEach(() => {
  mockedGetCurrentMembership.mockResolvedValue(fakeMembership as never);
  mockedAssertCustomerInWorkspace.mockReset();
  mockedGetCustomerTickets.mockReset();
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('customer ticket linking', () => {
  it('allows assigning a customer to a ticket without customer', async () => {
    vi.spyOn(sharedPrisma.ticket, 'findFirst').mockResolvedValue({ ...fakeTicket, customerId: null } as never);
    const transactionSpy = vi.spyOn(sharedPrisma, '$transaction').mockImplementation(async (worker) => {
      const txClient = {
        ticket: {
          update: vi.fn().mockResolvedValue({ ...fakeTicket, customerId: 'customer-1', customer: fakeCustomerA } as never),
        },
        ticketActivity: {
          create: vi.fn().mockResolvedValue({ id: 'activity-1' } as never),
        },
      } as never;

      return worker(txClient);
    });

    try {
      const ticket = await updateTicket('ticket-1', { customerId: 'customer-1', description: null });

      expect(mockedAssertCustomerInWorkspace).toHaveBeenCalledWith('customer-1', 'workspace-123');
      expect(ticket.customerId).toBe('customer-1');
      expect(ticket.customer?.id).toBe('customer-1');
      expect(transactionSpy).toHaveBeenCalledTimes(1);
    } finally {
      transactionSpy.mockRestore();
    }
  });

  it('allows changing the customer on a ticket', async () => {
    vi.spyOn(sharedPrisma.ticket, 'findFirst').mockResolvedValue({ ...fakeTicket, customerId: 'customer-1' } as never);
    const transactionSpy = vi.spyOn(sharedPrisma, '$transaction').mockImplementation(async (worker) => {
      const txClient = {
        ticket: {
          update: vi.fn().mockResolvedValue({ ...fakeTicket, customerId: 'customer-2', customer: fakeCustomerB } as never),
        },
        ticketActivity: {
          create: vi.fn().mockResolvedValue({ id: 'activity-1' } as never),
        },
      } as never;

      return worker(txClient);
    });

    try {
      const ticket = await updateTicket('ticket-1', { customerId: 'customer-2', description: null });

      expect(mockedAssertCustomerInWorkspace).toHaveBeenCalledWith('customer-2', 'workspace-123');
      expect(ticket.customerId).toBe('customer-2');
      expect(ticket.customer?.id).toBe('customer-2');
    } finally {
      transactionSpy.mockRestore();
    }
  });

  it('allows unlinking a customer from a ticket', async () => {
    vi.spyOn(sharedPrisma.ticket, 'findFirst').mockResolvedValue({ ...fakeTicket, customerId: 'customer-1' } as never);
    const transactionSpy = vi.spyOn(sharedPrisma, '$transaction').mockImplementation(async (worker) => {
      const txClient = {
        ticket: {
          update: vi.fn().mockResolvedValue({ ...fakeTicket, customerId: null, customer: null } as never),
        },
        ticketActivity: {
          create: vi.fn().mockResolvedValue({ id: 'activity-1' } as never),
        },
      } as never;

      return worker(txClient);
    });

    try {
      const ticket = await updateTicket('ticket-1', { customerId: null, description: null });

      expect(mockedAssertCustomerInWorkspace).not.toHaveBeenCalled();
      expect(ticket.customerId).toBeNull();
      expect(ticket.customer).toBeNull();
    } finally {
      transactionSpy.mockRestore();
    }
  });

  it('rejects cross-workspace customer assignment', async () => {
    vi.spyOn(sharedPrisma.ticket, 'findFirst').mockResolvedValue({ ...fakeTicket, customerId: null } as never);
    mockedAssertCustomerInWorkspace.mockRejectedValueOnce(new CustomerNotInWorkspaceError());

    await expect(updateTicket('ticket-1', { customerId: 'customer-999', description: null })).rejects.toThrow(CustomerNotInWorkspaceError);
  });
});

describe('customer ticket history', () => {
  it('returns tickets for the customer in the current workspace', async () => {
    mockedGetCustomerTickets.mockResolvedValue([
      {
        id: 'ticket-1',
        title: 'Tiket 1',
        status: 'open',
        priority: 'medium',
        createdAt: new Date('2025-01-01T00:00:00Z'),
        updatedAt: new Date('2025-01-02T00:00:00Z'),
        createdBy: { id: 'user-123', name: 'User 123', email: 'user@example.com' },
        assignedTo: { id: 'user-456', name: 'Assignee', email: 'assignee@example.com' },
      },
      {
        id: 'ticket-2',
        title: 'Tiket 2',
        status: 'closed',
        priority: 'high',
        createdAt: new Date('2025-01-01T00:00:00Z'),
        updatedAt: new Date('2025-01-01T00:00:00Z'),
        createdBy: { id: 'user-123', name: 'User 123', email: 'user@example.com' },
        assignedTo: null,
      },
    ] as never);

    const tickets = await customersModule.getCustomerTickets('customer-1');

    expect(mockedGetCustomerTickets).toHaveBeenCalledWith('customer-1');
    expect(tickets).toHaveLength(2);
    expect(tickets[0].id).toBe('ticket-1');
    expect(tickets[1].id).toBe('ticket-2');
  });

  it('returns empty list when customer has no tickets', async () => {
    mockedGetCustomerTickets.mockResolvedValue([] as never);

    const tickets = await customersModule.getCustomerTickets('customer-1');

    expect(tickets).toHaveLength(0);
    expect(mockedGetCustomerTickets).toHaveBeenCalledWith('customer-1');
  });

  it('rejects customer from another workspace', async () => {
    mockedGetCustomerTickets.mockRejectedValueOnce(new customersModule.CustomerNotFoundError());

    await expect(customersModule.getCustomerTickets('other-workspace-customer')).rejects.toThrow('Customer tidak ditemukan.');
  });
});
