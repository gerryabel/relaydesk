import { describe, it, expect } from 'vitest';
import { uploadAttachmentSchema } from '@/lib/attachments/schema';
import { attachmentConfig } from '@/lib/attachments/config';

describe('uploadAttachmentSchema', () => {
  it('validates a valid input', () => {
    const result = uploadAttachmentSchema.parse({
      filename: 'test.pdf',
      mimeType: 'application/pdf',
      sizeBytes: 1024,
    });
    expect(result).toEqual({
      filename: 'test.pdf',
      mimeType: 'application/pdf',
      sizeBytes: 1024,
    });
  });

  it('rejects empty filename', () => {
    expect(() =>
      uploadAttachmentSchema.parse({ filename: '', mimeType: 'application/pdf', sizeBytes: 1024 }),
    ).toThrow('Nama file wajib diisi');
  });

  it('rejects filename longer than 255 characters', () => {
    expect(() =>
      uploadAttachmentSchema.parse({ filename: 'a'.repeat(256), mimeType: 'application/pdf', sizeBytes: 1024 }),
    ).toThrow('Nama file maksimal 255 karakter');
  });

  it('rejects empty mimeType', () => {
    expect(() =>
      uploadAttachmentSchema.parse({ filename: 'test.pdf', mimeType: '', sizeBytes: 1024 }),
    ).toThrow('Tipe file wajib diisi');
  });

  it('rejects zero sizeBytes', () => {
    expect(() =>
      uploadAttachmentSchema.parse({ filename: 'test.pdf', mimeType: 'application/pdf', sizeBytes: 0 }),
    ).toThrow('Ukuran file harus lebih dari 0');
  });

  it('rejects negative sizeBytes', () => {
    expect(() =>
      uploadAttachmentSchema.parse({ filename: 'test.pdf', mimeType: 'application/pdf', sizeBytes: -1 }),
    ).toThrow('Ukuran file harus lebih dari 0');
  });

  it('rejects non-integer sizeBytes', () => {
    expect(() =>
      uploadAttachmentSchema.parse({ filename: 'test.pdf', mimeType: 'application/pdf', sizeBytes: 1.5 }),
    ).toThrow();
  });
});

describe('attachmentConfig', () => {
  it('has maxFileSizeBytes set to 10MB', () => {
    expect(attachmentConfig.maxFileSizeBytes).toBe(10 * 1024 * 1024);
  });

  it('has a non-empty allowedMimeTypes list', () => {
    expect(attachmentConfig.allowedMimeTypes.length).toBeGreaterThan(0);
  });

  it('does not include */*', () => {
    expect(attachmentConfig.allowedMimeTypes).not.toContain('*/*');
  });

  it('includes common document types', () => {
    expect(attachmentConfig.allowedMimeTypes).toContain('application/pdf');
    expect(attachmentConfig.allowedMimeTypes).toContain('image/png');
    expect(attachmentConfig.allowedMimeTypes).toContain('text/plain');
  });

  it('does not include executable types', () => {
    expect(attachmentConfig.allowedMimeTypes).not.toContain('application/x-executable');
    expect(attachmentConfig.allowedMimeTypes).not.toContain('application/javascript');
  });
});
