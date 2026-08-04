import { describe, it, expect } from 'vitest';
import { createTicketSchema, updateTicketSchema } from '@/lib/tickets/schema';

describe('create ticket validation', () => {
  it('rejects whitespace-only title', () => {
    expect(() =>
      createTicketSchema.parse({
        title: '   ',
        priority: 'medium',
      }),
    ).toThrow();
  });

  it('normalizes blank description to null', () => {
    const parsed = createTicketSchema.parse({
      title: 'Judul',
      description: '   ',
      priority: 'medium',
    });

    expect(parsed.description).toBeNull();
  });

  it('enforces title max length', () => {
    expect(() =>
      createTicketSchema.parse({
        title: 'a'.repeat(141),
        priority: 'medium',
      }),
    ).toThrow();
  });

  it('enforces description max length', () => {
    expect(() =>
      createTicketSchema.parse({
        title: 'Judul',
        description: 'a'.repeat(5001),
        priority: 'medium',
      }),
    ).toThrow();
  });
});

describe('update ticket validation', () => {
  it('rejects whitespace-only title when provided', () => {
    expect(() =>
      updateTicketSchema.parse({
        title: '   ',
      }),
    ).toThrow();
  });

  it('normalizes blank description to null', () => {
    const parsed = updateTicketSchema.parse({
      description: '   ',
    });

    expect(parsed.description).toBeNull();
  });
});
