import { z } from 'zod';

export const ticketStatusSchema = z.enum(['open', 'in_progress', 'resolved', 'closed']);

export const ticketPrioritySchema = z.enum(['low', 'medium', 'high', 'urgent']);

export const createTicketSchema = z.object({
  title: z.string().min(1, 'Judul tiket wajib diisi').max(255, 'Judul tiket maksimal 255 karakter'),
  description: z
    .string()
    .max(65535, 'Deskripsi tiket maksimal 65535 karakter')
    .optional(),
  priority: ticketPrioritySchema.default('medium'),
});

export const updateTicketSchema = z.object({
  title: z
    .string()
    .min(1, 'Judul tiket wajib diisi')
    .max(255, 'Judul tiket maksimal 255 karakter')
    .optional(),
  description: z
    .string()
    .max(65535, 'Deskripsi tiket maksimal 65535 karakter')
    .optional(),
  priority: ticketPrioritySchema.optional(),
  status: ticketStatusSchema.optional(),
});

export type CreateTicketInput = z.infer<typeof createTicketSchema>;
export type UpdateTicketInput = z.infer<typeof updateTicketSchema>;
