'use client';

import { useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { updateTicketAction } from '@/lib/tickets/actions';
import type { TicketWithCreator } from '@/lib/tickets/server';
import type { UpdateTicketInput } from '@/lib/tickets/schema';
import { getAllowedTransitions } from '@/lib/tickets/workflow';
import { Button } from '@/components/ui/button';

type TicketTransitionFormProps = {
  ticket: TicketWithCreator;
};

const TRANSITION_LABELS: Record<string, string> = {
  'in_progress': 'Resume Work',
  'waiting_customer': 'Waiting Customer',
  'resolved': 'Resolve',
  'closed': 'Close',
};

function resolveTransitionLabel(to: TicketWithCreator['status']) {
  return TRANSITION_LABELS[to] ?? to;
}

export default function TicketTransitionForm({ ticket }: TicketTransitionFormProps) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const transitions = getAllowedTransitions(ticket.status).map((status) => ({
    from: ticket.status,
    to: status,
    label: resolveTransitionLabel(status),
  }));

  function handleTransition(to: TicketWithCreator['status']) {
    startTransition(async () => {
      const result = await updateTicketAction(ticket.id, { status: to } as UpdateTicketInput);
      if (!result.error && result.success) {
        router.refresh();
      }
    });
  }

  return (
    <div className="flex flex-col gap-2">
      <div className="flex flex-wrap gap-2">
        {transitions.map((transition) => (
          <Button
            key={transition.to}
            type="button"
            variant="secondary"
            disabled={isPending}
            onClick={() => handleTransition(transition.to)}
          >
            {transition.label}
          </Button>
        ))}
      </div>
      {transitions.length === 0 ? (
        <p className="text-sm text-neutral-500 dark:text-neutral-400">No available transitions.</p>
      ) : null}
    </div>
  );
}
