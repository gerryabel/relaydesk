import { Badge } from '@/components/ui/badge';

/**
 * Shared presentation for automation execution / action states.
 *
 * Server-safe (no 'use client') so it can be rendered from both the execution
 * history list and the execution detail view.
 */

type Tone = 'neutral' | 'blue' | 'amber' | 'emerald' | 'red';

const EXECUTION_STATUS_PRESENTATION: Record<string, { label: string; tone: Tone }> = {
  pending: { label: 'Pending', tone: 'neutral' },
  evaluating: { label: 'Evaluating', tone: 'blue' },
  awaiting_actions: { label: 'Awaiting actions', tone: 'blue' },
  executing: { label: 'Executing', tone: 'blue' },
  completed: { label: 'Completed', tone: 'emerald' },
  partial_failure: { label: 'Partial failure', tone: 'amber' },
  failed: { label: 'Failed', tone: 'red' },
  skipped: { label: 'Skipped', tone: 'neutral' },
};

const ACTION_STATUS_PRESENTATION: Record<string, { label: string; tone: Tone }> = {
  pending: { label: 'Pending', tone: 'neutral' },
  completed: { label: 'Completed', tone: 'emerald' },
  failed: { label: 'Failed', tone: 'red' },
  skipped: { label: 'Skipped', tone: 'neutral' },
};

function statusLabel(value: string): string {
  return value.replace(/_/g, ' ');
}

export function ExecutionStatusBadge({ status }: { status: string }) {
  const presentation = EXECUTION_STATUS_PRESENTATION[status] ?? {
    label: statusLabel(status),
    tone: 'neutral' as Tone,
  };

  return <Badge tone={presentation.tone}>{presentation.label}</Badge>;
}

export function ActionStatusBadge({ status }: { status: string }) {
  const presentation = ACTION_STATUS_PRESENTATION[status] ?? {
    label: statusLabel(status),
    tone: 'neutral' as Tone,
  };

  return <Badge tone={presentation.tone}>{presentation.label}</Badge>;
}

export function formatDateTime(value: string | null): string {
  if (!value) return '—';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '—';
  return date.toLocaleString('id-ID');
}

export function formatDuration(durationMs: number | null): string {
  if (durationMs === null) return '—';
  if (durationMs < 1000) return `${durationMs} ms`;
  if (durationMs < 60_000) return `${(durationMs / 1000).toFixed(1)} s`;
  const minutes = Math.floor(durationMs / 60_000);
  const seconds = Math.round((durationMs % 60_000) / 1000);
  return `${minutes}m ${seconds}s`;
}
