import { z } from 'zod';

export const ticketSearchSchema = z.object({
  q: z
    .string()
    .max(200, 'Kata kunci pencarian maksimal 200 karakter')
    .transform((value) => value.trim())
    .optional(),
});

export type TicketSearchInput = z.infer<typeof ticketSearchSchema>;
