import { z } from 'zod';

export const uploadAttachmentSchema = z.object({
  filename: z
    .string()
    .trim()
    .min(1, 'Nama file wajib diisi')
    .max(255, 'Nama file maksimal 255 karakter'),
  mimeType: z
    .string()
    .trim()
    .min(1, 'Tipe file wajib diisi')
    .max(255, 'Tipe file maksimal 255 karakter'),
  sizeBytes: z
    .number()
    .int()
    .positive('Ukuran file harus lebih dari 0'),
});

export type UploadAttachmentInput = z.infer<typeof uploadAttachmentSchema>;

export const attachmentResponseSchema = z.object({
  id: z.string(),
  messageId: z.string(),
  originalFilename: z.string(),
  mimeType: z.string(),
  sizeBytes: z.number(),
  createdAt: z.string(),
});

export type AttachmentResponse = z.infer<typeof attachmentResponseSchema>;
