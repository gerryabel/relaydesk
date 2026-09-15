import { describe, it, expect } from 'vitest';
import { workspaceNameSchema } from '@/lib/workspace/settings';

describe('workspaceNameSchema validation', () => {
  it('accepts a valid workspace name', () => {
    const parsed = workspaceNameSchema.parse({ name: 'RelayDesk' });
    expect(parsed).toEqual({ name: 'RelayDesk' });
  });

  it('trims leading and trailing whitespace', () => {
    const parsed = workspaceNameSchema.parse({ name: '  RelayDesk  ' });
    expect(parsed).toEqual({ name: 'RelayDesk' });
  });

  it('trims whitespace from names with internal spaces preserved', () => {
    const parsed = workspaceNameSchema.parse({ name: '  My Workspace  ' });
    expect(parsed).toEqual({ name: 'My Workspace' });
  });

  it('rejects whitespace-only input', () => {
    expect(() => workspaceNameSchema.parse({ name: '     ' })).toThrow(
      'Workspace name cannot be empty',
    );
  });

  it('rejects empty input', () => {
    expect(() => workspaceNameSchema.parse({ name: '' })).toThrow(
      'Workspace name cannot be empty',
    );
  });

  it('rejects over-100-character input', () => {
    const tooLong = 'a'.repeat(101);

    expect(() => workspaceNameSchema.parse({ name: tooLong })).toThrow(
      'Workspace name cannot exceed 100 characters',
    );
  });

  it('accepts a name exactly at 100 characters', () => {
    const parsed = workspaceNameSchema.parse({ name: 'a'.repeat(100) });
    expect(parsed).toEqual({ name: 'a'.repeat(100) });
  });

  it('rejects non-string input', () => {
    expect(() => workspaceNameSchema.parse({ name: 123 })).toThrow(
      'Workspace name is required',
    );
  });

  it('rejects missing name', () => {
    expect(() => workspaceNameSchema.parse({})).toThrow();
  });
});
