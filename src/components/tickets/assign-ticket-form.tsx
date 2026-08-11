'use client';

import { useState, useTransition } from 'react';
import { assignTicketAction, unassignTicketAction } from '@/lib/tickets/actions';
import type { TicketWithCreator } from '@/lib/tickets/server';
import { Button } from '@/components/ui/button';
import { Select } from '@/components/ui/select';
import { EmptyState } from '@/components/ui/empty-state';

type AssignTicketFormProps = {
  ticket: TicketWithCreator;
  members: Array<{ id: string; name: string; email: string }>;
};

export default function AssignTicketForm({ ticket, members }: AssignTicketFormProps) {
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();
  const [selectedAssigneeId, setSelectedAssigneeId] = useState<string>('');

  async function handleAssign(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);

    const assigneeId = selectedAssigneeId.trim();
    if (!assigneeId) {
      setError('Pilih member workspace untuk dijadikan assignee.');
      return;
    }

    startTransition(async () => {
      const result = await assignTicketAction(ticket.id, { assigneeId });

      if (result.error) {
        setError(result.error);
      }
    });
  }

  async function handleUnassign() {
    setError(null);
    startTransition(async () => {
      const result = await unassignTicketAction(ticket.id);

      if (result.error) {
        setError(result.error);
      }
    });
  }

  if (ticket.assignedTo) {
    return (
      <div className="rounded-lg border border-neutral-200 bg-white p-5 dark:border-neutral-800 dark:bg-neutral-900">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <p className="text-xs text-neutral-500 dark:text-neutral-400">Assignee</p>
            <p className="mt-1 text-sm font-medium text-neutral-900 dark:text-neutral-50">
              {ticket.assignedTo.name}
            </p>
            <p className="text-xs text-neutral-500 dark:text-neutral-400">{ticket.assignedTo.email}</p>
          </div>
          <Button variant="secondary" onClick={handleUnassign} disabled={isPending}>
            {isPending ? 'Memproses...' : 'Unassign'}
          </Button>
        </div>
        {error ? (
          <p className="mt-3 text-sm text-red-600 dark:text-red-400">{error}</p>
        ) : null}
      </div>
    );
  }

  return (
    <form onSubmit={handleAssign} className="flex flex-col gap-4">
      <div className="rounded-lg border border-neutral-200 bg-white p-5 dark:border-neutral-800 dark:bg-neutral-900">
        <p className="text-xs text-neutral-500 dark:text-neutral-400">Assignee</p>
        <p className="mt-1 text-sm font-medium text-neutral-900 dark:text-neutral-50">Belum diassign</p>
        <p className="mt-1 text-xs text-neutral-500 dark:text-neutral-400">
          Pilih member workspace untuk menangani tiket ini.
        </p>
      </div>

      {members.length === 0 ? (
        <EmptyState
          title="Belum ada member"
          description="Workspace ini belum memiliki member yang bisa dijadikan assignee."
        />
      ) : (
        <div className="flex flex-col gap-3 sm:flex-row sm:items-end">
          <div className="flex flex-1 flex-col gap-2">
            <label htmlFor="assigneeId" className="text-sm font-medium text-neutral-700 dark:text-neutral-200">
              Member
            </label>
            <Select
              id="assigneeId"
              value={selectedAssigneeId}
              onChange={(event) => setSelectedAssigneeId(event.target.value)}
              disabled={isPending}
            >
              <option value="">Pilih member...</option>
              {members.map((member) => (
                <option key={member.id} value={member.id}>
                  {member.name} ({member.email})
                </option>
              ))}
            </Select>
          </div>
          <Button type="submit" disabled={isPending || !selectedAssigneeId}>
            {isPending ? 'Memproses...' : 'Assign'}
          </Button>
        </div>
      )}

      {error ? (
        <div className="rounded-md border border-red-200 bg-red-50 p-3 text-sm text-red-700 dark:border-red-900/60 dark:bg-red-950/40 dark:text-red-300">
          {error}
        </div>
      ) : null}
    </form>
  );
}
