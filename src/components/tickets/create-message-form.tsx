'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { createMessageAction } from '@/lib/messages/actions';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';

type CreateMessageFormProps = {
  ticketId: string;
};

export default function CreateMessageForm({ ticketId }: CreateMessageFormProps) {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const [isPending, setIsPending] = useState(false);

  async function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);
    setIsPending(true);

    const formData = new FormData(event.currentTarget);
    const body = (formData.get('body') as string)?.trim() ?? '';

    const result = await createMessageAction(ticketId, { body });

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

      <div className="flex items-center justify-end gap-3">
        <Button type="submit" disabled={isPending}>
          Send message
        </Button>
      </div>
    </form>
  );
}
