'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { createCustomerReplyAction } from '@/lib/customer-portal/actions';
import { CUSTOMER_REPLY_BODY_MAX_LENGTH } from '@/lib/customer-portal/schema';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';

/**
 * Customer reply form (Phase 9 Task 3).
 *
 * One field, `body`, because that is the only thing a customer controls. The
 * action's schema is strict, so anything else this component tried to send —
 * a status, a customer id, an author — would be rejected server-side rather
 * than honoured.
 *
 * Notes on the interaction:
 *
 *  - Submitting does not navigate. The action revalidates the detail and list
 *    paths and the reply appears in place, so a customer who has scrolled
 *    back through a long conversation is not thrown to the top of the page.
 *  - The textarea is cleared only on success. A failed send keeps what was
 *    typed; losing a paragraph to a validation error is the kind of thing
 *    that makes people stop replying.
 *  - Submit stays disabled while a request is in flight so a double click
 *    cannot post the same message twice.
 */
export function CustomerReplyForm({
  workspaceSlug,
  ticketId,
}: {
  workspaceSlug: string;
  ticketId: string;
}) {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  async function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setPending(true);
    setError(null);

    // Captured before the await: `event.currentTarget` is not guaranteed to
    // still be the form once the action resolves.
    const form = event.currentTarget;
    const formData = new FormData(form);
    const body = (formData.get('body') as string | null)?.trim() ?? '';

    const result = await createCustomerReplyAction(workspaceSlug, ticketId, { body });

    if ('error' in result) {
      setError(result.error);
      setPending(false);
      return;
    }

    form.reset();
    setPending(false);
    router.refresh();
  }

  return (
    <form
      onSubmit={handleSubmit}
      aria-busy={pending}
      className="flex flex-col gap-3"
    >
      {error ? (
        <p
          role="alert"
          className="rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700 dark:border-red-900 dark:bg-red-950/40 dark:text-red-300"
        >
          {error}
        </p>
      ) : null}

      <div className="flex flex-col gap-2">
        <Label htmlFor="customer-reply-body">Add a reply</Label>
        <Textarea
          id="customer-reply-body"
          name="body"
          rows={5}
          required
          maxLength={CUSTOMER_REPLY_BODY_MAX_LENGTH}
          aria-describedby="customer-reply-help"
        />
        <p id="customer-reply-help" className="text-xs text-neutral-600 dark:text-neutral-300">
          Your reply is added to the conversation and emailed to us. Up to{' '}
          {CUSTOMER_REPLY_BODY_MAX_LENGTH} characters.
        </p>
      </div>

      <div>
        <Button type="submit" disabled={pending}>
          {pending ? 'Sending reply...' : 'Send reply'}
        </Button>
      </div>
    </form>
  );
}
