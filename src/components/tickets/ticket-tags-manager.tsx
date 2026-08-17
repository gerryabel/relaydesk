'use client';

import { useState } from 'react';
import { EmptyState } from '@/components/ui/empty-state';
import { addTicketTagAction, removeTicketTagAction } from '@/lib/tags/actions';

export type TicketTagsManagerProps = {
  ticketId: string;
  initialTags: Array<{ id: string; name: string }>;
  availableTags: Array<{ id: string; name: string }>;
};

export default function TicketTagsManager({ ticketId, initialTags, availableTags }: TicketTagsManagerProps) {
  const [tags, setTags] = useState(initialTags);
  const [error, setError] = useState<string | null>(null);
  const [isAdding, setIsAdding] = useState(false);
  const [addingTagId, setAddingTagId] = useState('');
  const [removingTagId, setRemovingTagId] = useState<string | null>(null);

  const handleAdd = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setError(null);

    if (!addingTagId) {
      setError('Pilih tag terlebih dahulu.');
      return;
    }

    try {
      setIsAdding(true);
      const result = await addTicketTagAction(ticketId, addingTagId);
      if (result.error) {
        setError(result.error);
        return;
      }
      setTags((current) => {
        const exists = current.some((tag) => tag.id === addingTagId);
        if (exists) return current;
        const found = availableTags.find((tag) => tag.id === addingTagId);
        return found ? [...current, found] : current;
      });
      setAddingTagId('');
    } catch (submitError) {
      setError((submitError as Error).message ?? 'Gagal menambahkan tag.');
    } finally {
      setIsAdding(false);
    }
  };

  const handleRemove = async (tagId: string) => {
    setError(null);
    try {
      setRemovingTagId(tagId);
      const result = await removeTicketTagAction(ticketId, tagId);
      if (result.error) {
        setError(result.error);
        return;
      }
      setTags((current) => current.filter((tag) => tag.id !== tagId));
    } catch (submitError) {
      setError((submitError as Error).message ?? 'Gagal menghapus tag dari tiket.');
    } finally {
      setRemovingTagId(null);
    }
  };

  const availableToAdd = availableTags.filter((tag) => !tags.some((current) => current.id === tag.id));

  return (
    <section className="flex flex-col gap-3">
      <header className="flex flex-col gap-1">
        <h2 className="text-xl font-semibold">Tags</h2>
        <p className="text-sm text-neutral-600 dark:text-neutral-300">
          Kelompokkan tiket ini menggunakan tag workspace.
        </p>
      </header>

      {error ? (
        <p className="text-sm text-red-600 dark:text-red-400" role="alert">
          {error}
        </p>
      ) : null}

      {tags.length === 0 ? (
        <EmptyState
          title="Belum ada tag"
          description="Tambahkan tag untuk membantu mengklasifikasikan tiket ini."
          action={
            <form onSubmit={handleAdd} className="flex flex-col gap-3">
              <select
                className="w-full rounded-md border border-neutral-300 bg-white px-3 py-2 text-sm text-neutral-900 focus:border-neutral-900 focus:outline-none dark:border-neutral-700 dark:bg-neutral-900 dark:text-neutral-50 dark:focus:border-neutral-100"
                value={addingTagId}
                onChange={(event) => setAddingTagId(event.target.value)}
                aria-label="Pilih tag"
              >
                <option value="">Pilih tag</option>
                {availableToAdd.map((tag) => (
                  <option key={tag.id} value={tag.id}>
                    {tag.name}
                  </option>
                ))}
              </select>
              <button
                type="submit"
                disabled={isAdding}
                className="inline-flex items-center justify-center rounded-md bg-neutral-900 px-3 py-2 text-sm font-medium text-white transition hover:bg-neutral-800 disabled:cursor-not-allowed disabled:opacity-60 dark:bg-neutral-100 dark:text-neutral-900 dark:hover:bg-neutral-200"
              >
                {isAdding ? 'Menambahkan...' : 'Add tag'}
              </button>
            </form>
          }
        />
      ) : (
        <div className="flex flex-col gap-3">
          <ul className="flex flex-wrap gap-2">
            {tags.map((tag) => (
              <li
                key={tag.id}
                className="inline-flex items-center gap-2 rounded-md border border-neutral-300 px-2 py-1 text-sm dark:border-neutral-700"
              >
                <span>{tag.name}</span>
                <button
                  type="button"
                  onClick={() => handleRemove(tag.id)}
                  disabled={removingTagId === tag.id}
                  aria-label={`Hapus tag ${tag.name}`}
                  className="text-neutral-500 hover:text-neutral-900 disabled:cursor-not-allowed disabled:opacity-60 dark:text-neutral-300 dark:hover:text-neutral-100"
                >
                  ×
                </button>
              </li>
            ))}
          </ul>

          {availableToAdd.length > 0 ? (
            <form onSubmit={handleAdd} className="flex flex-col gap-3 sm:flex-row sm:items-end">
              <label className="flex flex-col gap-1 text-sm">
                <span className="text-neutral-600 dark:text-neutral-300">Tambah tag</span>
                <select
                  className="w-full rounded-md border border-neutral-300 bg-white px-3 py-2 text-sm text-neutral-900 focus:border-neutral-900 focus:outline-none dark:border-neutral-700 dark:bg-neutral-900 dark:text-neutral-50 dark:focus:border-neutral-100"
                  value={addingTagId}
                  onChange={(event) => setAddingTagId(event.target.value)}
                  aria-label="Pilih tag"
                >
                  <option value="">Pilih tag</option>
                  {availableToAdd.map((tag) => (
                    <option key={tag.id} value={tag.id}>
                      {tag.name}
                    </option>
                  ))}
                </select>
              </label>
              <button
                type="submit"
                disabled={isAdding}
                className="inline-flex items-center justify-center rounded-md bg-neutral-900 px-3 py-2 text-sm font-medium text-white transition hover:bg-neutral-800 disabled:cursor-not-allowed disabled:opacity-60 dark:bg-neutral-100 dark:text-neutral-900 dark:hover:bg-neutral-200"
              >
                {isAdding ? 'Menambahkan...' : 'Add tag'}
              </button>
            </form>
          ) : null}
        </div>
      )}
    </section>
  );
}
