'use client';

import { useState } from 'react';

export type TagFormProps = {
  initialTag?: { id: string; name: string };
  onSubmit: (input: { name: string }) => Promise<void>;
  onDelete?: () => Promise<void>;
  submitLabel?: string;
  deleteLabel?: string;
};

export default function TagForm({ initialTag, onSubmit, onDelete, submitLabel = 'Save tag', deleteLabel = 'Delete tag' }: TagFormProps) {
  const [name, setName] = useState(initialTag?.name ?? '');
  const [isSubmitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [confirmDelete, setConfirmDelete] = useState(false);

  const handleSubmit = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setError(null);

    const trimmed = name.trim();
    if (!trimmed) {
      setError('Nama tag wajib diisi.');
      return;
    }
    if (trimmed.length > 50) {
      setError('Nama tag maksimal 50 karakter.');
      return;
    }

    try {
      setSubmitting(true);
      await onSubmit({ name: trimmed });
      setName(trimmed);
    } catch (submitError) {
      setError((submitError as Error).message ?? 'Gagal menyimpan tag.');
    } finally {
      setSubmitting(false);
    }
  };

  const handleDelete = async () => {
    if (!onDelete || !confirmDelete) {
      setConfirmDelete(true);
      return;
    }

    setError(null);
    try {
      await onDelete();
    } catch (submitError) {
      setError((submitError as Error).message ?? 'Gagal menghapus tag.');
      setConfirmDelete(false);
    }
  };

  return (
    <form className="flex flex-col gap-3" onSubmit={handleSubmit}>
      <label className="flex flex-col gap-1 text-sm">
        <span className="text-neutral-600 dark:text-neutral-300">Nama tag</span>
        <input
          className="w-full rounded-md border border-neutral-300 bg-white px-3 py-2 text-sm text-neutral-900 placeholder:text-neutral-400 focus:border-neutral-900 focus:outline-none dark:border-neutral-700 dark:bg-neutral-900 dark:text-neutral-50 dark:focus:border-neutral-100"
          placeholder="Contoh: billing"
          value={name}
          onChange={(event) => setName(event.target.value)}
          maxLength={50}
          aria-label="Nama tag"
          disabled={isSubmitting}
        />
      </label>

      {error ? (
        <p className="text-sm text-red-600 dark:text-red-400" role="alert">
          {error}
        </p>
      ) : null}

      <div className="flex flex-wrap items-center gap-2">
        <button
          type="submit"
          disabled={isSubmitting}
          className="inline-flex items-center justify-center rounded-md bg-neutral-900 px-3 py-2 text-sm font-medium text-white transition hover:bg-neutral-800 disabled:cursor-not-allowed disabled:opacity-60 dark:bg-neutral-100 dark:text-neutral-900 dark:hover:bg-neutral-200"
        >
          {isSubmitting ? 'Menyimpan...' : submitLabel}
        </button>

        {onDelete ? (
          <button
            type="button"
            onClick={handleDelete}
            className="inline-flex items-center justify-center rounded-md border border-red-200 px-3 py-2 text-sm font-medium text-red-700 transition hover:border-red-400 hover:text-red-800 disabled:cursor-not-allowed disabled:opacity-60 dark:border-red-900/40 dark:text-red-300 dark:hover:border-red-700"
          >
            {confirmDelete ? 'Konfirmasi hapus' : deleteLabel}
          </button>
        ) : null}
      </div>
    </form>
  );
}
