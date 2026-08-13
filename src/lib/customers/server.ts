import { prisma } from '@/lib/db/prisma';
import { getCurrentMembership } from '@/lib/workspace/server';
import { createCustomerSchema, updateCustomerSchema, type CreateCustomerInput, type UpdateCustomerInput } from './schema';

export class CustomerNotFoundError extends Error {
  constructor(message = 'Customer tidak ditemukan.') {
    super(message);
    this.name = 'CustomerNotFoundError';
  }
}

export class CustomerNotInWorkspaceError extends Error {
  constructor(message = 'Customer bukan milik workspace ini.') {
    super(message);
    this.name = 'CustomerNotInWorkspaceError';
  }
}

export type CustomerWithTickets = {
  id: string;
  workspaceId: string;
  name: string;
  email: string | null;
  phone: string | null;
  notes: string | null;
  createdAt: Date;
  updatedAt: Date;
  _count: {
    tickets: number;
  };
};

export async function createCustomer(input: CreateCustomerInput): Promise<CustomerWithTickets> {
  const parsed = createCustomerSchema.parse(input);
  const membership = await getCurrentMembership();

  return prisma.customer.create({
    data: {
      workspaceId: membership.workspaceId,
      name: parsed.name,
      email: parsed.email,
      phone: parsed.phone,
      notes: parsed.notes,
    },
    include: {
      _count: {
        select: {
          tickets: true,
        },
      },
    },
  });
}

export async function getCustomers(): Promise<CustomerWithTickets[]> {
  const membership = await getCurrentMembership();

  return prisma.customer.findMany({
    where: {
      workspaceId: membership.workspaceId,
    },
    include: {
      _count: {
        select: {
          tickets: true,
        },
      },
    },
    orderBy: {
      createdAt: 'desc',
    },
  });
}

export async function getCustomerById(id: string): Promise<CustomerWithTickets> {
  const membership = await getCurrentMembership();

  const customer = await prisma.customer.findFirst({
    where: {
      id,
      workspaceId: membership.workspaceId,
    },
    include: {
      _count: {
        select: {
          tickets: true,
        },
      },
    },
  });

  if (!customer) {
    throw new CustomerNotFoundError();
  }

  return customer;
}

export async function getCustomerTickets(customerId: string) {
  const membership = await getCurrentMembership();

  const customer = await prisma.customer.findFirst({
    where: {
      id: customerId,
      workspaceId: membership.workspaceId,
    },
    select: {
      id: true,
    },
  });

  if (!customer) {
    throw new CustomerNotFoundError();
  }

  return prisma.ticket.findMany({
    where: {
      customerId: customer.id,
    },
    include: {
      createdBy: {
        select: {
          id: true,
          name: true,
          email: true,
        },
      },
      assignedTo: {
        select: {
          id: true,
          name: true,
          email: true,
        },
      },
    },
    orderBy: {
      updatedAt: 'desc',
    },
  });
}

export async function updateCustomer(id: string, input: UpdateCustomerInput): Promise<CustomerWithTickets> {
  const parsed = updateCustomerSchema.parse(input);
  const membership = await getCurrentMembership();

  const existing = await prisma.customer.findFirst({
    where: {
      id,
      workspaceId: membership.workspaceId,
    },
    select: {
      id: true,
    },
  });

  if (!existing) {
    throw new CustomerNotFoundError();
  }

  return prisma.customer.update({
    where: {
      id,
    },
    data: {
      name: parsed.name,
      email: parsed.email,
      phone: parsed.phone,
      notes: parsed.notes,
    },
    include: {
      _count: {
        select: {
          tickets: true,
        },
      },
    },
  });
}

export async function assertCustomerInWorkspace(customerId: string, workspaceId: string) {
  const customer = await prisma.customer.findFirst({
    where: {
      id: customerId,
      workspaceId,
    },
    select: {
      id: true,
    },
  });

  if (!customer) {
    throw new CustomerNotInWorkspaceError();
  }

  return customer;
}
