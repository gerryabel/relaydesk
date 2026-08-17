'use client';

import { useState } from 'react';

type AttachmentItem = {
  id: string;
  originalFilename: string;
  mimeType: string;
  sizeBytes: number;
};

type AttachmentListProps = {
  attachments: AttachmentItem[];
  onDeleted: () => void;
};

function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes}B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)}KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)}MB`;
}

export default function AttachmentList({ attachments, onDeleted }: AttachmentListProps) {
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function handleDelete(attachmentId: string) {
    if (!confirm('Hapus lampiran ini?')) return;

    setDeletingId(attachmentId);
    setError(null);

    try {
      const response = await fetch(`/api/attachments/${attachmentId}`, {
        method: 'DELETE',
      });

      if (!response.ok) {
        const data = await response.json();
        throw new Error(data.error ?? 'Gagal menghapus lampiran');
      }

      onDeleted();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Gagal menghapus lampiran');
    } finally {
      setDeletingId(null);
    }
  }

  if (attachments.length === 0) {
    return null;
  }

  return (
    <div className="mt-3 flex flex-col gap-2">
      {error ? (
        <div className="rounded-md border border-red-200 bg-red-50 p-2 text-xs text-red-700 dark:border-red-900/60 dark:bg-red-950/40 dark:text-red-300">
          {error}
        </div>
      ) : null}

      <div className="flex flex-wrap gap-2">
        {attachments.map((attachment) => (
          <div
            key={attachment.id}
            className="flex items-center gap-2 rounded-md border border-neutral-200 bg-neutral-50 px-3 py-1.5 dark:border-neutral-700 dark:bg-neutral-800"
          >
            <div className="flex flex-col">
              <a
                href={`/api/attachments/${attachment.id}`}
                className="text-xs font-medium text-blue-600 hover:underline dark:text-blue-400"
                download
              >
                {attachment.originalFilename}
              </a>
              <span className="text-xs text-neutral-500 dark:text-neutral-400">
                {formatSize(attachment.sizeBytes)}
              </span>
            </div>

            <button
              type="button"
              onClick={() => handleDelete(attachment.id)}
              disabled={deletingId === attachment.id}
              className="text-xs text-red-500 hover:text-red-700 disabled:opacity-50 dark:text-red-400 dark:hover:text-red-300"
              aria-label={`Hapus ${attachment.originalFilename}`}
            >
              {deletingId === attachment.id ? '...' : 'Hapus'}
            </button>
          </div>
        ))}
      </div>
    </div>
  );
}
