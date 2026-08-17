import { z } from 'zod';

export const createInternalNoteSchema = z.object({
  body: z
    .string()
    .trim()
    .min(1, 'Catatan internal wajib diisi')
    .max(10_000, 'Catatan internal maksimal 10.000 karakter'),
});

export type CreateInternalNoteInput = z.infer<typeof createInternalNoteSchema>;
