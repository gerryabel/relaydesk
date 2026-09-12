import { describe, it, expect } from 'vitest';
import { validateEmailMessage } from '@/lib/email/message';

describe('email message validation', () => {
  it('accepts a valid message', () => {
    expect(() =>
      validateEmailMessage({
        to: 'user@example.com',
        subject: 'Ticket assigned',
        text: 'You have been assigned.',
        html: '<p>You have been assigned.</p>',
      }),
    ).not.toThrow();
  });

  it('rejects invalid recipient', () => {
    expect(() =>
      validateEmailMessage({
        to: '',
        subject: 'Ticket assigned',
        text: 'Body',
      }),
    ).toThrow();
  });

  it('rejects overly long text', () => {
    expect(() =>
      validateEmailMessage({
        to: 'user@example.com',
        subject: 'Ticket assigned',
        text: 'a'.repeat(20001),
      }),
    ).toThrow();
  });
});
