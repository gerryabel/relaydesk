import { z } from 'zod';

export const tagNameSchema = z
  .string()
  .trim()
  .min(1, 'Nama tag wajib diisi')
  .max(50, 'Nama tag maksimal 50 karakter')
  .refine((value) => value.trim().length > 0, 'Nama tag tidak boleh hanya whitespace');

export const createTagSchema = z.object({
  name: tagNameSchema,
});

export const updateTagSchema = z.object({
  name: tagNameSchema.optional(),
});

export type CreateTagInput = z.infer<typeof createTagSchema>;
export type UpdateTagInput = z.infer<typeof updateTagSchema>;
