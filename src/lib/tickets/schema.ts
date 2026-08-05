import { z } from 'zod';

export const ticketStatusSchema = z.enum(['open', 'in_progress', 'resolved', 'closed']);

export const ticketPrioritySchema = z.enum(['low', 'medium', 'high', 'urgent']);

export const createTicketSchema = z.object({
  title: z.string().trim().min(1, 'Judul tiket wajib diisi').max(140, 'Judul tiket maksimal 140 karakter'),
  description: z
    .string()
    .max(5000, 'Deskripsi tiket maksimal 5000 karakter')
    .nullable()
    .optional()
    .transform((value) => {
      if (typeof value !== 'string') return value;
      const trimmed = value.trim();
      return trimmed ? trimmed : null;
    }),
  priority: ticketPrioritySchema.default('medium'),
});

export const updateTicketSchema = z.object({
  title: z.string().trim().min(1, 'Judul tiket wajib diisi').max(140, 'Judul tiket maksimal 140 karakter').optional(),
  description: z
    .string()
    .max(5000, 'Deskripsi tiket maksimal 5000 karakter')
    .nullable()
    .optional()
    .transform((value) => {
      if (typeof value !== 'string') return value;
      const trimmed = value.trim();
      return trimmed ? trimmed : null;
    }),
  status: ticketStatusSchema.optional(),
  priority: ticketPrioritySchema.optional(),
});

export type CreateTicketInput = z.infer<typeof createTicketSchema>;
export type UpdateTicketInput = z.infer<typeof updateTicketSchema>;

export const ticketFiltersSchema = z.object({
  search: z.string().trim().max(200, 'Pencarian maksimal 200 karakter').optional(),
  status: ticketStatusSchema.optional(),
  priority: ticketPrioritySchema.optional(),
});

export const ticketSearchSchema = z.object({
  search: z.string().trim().max(200, 'Pencarian maksimal 200 karakter').optional(),
});

export const ticketStatusFilterSchema = z.object({
  status: ticketStatusSchema.optional(),
});

export const ticketPriorityFilterSchema = z.object({
  priority: ticketPrioritySchema.optional(),
});

export type TicketFiltersInput = z.infer<typeof ticketFiltersSchema>;
