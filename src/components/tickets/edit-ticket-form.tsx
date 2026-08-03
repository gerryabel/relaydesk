'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { updateTicketAction, closeTicketAction } from '@/lib/tickets/actions';
import { type TicketWithCreator } from '@/lib/tickets/server';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Select } from '@/components/ui/select';

type EditTicketFormProps = {
  ticket: TicketWithCreator;
};

export default function EditTicketForm({ ticket }: EditTicketFormProps) {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const [isPending, setIsPending] = useState(false);

  async function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);
    setIsPending(true);

    const formData = new FormData(event.currentTarget);

    const title = (formData.get('title') as string)?.trim() ?? '';
    const description = (formData.get('description') as string)?.trim() || undefined;
    const priority = (formData.get('priority') as string) || undefined;
    const status = (formData.get('status') as string) || undefined;

    const result = await updateTicketAction(
      ticket.id,
      { title, description, priority, status } as import('@/lib/tickets/schema').UpdateTicketInput
    );

    setIsPending(false);

    if (result.error) {
      setError(result.error);
      return;
    }

    router.push(`/dashboard/tickets/${ticket.id}`);
  }

  async function handleClose() {
    const result = await closeTicketAction(ticket.id);
    if (!result.error) {
      router.push('/dashboard/tickets');
    } else {
      setError(result.error);
    }
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
        <Input id="title" name="title" required maxLength={255} defaultValue={ticket.title} autoFocus />
      </div>

      <div className="flex flex-col gap-2">
        <Label htmlFor="description">Description</Label>
        <Textarea id="description" name="description" rows={5} maxLength={65535} defaultValue={ticket.description ?? ''} />
      </div>

      <div className="grid grid-cols-1 gap-5 sm:grid-cols-2">
        <div className="flex flex-col gap-2">
          <Label htmlFor="priority">Priority</Label>
          <Select id="priority" name="priority" defaultValue={ticket.priority}>
            <option value="low">Low</option>
            <option value="medium">Medium</option>
            <option value="high">High</option>
            <option value="urgent">Urgent</option>
          </Select>
        </div>

        <div className="flex flex-col gap-2">
          <Label htmlFor="status">Status</Label>
          <Select id="status" name="status" defaultValue={ticket.status}>
            <option value="open">Open</option>
            <option value="in_progress">In Progress</option>
            <option value="resolved">Resolved</option>
            <option value="closed">Closed</option>
          </Select>
        </div>
      </div>

      <div className="flex flex-wrap items-center justify-between gap-3">
        <Button type="button" variant="secondary" onClick={() => router.back()} disabled={isPending}>
          Cancel
        </Button>
        <div className="flex gap-3">
          {ticket.status !== 'closed' ? (
            <Button type="button" variant="danger" onClick={handleClose} disabled={isPending}>
              Close ticket
            </Button>
          ) : null}
          <Button type="submit" disabled={isPending}>
            Save changes
          </Button>
        </div>
      </div>
    </form>
  );
}
