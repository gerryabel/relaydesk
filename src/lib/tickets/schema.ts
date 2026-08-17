import { z } from 'zod';

export const ticketStatusSchema = z.enum(['open', 'in_progress', 'waiting_customer', 'resolved', 'closed']);

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
  customerId: z.string().trim().min(1, 'Customer ID wajib diisi').nullable().optional(),
});

export type CreateTicketInput = z.infer<typeof createTicketSchema>;
export type UpdateTicketInput = z.infer<typeof updateTicketSchema>;

export const ticketFiltersSchema = z.object({
  search: z.string().trim().max(200, 'Pencarian maksimal 200 karakter').optional(),
  status: ticketStatusSchema.optional(),
  priority: ticketPrioritySchema.optional(),
  assignee: z.string().trim().min(1, 'Assignee wajib diisi').max(64, 'Assignee ID maksimal 64 karakter').optional(),
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

export const ticketAssigneeFilterSchema = z.object({
  assignee: z.string().trim().min(1, 'Assignee wajib diisi').max(64, 'Assignee ID maksimal 64 karakter').optional(),
});

export const assignTicketSchema = z.object({
  assigneeId: z.string().trim().min(1, 'Assignee wajib diisi'),
});

export const unassignTicketSchema = z.object({});

export type AssignTicketInput = z.infer<typeof assignTicketSchema>;
export type UnassignTicketInput = z.infer<typeof unassignTicketSchema>;
export type TicketAssigneeFilterInput = z.infer<typeof ticketAssigneeFilterSchema>;

export const bulkActionSchema = z.object({
  ticketIds: z.array(z.string().trim().min(1, 'Ticket ID tidak valid')).min(1, 'Pilih minimal satu tiket').max(100, 'Maksimal 100 tiket'),
  action: z.enum(['assign', 'status', 'priority', 'add_tag', 'remove_tag']),
  value: z.unknown(),
});

export type BulkActionInput = z.infer<typeof bulkActionSchema>;

export const bulkAssignPayloadSchema = z.object({
  assigneeId: z.string().trim().min(1, 'Assignee wajib diisi'),
});

export const bulkStatusPayloadSchema = z.object({
  status: ticketStatusSchema,
});

export const bulkPriorityPayloadSchema = z.object({
  priority: ticketPrioritySchema,
});

export const bulkTagPayloadSchema = z.object({
  tagId: z.string().trim().min(1, 'Tag ID wajib diisi'),
});
