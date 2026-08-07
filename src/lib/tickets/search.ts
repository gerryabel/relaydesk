import { z } from 'zod';
import { normalizeTicketSort, type TicketSortInput } from './sort';

export const ticketQuerySchema = z.object({
  q: z
    .string()
    .max(200, 'Kata kunci pencarian maksimal 200 karakter')
    .transform((value) => value.trim())
    .optional(),
  sort: z
    .string()
    .transform((value) => value.trim())
    .optional(),
});

export type TicketQueryInput = {
  q?: string;
  sort?: unknown;
};

export type TicketQueryResult = TicketQueryInput & {
  sort?: TicketSortInput;
};

export function normalizeTicketQuery(input: TicketQueryInput): TicketQueryResult {
  const normalized: TicketQueryResult = {
    q: input.q,
    sort: normalizeTicketSort(input.sort),
  };

  return normalized;
}
