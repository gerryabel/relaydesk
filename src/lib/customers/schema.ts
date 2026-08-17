import { z } from 'zod';

export const customerNameSchema = z
  .string()
  .trim()
  .min(1, 'Nama customer wajib diisi')
  .max(120, 'Nama customer maksimal 120 karakter');

export const customerEmailSchema = z
  .string()
  .trim()
  .max(320, 'Email maksimal 320 karakter')
  .transform((value) => {
    if (typeof value !== 'string') return value;
    const trimmed = value.trim();
    return trimmed ? trimmed : null;
  })
  .refine((value) => value === null || /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value), {
    message: 'Format email tidak valid',
  });

export const customerPhoneSchema = z
  .string()
  .trim()
  .max(50, 'Nomor telepon maksimal 50 karakter')
  .transform((value) => {
    if (typeof value !== 'string') return value;
    const trimmed = value.trim();
    return trimmed ? trimmed : null;
  });

export const customerNotesSchema = z
  .string()
  .trim()
  .max(2000, 'Catatan customer maksimal 2000 karakter')
  .transform((value) => {
    if (typeof value !== 'string') return value;
    const trimmed = value.trim();
    return trimmed ? trimmed : null;
  });

export const createCustomerSchema = z.object({
  name: customerNameSchema,
  email: customerEmailSchema.optional(),
  phone: customerPhoneSchema.optional(),
  notes: customerNotesSchema.optional(),
});

export const updateCustomerSchema = z.object({
  name: customerNameSchema.optional(),
  email: customerEmailSchema.optional(),
  phone: customerPhoneSchema.optional(),
  notes: customerNotesSchema.optional(),
});

export type CreateCustomerInput = z.infer<typeof createCustomerSchema>;
export type UpdateCustomerInput = z.infer<typeof updateCustomerSchema>;
