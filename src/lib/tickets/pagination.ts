import { z } from 'zod';

export type TicketPaginationInput = {
  page: number;
  limit: number;
};

export const ticketPaginationSchema = z.object({
  page: z.coerce.number().int().positive().optional(),
  limit: z.coerce.number().int().positive().max(100).optional(),
});

export type TicketPaginationSchemaInput = z.infer<typeof ticketPaginationSchema>;

export type TicketPaginationResult<T> = {
  data: T[];
  page: number;
  limit: number;
  total: number;
  totalPages: number;
  hasPreviousPage: boolean;
  hasNextPage: boolean;
};

export function normalizeTicketPagination(input: TicketPaginationSchemaInput): TicketPaginationInput {
  const parsed = ticketPaginationSchema.parse(input);
  return {
    page: parsed.page ?? 1,
    limit: parsed.limit ?? 20,
  };
}
