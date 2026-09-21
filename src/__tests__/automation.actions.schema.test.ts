import { describe, it, expect } from 'vitest';
import {
  validateActionConfig,
  assignActionSchema,
  unassignActionSchema,
  setStatusActionSchema,
  setPriorityActionSchema,
  addTagActionSchema,
  removeTagActionSchema,
  internalNoteActionSchema,
  notificationActionSchema,
  AUTOMATION_ACTION_TYPES,
} from '@/lib/automation/actions/schema';

describe('automation action schemas', () => {
  describe('assignActionSchema', () => {
    it('accepts valid assign config', () => {
      const result = assignActionSchema.safeParse({ assigneeId: 'user-1' });
      expect(result.success).toBe(true);
    });

    it('rejects missing assigneeId', () => {
      const result = assignActionSchema.safeParse({});
      expect(result.success).toBe(false);
    });

    it('rejects empty assigneeId', () => {
      const result = assignActionSchema.safeParse({ assigneeId: '' });
      expect(result.success).toBe(false);
    });
  });

  describe('unassignActionSchema', () => {
    it('accepts empty config', () => {
      const result = unassignActionSchema.safeParse({});
      expect(result.success).toBe(true);
    });
  });

  describe('setStatusActionSchema', () => {
    it.each(['open', 'in_progress', 'waiting_customer', 'resolved', 'closed'] as const)(
      'accepts status %s',
      (status) => {
        const result = setStatusActionSchema.safeParse({ status });
        expect(result.success).toBe(true);
      },
    );

    it('rejects invalid status', () => {
      const result = setStatusActionSchema.safeParse({ status: 'invalid' });
      expect(result.success).toBe(false);
    });

    it('rejects missing status', () => {
      const result = setStatusActionSchema.safeParse({});
      expect(result.success).toBe(false);
    });
  });

  describe('setPriorityActionSchema', () => {
    it.each(['low', 'medium', 'high', 'urgent'] as const)(
      'accepts priority %s',
      (priority) => {
        const result = setPriorityActionSchema.safeParse({ priority });
        expect(result.success).toBe(true);
      },
    );

    it('rejects invalid priority', () => {
      const result = setPriorityActionSchema.safeParse({ priority: 'critical' });
      expect(result.success).toBe(false);
    });
  });

  describe('addTagActionSchema', () => {
    it('accepts valid tag id', () => {
      const result = addTagActionSchema.safeParse({ tagId: 'tag-1' });
      expect(result.success).toBe(true);
    });

    it('rejects missing tagId', () => {
      const result = addTagActionSchema.safeParse({});
      expect(result.success).toBe(false);
    });
  });

  describe('removeTagActionSchema', () => {
    it('accepts valid tag id', () => {
      const result = removeTagActionSchema.safeParse({ tagId: 'tag-1' });
      expect(result.success).toBe(true);
    });

    it('rejects missing tagId', () => {
      const result = removeTagActionSchema.safeParse({});
      expect(result.success).toBe(false);
    });
  });

  describe('internalNoteActionSchema', () => {
    it('accepts valid note config with authorId', () => {
      const result = internalNoteActionSchema.safeParse({ body: 'Hello world', authorId: 'user-1' });
      expect(result.success).toBe(true);
    });

    it('rejects when authorId is missing', () => {
      const result = internalNoteActionSchema.safeParse({ body: 'Hello' });
      expect(result.success).toBe(false);
    });

    it('rejects empty body', () => {
      const result = internalNoteActionSchema.safeParse({ body: '' });
      expect(result.success).toBe(false);
    });

    it('rejects missing body', () => {
      const result = internalNoteActionSchema.safeParse({});
      expect(result.success).toBe(false);
    });

    it('rejects body exceeding 10000 chars', () => {
      const result = internalNoteActionSchema.safeParse({ body: 'a'.repeat(10_001) });
      expect(result.success).toBe(false);
    });
  });

  describe('notificationActionSchema', () => {
    it('accepts valid notification config', () => {
      const result = notificationActionSchema.safeParse({
        recipientId: 'user-1',
        title: 'Hello',
        body: 'World',
      });
      expect(result.success).toBe(true);
    });

    it('rejects missing recipientId', () => {
      const result = notificationActionSchema.safeParse({ title: 'Hi', body: 'World' });
      expect(result.success).toBe(false);
    });

    it('rejects missing title', () => {
      const result = notificationActionSchema.safeParse({ recipientId: 'u', body: 'World' });
      expect(result.success).toBe(false);
    });

    it('rejects missing body', () => {
      const result = notificationActionSchema.safeParse({ recipientId: 'u', title: 'Hi' });
      expect(result.success).toBe(false);
    });

    it('rejects title exceeding 200 chars', () => {
      const result = notificationActionSchema.safeParse({
        recipientId: 'u',
        title: 'a'.repeat(201),
        body: 'World',
      });
      expect(result.success).toBe(false);
    });

    it('rejects body exceeding 2000 chars', () => {
      const result = notificationActionSchema.safeParse({
        recipientId: 'u',
        title: 'Hi',
        body: 'a'.repeat(2001),
      });
      expect(result.success).toBe(false);
    });
  });
});

describe('validateActionConfig', () => {
  it('returns valid for known action types with valid config', () => {
    expect(validateActionConfig('assign', { assigneeId: 'user-1' })).toEqual({ valid: true });
    expect(validateActionConfig('unassign', {})).toEqual({ valid: true });
    expect(validateActionConfig('set-status', { status: 'open' })).toEqual({ valid: true });
    expect(validateActionConfig('set-priority', { priority: 'high' })).toEqual({ valid: true });
    expect(validateActionConfig('add-tag', { tagId: 'tag-1' })).toEqual({ valid: true });
    expect(validateActionConfig('remove-tag', { tagId: 'tag-1' })).toEqual({ valid: true });
    expect(validateActionConfig('internal-note', { body: 'Hello', authorId: 'user-1' })).toEqual({ valid: true });
    expect(validateActionConfig('notification', { recipientId: 'u', title: 'T', body: 'B' })).toEqual({ valid: true });
  });

  it('returns invalid for unknown action type', () => {
    const result = validateActionConfig('unknown-action', {});
    expect(result.valid).toBe(false);
    if (!result.valid) {
      expect(result.error).toContain('Unknown action type');
    }
  });

  it('returns invalid with error message for invalid config', () => {
    const result = validateActionConfig('assign', {});
    expect(result.valid).toBe(false);
    if (!result.valid) {
      expect(result.error).toContain('assigneeId');
    }
  });
});

describe('AUTOMATION_ACTION_TYPES', () => {
  it('contains all 8 required action types', () => {
    const types = Object.values(AUTOMATION_ACTION_TYPES);
    expect(types).toHaveLength(8);
    expect(types).toContain('assign');
    expect(types).toContain('unassign');
    expect(types).toContain('set-status');
    expect(types).toContain('set-priority');
    expect(types).toContain('add-tag');
    expect(types).toContain('remove-tag');
    expect(types).toContain('internal-note');
    expect(types).toContain('notification');
  });
});
