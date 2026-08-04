import { z } from 'zod';

export const createMessageSchema = z.object({
  body: z.string().trim().min(1, 'Pesan wajib diisi').max(4000, 'Pesan maksimal 4000 karakter'),
});

export type CreateMessageInput = z.infer<typeof createMessageSchema>;
