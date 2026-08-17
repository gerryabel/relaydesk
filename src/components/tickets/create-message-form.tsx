'use client';

import { useState, useRef } from 'react';
import { useRouter } from 'next/navigation';
import { createMessageAction } from '@/lib/messages/actions';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';

type CreateMessageFormProps = {
  ticketId: string;
};

const MAX_FILE_SIZE = 10 * 1024 * 1024;

export default function CreateMessageForm({ ticketId }: CreateMessageFormProps) {
  const router = useRouter();
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [error, setError] = useState<string | null>(null);
  const [isPending, setIsPending] = useState(false);
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

  async function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);
    setIsPending(true);

    const formData = new FormData(event.currentTarget);
    const body = (formData.get('body') as string)?.trim() ?? '';

    const result = await createMessageAction(ticketId, { body });

    if (result.error) {
      setError(result.error);
      setIsPending(false);
      return;
    }

    if (selectedFile) {
      try {
        const attachmentFormData = new FormData();
        attachmentFormData.append('file', selectedFile);

        const attachmentResponse = await fetch(`/api/messages/${result.success!.id}/attachments`, {
          method: 'POST',
          body: attachmentFormData,
        });

        if (!attachmentResponse.ok) {
          const data = await attachmentResponse.json();
          setError(`Pesan terkirim, tapi lampiran gagal: ${data.error ?? 'unknown'}`);
        }
      } catch {
        setError('Pesan terkirim, tapi lampiran gagal diunggah');
      }
    }

    setSelectedFile(null);
    if (fileInputRef.current) {
      fileInputRef.current.value = '';
    }

    setIsPending(false);
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
        <Label htmlFor="body">Reply</Label>
        <Textarea
          id="body"
          name="body"
          rows={4}
          maxLength={4000}
          required
          autoFocus
          placeholder="Tulis pesan kamu..."
        />
      </div>

      <div className="flex flex-col gap-2">
        <Label htmlFor="attachment">Lampiran (opsional)</Label>
        <input
          ref={fileInputRef}
          id="attachment"
          name="attachment"
          type="file"
          onChange={handleFileSelect}
          disabled={isPending}
          className="text-sm text-neutral-600 file:mr-3 file:rounded-md file:border file:border-neutral-300 file:bg-white file:px-3 file:py-1.5 file:text-sm file:font-medium file:text-neutral-700 hover:file:bg-neutral-50 dark:text-neutral-400 dark:file:border-neutral-700 dark:file:bg-neutral-900 dark:file:text-neutral-200 dark:hover:file:bg-neutral-800"
        />
        {selectedFile ? (
          <span className="text-xs text-neutral-500 dark:text-neutral-400">
            {selectedFile.name} ({Math.round(selectedFile.size / 1024)}KB)
          </span>
        ) : null}
      </div>

      <div className="flex items-center justify-end gap-3">
        <Button type="submit" disabled={isPending}>
          Send message
        </Button>
      </div>
    </form>
  );
}
