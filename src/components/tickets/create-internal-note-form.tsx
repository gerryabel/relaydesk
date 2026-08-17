'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { createInternalNoteAction } from '@/lib/internal-notes/actions';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';

type CreateInternalNoteFormProps = {
  ticketId: string;
};

export default function CreateInternalNoteForm({ ticketId }: CreateInternalNoteFormProps) {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const [isPending, setIsPending] = useState(false);

  async function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);
    setIsPending(true);

    const formData = new FormData(event.currentTarget);
    const body = (formData.get('body') as string)?.trim() ?? '';

    const result = await createInternalNoteAction(ticketId, { body });

    setIsPending(false);

    if (result.error) {
      setError(result.error);
      return;
    }

    router.refresh();
  }

  return (
    <form onSubmit={handleSubmit} className="flex flex-col gap-4">
      {error ? (
        <div className="rounded-md border border-red-200 bg-red-50 p-3 text-sm text-red-700 dark:border-red-900/60 dark:bg-red-950/40 dark:text-red-300">
          {error}
        </div>
      ) : null}

      <div className="flex flex-col gap-2">
        <Label htmlFor="internal-note-body">Internal note</Label>
        <Textarea
          id="internal-note-body"
          name="body"
          rows={4}
          maxLength={10000}
          required
          autoFocus
          placeholder="Tulis catatan internal untuk tim..."
        />
        <p className="text-xs text-neutral-500 dark:text-neutral-400">
          Catatan ini hanya terlihat oleh anggota workspace, bukan pelanggan.
        </p>
      </div>

      <div className="flex items-center justify-end gap-3">
        <Button type="submit" disabled={isPending}>
          Add internal note
        </Button>
      </div>
    </form>
  );
}
