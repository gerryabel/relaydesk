import { describe, it, expect } from 'vitest';
import { getAllowedTransitions, assertTransitionAllowed, InvalidTicketTransitionError, type TicketStatus } from '@/lib/tickets/workflow';

describe('ticket workflow', () => {
  describe('getAllowedTransitions', () => {
    it('returns allowed transitions for open', () => {
      expect(getAllowedTransitions('open')).toEqual(['in_progress']);
    });

    it('returns allowed transitions for in_progress', () => {
      expect(getAllowedTransitions('in_progress')).toEqual(['waiting_customer', 'resolved']);
    });

    it('returns allowed transitions for waiting_customer', () => {
      expect(getAllowedTransitions('waiting_customer')).toEqual(['in_progress', 'resolved']);
    });

    it('returns allowed transitions for resolved', () => {
      expect(getAllowedTransitions('resolved')).toEqual(['in_progress', 'closed']);
    });

    it('returns empty transitions for closed', () => {
      expect(getAllowedTransitions('closed')).toEqual([]);
    });
  });

  describe('assertTransitionAllowed', () => {
    const validCases: Array<[TicketStatus, TicketStatus]> = [
      ['open', 'in_progress'],
      ['in_progress', 'waiting_customer'],
      ['in_progress', 'resolved'],
      ['waiting_customer', 'in_progress'],
      ['waiting_customer', 'resolved'],
      ['resolved', 'in_progress'],
      ['resolved', 'closed'],
    ];

    const invalidCases: Array<[TicketStatus, TicketStatus]> = [
      ['open', 'waiting_customer'],
      ['open', 'resolved'],
      ['open', 'closed'],
      ['in_progress', 'closed'],
      ['waiting_customer', 'closed'],
      ['resolved', 'waiting_customer'],
      ['closed', 'in_progress'],
      ['closed', 'waiting_customer'],
      ['closed', 'resolved'],
      ['closed', 'closed'],
      ['open', 'open'],
    ];

    it.each(validCases)('allows transition from %s to %s', (current, next) => {
      expect(() => assertTransitionAllowed(current, next)).not.toThrow();
    });

    it.each(invalidCases)('rejects transition from %s to %s', (current, next) => {
      expect(() => assertTransitionAllowed(current, next)).toThrow(InvalidTicketTransitionError);
    });

    it('throws InvalidTicketTransitionError with current and requested status', () => {
      try {
        assertTransitionAllowed('resolved', 'waiting_customer');
      } catch (error) {
        expect(error).toBeInstanceOf(InvalidTicketTransitionError);
        expect((error as InvalidTicketTransitionError).message).toContain('resolved');
        expect((error as InvalidTicketTransitionError).requested).toBe('waiting_customer');
      }
    });
  });
});
