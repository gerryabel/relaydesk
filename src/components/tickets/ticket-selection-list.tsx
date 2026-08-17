'use client';

import { useMemo, useState } from 'react';
import BulkActionToolbar from '@/components/tickets/bulk-action-toolbar';
import TicketCard from '@/components/tickets/ticket-card';
import type { TicketWithCreator } from '@/lib/tickets/server';

type TicketSelectionListProps = {
  tickets: TicketWithCreator[];
  members: Array<{ id: string; name: string }>;
  tags: Array<{ id: string; name: string }>;
  searchParams: string;
  onApplied?: () => void;
};

export default function TicketSelectionList({ tickets, members, tags, searchParams, onApplied }: TicketSelectionListProps) {
  const [selectedIds, setSelectedIds] = useState<string[]>([]);

  const allVisibleIds = useMemo(() => tickets.map((ticket) => ticket.id), [tickets]);
  const selectedSet = useMemo(() => new Set(selectedIds), [selectedIds]);
  const allSelected = tickets.length > 0 && selectedIds.length === tickets.length;
  const someSelected = selectedIds.length > 0 && !allSelected;

  const toggleSelection = (ticketId: string, selected: boolean) => {
    setSelectedIds((prev) => {
      if (selected) {
        return prev.includes(ticketId) ? prev : [...prev, ticketId];
      }

      return prev.filter((id) => id !== ticketId);
    });
  };

  const toggleAllVisible = () => {
    if (allSelected) {
      setSelectedIds((prev) => prev.filter((id) => !allVisibleIds.includes(id)));
      return;
    }

    const merged = new Set(selectedIds);
    allVisibleIds.forEach((id) => merged.add(id));
    setSelectedIds(Array.from(merged));
  };

  const handleApplied = () => {
    setSelectedIds([]);
    onApplied?.();
  };

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <label className="flex items-center gap-2 text-sm text-neutral-900 dark:text-neutral-100">
          <input
            type="checkbox"
            checked={allSelected}
            ref={(element) => {
              if (element) {
                element.indeterminate = someSelected;
              }
            }}
            onChange={toggleAllVisible}
            aria-label="Pilih semua tiket di halaman ini"
          />
          Pilih halaman ini
        </label>
        {selectedIds.length > 0 ? (
          <span className="text-sm text-neutral-600 dark:text-neutral-300">{selectedIds.length} tiket terpilih</span>
        ) : null}
      </div>
      {selectedIds.length > 0 ? (
        <BulkActionToolbar selectedIds={selectedIds} members={members} tags={tags} onApplied={handleApplied} />
      ) : null}
      <div className="grid grid-cols-1 gap-4">
        {tickets.map((ticket) => (
          <TicketCard
            key={ticket.id}
            ticket={ticket}
            selected={selectedSet.has(ticket.id)}
            selectionName={`Pilih ${ticket.title}`}
            onSelectionChange={toggleSelection}
          />
        ))}
      </div>
    </div>
  );
}
