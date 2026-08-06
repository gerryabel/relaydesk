import { z } from 'zod';
import { normalizeTicketSort, type TicketSortInput } from './sort';

export const ticketSearchSchema = z.object({
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

export type TicketSearchInput = {
  q?: string;
  sort?: unknown;
};

export type TicketQueryInput = TicketSearchInput & {
  sort?: TicketSortInput;
};

export function normalizeTicketSearch(input: TicketSearchInput): TicketQueryInput {
  const normalized: TicketQueryInput = {
    q: input.q,
    sort: normalizeTicketSort(input.sort),
  };

  return normalized;
}
