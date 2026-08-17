'use client';

import { useState, useRef } from 'react';
import { Button } from '@/components/ui/button';

type AttachmentUploadFormProps = {
  messageId: string;
  onUploaded: () => void;
};

const MAX_FILE_SIZE = 10 * 1024 * 1024;

export default function AttachmentUploadForm({ messageId, onUploaded }: AttachmentUploadFormProps) {
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [error, setError] = useState<string | null>(null);
  const [isUploading, setIsUploading] = useState(false);
  const [selectedFile, setSelectedFile] = useState<File | null>(null);

  function handleFileSelect(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0] ?? null;
    setSelectedFile(file);
    setError(null);

    if (file && file.size > MAX_FILE_SIZE) {
      setError('Ukuran file melebihi batas 10MB');
      setSelectedFile(null);
    }
  }

  async function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError(null);

    if (!selectedFile) {
      setError('Pilih file terlebih dahulu');
      return;
    }

    if (selectedFile.size > MAX_FILE_SIZE) {
      setError('Ukuran file melebihi batas 10MB');
      return;
    }

    setIsUploading(true);

    try {
      const formData = new FormData();
      formData.append('file', selectedFile);

      const response = await fetch(`/api/messages/${messageId}/attachments`, {
        method: 'POST',
        body: formData,
      });

      if (!response.ok) {
        const data = await response.json();
        throw new Error(data.error ?? 'Gagal mengunggah lampiran');
      }

      setSelectedFile(null);
      if (fileInputRef.current) {
        fileInputRef.current.value = '';
      }
      onUploaded();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Gagal mengunggah lampiran');
    } finally {
      setIsUploading(false);
    }
  }

  return (
    <form onSubmit={handleSubmit} className="flex flex-col gap-3">
      {error ? (
        <div className="rounded-md border border-red-200 bg-red-50 p-3 text-sm text-red-700 dark:border-red-900/60 dark:bg-red-950/40 dark:text-red-300">
          {error}
        </div>
      ) : null}

      <div className="flex flex-wrap items-center gap-3">
        <label
          htmlFor={`attachment-${messageId}`}
          className="cursor-pointer rounded-md border border-neutral-300 bg-white px-3 py-2 text-sm font-medium text-neutral-700 transition hover:bg-neutral-50 dark:border-neutral-700 dark:bg-neutral-900 dark:text-neutral-200 dark:hover:bg-neutral-800"
        >
          Pilih File
          <input
            ref={fileInputRef}
            id={`attachment-${messageId}`}
            name="file"
            type="file"
            onChange={handleFileSelect}
            disabled={isUploading}
            className="sr-only"
          />
        </label>

        {selectedFile ? (
          <span className="text-sm text-neutral-600 dark:text-neutral-400">
            {selectedFile.name} ({Math.round(selectedFile.size / 1024)}KB)
          </span>
        ) : null}

        <Button type="submit" disabled={isUploading || !selectedFile}>
          {isUploading ? 'Mengunggah...' : 'Unggah'}
        </Button>
      </div>
    </form>
  );
}
