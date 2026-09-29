'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { createCustomerTicketAction } from '@/lib/customer-portal/actions';
import {
  CUSTOMER_TICKET_DESCRIPTION_MAX_LENGTH,
  CUSTOMER_TICKET_TITLE_MAX_LENGTH,
} from '@/lib/customer-portal/schema';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';

/**
 * Customer "new ticket" form (Phase 9 Task 2).
 *
 * Exactly two fields, because exactly two are customer-controlled. There is
 * no customer, workspace, assignee, priority, status or SLA control anywhere
 * in this form, and the server would reject them if there were: the create
 * schema is strict and ownership comes from the customer session.
 */
export function CustomerNewTicketForm({ workspaceSlug }: { workspaceSlug: string }) {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  async function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setPending(true);
    setError(null);

    const formData = new FormData(event.currentTarget);
    const title = (formData.get('title') as string | null)?.trim() ?? '';
    const description = (formData.get('description') as string | null)?.trim() ?? '';

    const result = await createCustomerTicketAction(workspaceSlug, {
      title,
      description: description.length > 0 ? description : null,
    });

    if ('error' in result) {
      setError(result.error);
      setPending(false);
      return;
    }

    router.replace(`/portal/${workspaceSlug}/tickets/${result.ticket.id}`);
    router.refresh();
  }

  return (
    <form onSubmit={handleSubmit} className="flex flex-col gap-5">
      {error ? (
        <p
          role="alert"
          className="rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700 dark:border-red-900 dark:bg-red-950/40 dark:text-red-300"
        >
          {error}
        </p>
      ) : null}

      <div className="flex flex-col gap-2">
        <Label htmlFor="ticket-title">Subject</Label>
        <Input
          id="ticket-title"
          name="title"
          required
          maxLength={CUSTOMER_TICKET_TITLE_MAX_LENGTH}
          autoComplete="off"
        />
        <p className="text-xs text-neutral-600 dark:text-neutral-300">
          A short summary, up to {CUSTOMER_TICKET_TITLE_MAX_LENGTH} characters.
        </p>
      </div>

      <div className="flex flex-col gap-2">
        <Label htmlFor="ticket-description">What can we help with?</Label>
        <Textarea
          id="ticket-description"
          name="description"
          rows={8}
          maxLength={CUSTOMER_TICKET_DESCRIPTION_MAX_LENGTH}
        />
        <p className="text-xs text-neutral-600 dark:text-neutral-300">
          Include anything that helps us understand the problem, up to{' '}
          {CUSTOMER_TICKET_DESCRIPTION_MAX_LENGTH} characters.
        </p>
      </div>

      <div className="flex flex-wrap items-center gap-3">
        <Button type="submit" disabled={pending}>
          {pending ? 'Creating ticket...' : 'Create ticket'}
        </Button>
        <Button
          type="button"
          variant="secondary"
          onClick={() => router.push(`/portal/${workspaceSlug}/tickets`)}
        >
          Cancel
        </Button>
      </div>
    </form>
  );
}
