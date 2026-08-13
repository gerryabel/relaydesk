import { describe, it, expect } from 'vitest';
import {
  createCustomerSchema,
  updateCustomerSchema,
} from '@/lib/customers/schema';

describe('create customer validation', () => {
  it('rejects empty name', () => {
    expect(() => createCustomerSchema.parse({ name: '   ' })).toThrow();
  });

  it('trims and accepts valid customer payload', () => {
    const parsed = createCustomerSchema.parse({
      name: ' Customer ',
      email: ' customer@example.com ',
      phone: ' 081234 ',
      notes: ' catatan ',
    });

    expect(parsed).toEqual({
      name: 'Customer',
      email: 'customer@example.com',
      phone: '081234',
      notes: 'catatan',
    });
  });

  it('normalizes blank optional fields to null', () => {
    const parsed = createCustomerSchema.parse({ name: 'Customer', email: '   ', phone: '', notes: '   ' });

    expect(parsed.email).toBeNull();
    expect(parsed.phone).toBeNull();
    expect(parsed.notes).toBeNull();
  });
});

describe('update customer validation', () => {
  it('rejects empty name when provided', () => {
    expect(() => updateCustomerSchema.parse({ name: '   ' })).toThrow();
  });

  it('allows partial update without name', () => {
    const parsed = updateCustomerSchema.parse({ email: 'baru@example.com' });

    expect(parsed).toEqual({ email: 'baru@example.com' });
  });

  it('normalizes blank optional fields to null', () => {
    const parsed = updateCustomerSchema.parse({ email: '   ', notes: '' });

    expect(parsed.email).toBeNull();
    expect(parsed.notes).toBeNull();
  });
});
