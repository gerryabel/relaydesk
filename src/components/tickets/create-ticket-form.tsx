'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { createTicketAction } from '@/lib/tickets/actions';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Select } from '@/components/ui/select';

export default function CreateTicketForm() {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);

  async function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const formData = new FormData(event.currentTarget);

    const result = await createTicketAction({
      title: (formData.get('title') as string)?.trim() ?? '',
      description: (formData.get('description') as string)?.trim() || undefined,
      priority: (formData.get('priority') as string) || 'medium',
    } as import('@/lib/tickets/schema').CreateTicketInput);

    if (result.error) {
      setError(result.error);
      return;
    }

    router.push('/dashboard/tickets');
  }

  return (
    <form onSubmit={handleSubmit} className="flex flex-col gap-5">
      {error ? (
        <div className="rounded-md border border-red-200 bg-red-50 p-3 text-sm text-red-700 dark:border-red-900/60 dark:bg-red-950/40 dark:text-red-300">
          {error}
        </div>
      ) : null}

      <div className="flex flex-col gap-2">
        <Label htmlFor="title">Title</Label>
        <Input id="title" name="title" required maxLength={255} autoFocus />
      </div>

      <div className="flex flex-col gap-2">
        <Label htmlFor="description">Description</Label>
        <Textarea id="description" name="description" rows={5} maxLength={65535} />
      </div>

      <div className="flex flex-col gap-2">
        <Label htmlFor="priority">Priority</Label>
        <Select id="priority" name="priority" defaultValue="medium">
          <option value="low">Low</option>
          <option value="medium">Medium</option>
          <option value="high">High</option>
          <option value="urgent">Urgent</option>
        </Select>
      </div>

      <div className="flex items-center justify-end gap-3">
        <Button type="button" variant="secondary" onClick={() => router.back()}>
          Cancel
        </Button>
        <Button type="submit">
          Create ticket
        </Button>
      </div>
    </form>
  );
}
