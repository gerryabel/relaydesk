'use client';

import { useCallback, useMemo, useState } from 'react';
import type { BulkUpdateResult } from '@/lib/tickets/bulk';

const BULK_ACTIONS = [
  { label: 'Assign', action: 'assign' },
  { label: 'Status', action: 'status' },
  { label: 'Priority', action: 'priority' },
  { label: 'Add tag', action: 'add_tag' },
  { label: 'Remove tag', action: 'remove_tag' },
] as const;

const STATUS_OPTIONS = [
  { value: 'open', label: 'Open' },
  { value: 'in_progress', label: 'In Progress' },
  { value: 'waiting_customer', label: 'Waiting Customer' },
  { value: 'resolved', label: 'Resolved' },
  { value: 'closed', label: 'Closed' },
] as const;

const PRIORITY_OPTIONS = [
  { value: 'low', label: 'Low' },
  { value: 'medium', label: 'Medium' },
  { value: 'high', label: 'High' },
  { value: 'urgent', label: 'Urgent' },
] as const;

type BulkAction = (typeof BULK_ACTIONS)[number]['action'];

type BulkActionToolbarProps = {
  selectedIds: string[];
  members: Array<{ id: string; name: string }>;
  tags: Array<{ id: string; name: string }>;
  onApplied?: (result?: BulkUpdateResult) => void;
};

