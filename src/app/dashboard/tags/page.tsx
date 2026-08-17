'use client';

import { useState } from 'react';
import { EmptyState } from '@/components/ui/empty-state';
import TagForm from '@/components/tags/tag-form';

export type TagManagementProps = {
  initialTags: Array<{ id: string; name: string }>;
  onCreate: (input: { name: string }) => Promise<{ id: string; name: string }>;
  onUpdate: (id: string, input: { name: string }) => Promise<{ id: string; name: string }>;
  onDelete: (id: string) => Promise<void>;
};

export default function TagManagement({ initialTags, onCreate, onUpdate, onDelete }: TagManagementProps) {
  const [tags, setTags] = useState(initialTags);
  const [editingTagId, setEditingTagId] = useState<string | null>(null);
  const [isCreating, setIsCreating] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleCreate = async (input: { name: string }) => {
    setError(null);
    const tag = await onCreate(input);
    setTags((current) => [...current, tag]);
    setIsCreating(false);
  };

  const handleUpdate = async (tagId: string, input: { name: string }) => {
    setError(null);
    const tag = await onUpdate(tagId, input);
    setTags((current) => current.map((item) => (item.id === tagId ? tag : item)));
    setEditingTagId(null);
  };

  const handleDelete = async (tagId: string) => {
    setError(null);
    await onDelete(tagId);
    setTags((current) => current.filter((tag) => tag.id !== tagId));
  };

  return (
    <div className="mx-auto max-w-5xl px-4 py-10">
      <div className="flex flex-col gap-6">
        <header className="flex flex-col gap-1 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <h1 className="text-2xl font-semibold">Tags</h1>
            <p className="mt-2 text-sm text-neutral-600 dark:text-neutral-300">
              Kelola label yang digunakan untuk mengklasifikasikan tiket.
            </p>
          </div>
          {!isCreating ? (
            <button
              type="button"
              onClick={() => setIsCreating(true)}
              className="inline-flex items-center justify-center rounded-md bg-neutral-900 px-3 py-2 text-sm font-medium text-white transition hover:bg-neutral-800 dark:bg-neutral-100 dark:text-neutral-900 dark:hover:bg-neutral-200"
            >
              Create tag
            </button>
          ) : null}
        </header>

        {isCreating ? (
          <section className="rounded-lg border border-neutral-200 bg-white p-5 dark:border-neutral-800 dark:bg-neutral-900">
            <h2 className="text-sm font-medium text-neutral-700 dark:text-neutral-200">Buat tag baru</h2>
            <div className="mt-3">
              <TagForm onSubmit={handleCreate} onDelete={undefined} submitLabel="Create tag" />
            </div>
            <button
              type="button"
              onClick={() => setIsCreating(false)}
              className="mt-3 inline-flex items-center justify-center rounded-md border border-neutral-300 px-3 py-2 text-sm hover:border-neutral-900 dark:border-neutral-700 dark:hover:border-neutral-100"
            >
              Batal
            </button>
          </section>
        ) : null}

        {error ? (
          <p className="text-sm text-red-600 dark:text-red-400" role="alert">
            {error}
          </p>
        ) : null}

        {tags.length === 0 ? (
          <EmptyState
            title="Belum ada tag"
            description="Buat tag pertama untuk mulai mengelompokkan tiket."
            action={
              <button
                type="button"
                onClick={() => setIsCreating(true)}
                className="inline-flex items-center justify-center rounded-md bg-neutral-900 px-3 py-2 text-sm text-white hover:bg-neutral-800 dark:bg-neutral-100 dark:text-neutral-900 dark:hover:bg-neutral-200"
              >
                Create tag
              </button>
            }
          />
        ) : (
          <ul className="flex flex-col gap-3">
            {tags.map((tag) => (
              <li
                key={tag.id}
                className="rounded-lg border border-neutral-200 bg-white p-4 dark:border-neutral-800 dark:bg-neutral-900"
              >
                {editingTagId === tag.id ? (
                  <TagForm
                    initialTag={tag}
                    onSubmit={(input) => handleUpdate(tag.id, input)}
                    onDelete={undefined}
                    submitLabel="Update tag"
                  />
                ) : (
                  <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                    <div>
                      <p className="text-sm font-medium text-neutral-900 dark:text-neutral-50">{tag.name}</p>
                    </div>
                    <div className="flex flex-wrap items-center gap-2">
                      <button
                        type="button"
                        onClick={() => setEditingTagId(tag.id)}
                        className="inline-flex items-center justify-center rounded-md border border-neutral-300 px-3 py-2 text-sm hover:border-neutral-900 dark:border-neutral-700 dark:hover:border-neutral-100"
                      >
                        Rename
                      </button>
                      <button
                        type="button"
                        onClick={() => handleDelete(tag.id)}
                        className="inline-flex items-center justify-center rounded-md border border-red-200 px-3 py-2 text-sm font-medium text-red-700 transition hover:border-red-400 hover:text-red-800 dark:border-red-900/40 dark:text-red-300 dark:hover:border-red-700"
                      >
                        Delete
                      </button>
                    </div>
                  </div>
                )}
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}
