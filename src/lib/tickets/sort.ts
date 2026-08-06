import { z } from 'zod';

export type TicketSortField = 'createdAt' | 'updatedAt' | 'title' | 'priority' | 'status';

export type TicketSortDirection = 'asc' | 'desc';

export type TicketSortInput = {
  field: TicketSortField;
  direction: TicketSortDirection;
};

export const TICKET_SORT_FIELD_OPTIONS = [
  { value: 'createdAt', label: 'Tanggal dibuat' },
  { value: 'updatedAt', label: 'Tanggal diperbarui' },
  { value: 'title', label: 'Judul' },
  { value: 'priority', label: 'Prioritas' },
  { value: 'status', label: 'Status' },
] as const;

export const TICKET_SORT_DIRECTION_OPTIONS = [
  { value: 'asc', label: 'A-Z / Lama - Baru' },
  { value: 'desc', label: 'Z-A / Baru - Lama' },
] as const;

export const ticketSortSchema = z.object({
  field: z.enum(['createdAt', 'updatedAt', 'title', 'priority', 'status']).default('createdAt'),
  direction: z.enum(['asc', 'desc']).default('desc'),
});

export type TicketSortSchemaInput = z.infer<typeof ticketSortSchema>;

export const ticketSortFieldSchema = z.enum(['createdAt', 'updatedAt', 'title', 'priority', 'status']);

export const ticketSortDirectionSchema = z.enum(['asc', 'desc']);

export function createTicketSort(input: TicketSortSchemaInput): TicketSortInput {
  return ticketSortSchema.parse(input);
}

export function normalizeTicketSort(raw: unknown): TicketSortInput | undefined {
  if (raw === undefined || raw === null || raw === '') {
    return undefined;
  }

  const source = typeof raw === 'string' ? { field: raw } : raw;

  const parsed = ticketSortSchema.safeParse(source);
  if (!parsed.success) {
    return undefined;
  }

  return parsed.data;
}

export function mapTicketSortToOrderBy(sort: TicketSortInput) {
  switch (sort.field) {
    case 'createdAt':
      return { createdAt: sort.direction };
    case 'updatedAt':
      return { updatedAt: sort.direction };
    case 'title':
      return { title: sort.direction };
    case 'priority':
      return { priority: sort.direction };
    case 'status':
      return { status: sort.direction };
  }
}
