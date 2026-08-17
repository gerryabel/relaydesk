export const attachmentConfig = {
  maxFileSizeBytes: 10 * 1024 * 1024,
  allowedMimeTypes: [
    'image/png',
    'image/jpeg',
    'image/gif',
    'image/webp',
    'application/pdf',
    'application/msword',
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    'application/vnd.ms-excel',
    'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    'text/plain',
    'text/csv',
    'application/zip',
  ],
  storageRoot: process.env.ATTACHMENT_STORAGE_ROOT ?? './storage/attachments',
} as const;

export type AttachmentConfig = typeof attachmentConfig;
