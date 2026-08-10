export type TicketStatus = 'open' | 'in_progress' | 'waiting_customer' | 'resolved' | 'closed';

export const TICKET_STATUS_TRANSITIONS: Record<TicketStatus, TicketStatus[]> = {
  open: ['in_progress'],
  in_progress: ['waiting_customer', 'resolved'],
  waiting_customer: ['in_progress', 'resolved'],
  resolved: ['in_progress', 'closed'],
  closed: [],
};

export function getAllowedTransitions(status: TicketStatus): TicketStatus[] {
  return TICKET_STATUS_TRANSITIONS[status] ?? [];
}

export function assertTransitionAllowed(current: TicketStatus, next: TicketStatus): void {
  if (current === next) {
    throw new InvalidTicketTransitionError({
      current,
      requested: next,
      message: `Same-status transition is not allowed: ${current}`,
    });
  }

  const allowed = getAllowedTransitions(current);

  if (!allowed.includes(next)) {
    throw new InvalidTicketTransitionError({
      current,
      requested: next,
      message: `Invalid status transition from ${current} to ${next}`,
    });
  }
}

export class InvalidTicketTransitionError extends Error {
  current: TicketStatus;
  requested: TicketStatus;

  constructor({ current, requested, message }: { current: TicketStatus; requested: TicketStatus; message?: string }) {
    super(message ?? `Invalid ticket transition from ${current} to ${requested}`);
    this.name = 'InvalidTicketTransitionError';
    this.current = current;
    this.requested = requested;
  }
}