export default function BulkActionToolbar({ selectedIds, members, tags, onApplied }: BulkActionToolbarProps) {
  const [isPending, setIsPending] = useState(false);
  const [action, setAction] = useState<BulkAction | ''>('');
  const [status, setStatus] = useState('');
  const [priority, setPriority] = useState('');
  const [assigneeId, setAssigneeId] = useState('');
  const [tagId, setTagId] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [feedback, setFeedback] = useState<string | null>(null);

  const count = selectedIds.length;

  const resetValueState = useCallback((nextAction: BulkAction | '') => {
    setStatus('');
    setPriority('');
    setAssigneeId('');
    setTagId('');
    setError(null);
    setFeedback(null);
    setAction(nextAction);
  }, []);

  const handleApply = async () => {
    setError(null);
    setFeedback(null);

    if (!action || count === 0) {
      return;
    }

    const needsConfirmation = action === 'assign' || action === 'status';
    if (needsConfirmation && !confirm(`Terapkan aksi "${action}" ke ${count} tiket?`)) {
      return;
    }

    let value: unknown = undefined;

    if (action === 'assign') {
      if (!assigneeId) {
        setError('Pilih assignee terlebih dahulu.');
        return;
      }

      value = { assigneeId };
    } else if (action === 'status') {
      if (!status) {
        setError('Pilih status terlebih dahulu.');
        return;
      }

      value = { status };
    } else if (action === 'priority') {
      if (!priority) {
        setError('Pilih prioritas terlebih dahulu.');
        return;
      }

      value = { priority };
    } else if (action === 'add_tag' || action === 'remove_tag') {
      if (!tagId) {
        setError('Pilih tag terlebih dahulu.');
        return;
      }

      value = { tagId };
    }

    setIsPending(true);
    try {
      const response = await fetch('/api/tickets/bulk', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ticketIds: selectedIds, action, value }),
      });

      if (!response.ok) {
        const body = await response.json().catch(() => ({ error: 'Aksi gagal diterapkan.' }));
        throw new Error(body?.error ?? 'Aksi gagal diterapkan.');
      }

      const result = (await response.json()) as BulkUpdateResult;
      setFeedback(`Berhasil memperbarui ${result.updatedCount} tiket.`);
      onApplied?.(result);
    } catch (submitted) {
      const message = submitted instanceof Error ? submitted.message : 'Aksi gagal diterapkan.';
      setError(message);
      onApplied?.();
    } finally {
      setIsPending(false);
    }
  };

  const valueControl = useMemo(() => {
    if (action === 'assign') {
      return (
        <label className="flex flex-col gap-1 text-xs text-neutral-600 dark:text-neutral-300">
          <span className="sr-only">Assignee</span>
          <select
            value={assigneeId}
            onChange={(event) => setAssigneeId(event.target.value)}
            disabled={isPending}
            className="rounded-md border border-neutral-300 bg-white px-2 py-1.5 text-sm focus:border-neutral-900 focus:outline-none disabled:opacity-60 dark:border-neutral-700 dark:bg-neutral-900 dark:focus:border-neutral-100"
          >
            <option value="">Pilih assignee</option>
            {members.map((member) => (
              <option key={member.id} value={member.id}>
                {member.name}
              </option>
            ))}
          </select>
        </label>
      );
    }

    if (action === 'status') {
      return (
        <label className="flex flex-col gap-1 text-xs text-neutral-600 dark:text-neutral-300">
          <span className="sr-only">Status</span>
          <select
            value={status}
            onChange={(event) => setStatus(event.target.value)}
            disabled={isPending}
            className="rounded-md border border-neutral-300 bg-white px-2 py-1.5 text-sm focus:border-neutral-900 focus:outline-none disabled:opacity-60 dark:border-neutral-700 dark:bg-neutral-900 dark:focus:border-neutral-100"
          >
            <option value="">Pilih status</option>
            {STATUS_OPTIONS.map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </select>
        </label>
      );
    }

    if (action === 'priority') {
      return (
        <label className="flex flex-col gap-1 text-xs text-neutral-600 dark:text-neutral-300">
          <span className="sr-only">Priority</span>
          <select
            value={priority}
            onChange={(event) => setPriority(event.target.value)}
            disabled={isPending}
            className="rounded-md border border-neutral-300 bg-white px-2 py-1.5 text-sm focus:border-neutral-900 focus:outline-none disabled:opacity-60 dark:border-neutral-700 dark:bg-neutral-900 dark:focus:border-neutral-100"
          >
            <option value="">Pilih prioritas</option>
            {PRIORITY_OPTIONS.map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </select>
        </label>
      );
    }

    if (action === 'add_tag' || action === 'remove_tag') {
      return (
        <label className="flex flex-col gap-1 text-xs text-neutral-600 dark:text-neutral-300">
          <span className="sr-only">Tag</span>
          <select
            value={tagId}
            onChange={(event) => setTagId(event.target.value)}
            disabled={isPending}
            className="rounded-md border border-neutral-300 bg-white px-2 py-1.5 text-sm focus:border-neutral-900 focus:outline-none disabled:opacity-60 dark:border-neutral-700 dark:bg-neutral-900 dark:focus:border-neutral-100"
          >
            <option value="">Pilih tag</option>
            {tags.map((tag) => (
              <option key={tag.id} value={tag.id}>
                {tag.name}
              </option>
            ))}
          </select>
        </label>
      );
    }

    return null;
  }, [action, assigneeId, members, priority, status, tagId, tags, isPending]);

  return (
    <div className="rounded-md border border-neutral-300 bg-white p-3 dark:border-neutral-700 dark:bg-neutral-900" aria-live="polite">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <span className="text-sm font-medium text-neutral-900 dark:text-neutral-100">{count} tiket terpilih</span>
        <div className="flex flex-wrap items-center gap-2">
          <select
            value={action}
            onChange={(event) => resetValueState(event.target.value as BulkAction | '')}
            disabled={isPending}
            aria-label="Bulk action"
            className="rounded-md border border-neutral-300 bg-white px-2 py-1.5 text-sm focus:border-neutral-900 focus:outline-none disabled:opacity-60 dark:border-neutral-700 dark:bg-neutral-900 dark:focus:border-neutral-100"
          >
            <option value="">Aksi</option>
            {BULK_ACTIONS.map((option) => (
              <option key={option.action} value={option.action}>
                {option.label}
              </option>
            ))}
          </select>
          {valueControl}
          <button
            type="button"
            disabled={isPending || !action}
            onClick={handleApply}
            className="inline-flex items-center justify-center rounded-md bg-neutral-900 px-3 py-1.5 text-sm text-white hover:bg-neutral-800 disabled:opacity-60 dark:bg-neutral-100 dark:text-neutral-900 dark:hover:bg-neutral-200"
          >
            {isPending ? 'Menerapkan...' : 'Terapkan'}
          </button>
        </div>
      </div>
      {error ? (
        <p className="mt-2 text-xs text-red-600 dark:text-red-300" role="alert">
          {error}
        </p>
      ) : null}
      {feedback ? (
        <p className="mt-2 text-xs text-emerald-600 dark:text-emerald-300" role="status">
          {feedback}
        </p>
      ) : null}
    </div>
  );
}
