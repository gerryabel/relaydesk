import { describe, it, expect } from 'vitest';
import {
  validateConditionGroup,
  evaluateConditionGroup,
  conditionOperatorSchema,
} from '@/lib/automation/conditions';

describe('automation conditions', () => {
  describe('conditionOperatorSchema', () => {
    it('accepts valid operators', () => {
      const validOperators = ['equals', 'not_equals', 'includes', 'excludes', 'is_set', 'is_not_set'];
      for (const op of validOperators) {
        expect(conditionOperatorSchema.safeParse(op).success).toBe(true);
      }
    });

    it('rejects invalid operators', () => {
      expect(conditionOperatorSchema.safeParse('invalid').success).toBe(false);
      expect(conditionOperatorSchema.safeParse('').success).toBe(false);
      expect(conditionOperatorSchema.safeParse('contains').success).toBe(false);
    });
  });

  describe('validateConditionGroup', () => {
    it('returns valid for non-empty condition array', () => {
      const result = validateConditionGroup([
        { field: 'priority', operator: 'equals', value: 'high' },
      ]);
      expect(result.valid).toBe(true);
    });

    it('returns invalid for empty array', () => {
      const result = validateConditionGroup([]);
      expect(result.valid).toBe(false);
      expect(result.errors).toBeDefined();
    });

    it('returns invalid for non-array', () => {
      const result = validateConditionGroup('not an array' as unknown);
      expect(result.valid).toBe(false);
    });

    it('returns invalid for malformed conditions', () => {
      const result = validateConditionGroup([
        { field: '', operator: 'invalid' },
      ]);
      expect(result.valid).toBe(false);
    });
  });

  describe('evaluateConditionGroup', () => {
    it('equals operator matches equal values', () => {
      const group = {
        conditions: [{ field: 'status', operator: 'equals' as const, value: 'open' }],
      };
      expect(evaluateConditionGroup(group, { status: 'open' })).toBe(true);
      expect(evaluateConditionGroup(group, { status: 'closed' })).toBe(false);
    });

    it('not_equals operator matches different values', () => {
      const group = {
        conditions: [{ field: 'status', operator: 'not_equals' as const, value: 'open' }],
      };
      expect(evaluateConditionGroup(group, { status: 'closed' })).toBe(true);
      expect(evaluateConditionGroup(group, { status: 'open' })).toBe(false);
    });

    it('includes operator matches array containing value', () => {
      const group = {
        conditions: [{ field: 'tags', operator: 'includes' as const, value: 'urgent' }],
      };
      expect(evaluateConditionGroup(group, { tags: ['urgent', 'bug'] })).toBe(true);
      expect(evaluateConditionGroup(group, { tags: ['bug'] })).toBe(false);
    });

    it('includes operator matches substring', () => {
      const group = {
        conditions: [{ field: 'title', operator: 'includes' as const, value: 'bug' }],
      };
      expect(evaluateConditionGroup(group, { title: 'bug report' })).toBe(true);
      expect(evaluateConditionGroup(group, { title: 'feature request' })).toBe(false);
    });

    it('excludes operator matches array not containing value', () => {
      const group = {
        conditions: [{ field: 'tags', operator: 'excludes' as const, value: 'urgent' }],
      };
      expect(evaluateConditionGroup(group, { tags: ['bug'] })).toBe(true);
      expect(evaluateConditionGroup(group, { tags: ['urgent', 'bug'] })).toBe(false);
    });

    it('is_set operator matches non-null values', () => {
      const group = {
        conditions: [{ field: 'assignee', operator: 'is_set' as const }],
      };
      expect(evaluateConditionGroup(group, { assignee: 'user-1' })).toBe(true);
      expect(evaluateConditionGroup(group, { assignee: null })).toBe(false);
      expect(evaluateConditionGroup(group, { assignee: undefined })).toBe(false);
    });

    it('is_not_set operator matches null/undefined values', () => {
      const group = {
        conditions: [{ field: 'assignee', operator: 'is_not_set' as const }],
      };
      expect(evaluateConditionGroup(group, { assignee: null })).toBe(true);
      expect(evaluateConditionGroup(group, { assignee: undefined })).toBe(true);
      expect(evaluateConditionGroup(group, { assignee: 'user-1' })).toBe(false);
    });

    it('evaluates multiple conditions with AND semantics', () => {
      const group = {
        conditions: [
          { field: 'status', operator: 'equals' as const, value: 'open' },
          { field: 'priority', operator: 'equals' as const, value: 'high' },
        ],
      };
      expect(evaluateConditionGroup(group, { status: 'open', priority: 'high' })).toBe(true);
      expect(evaluateConditionGroup(group, { status: 'open', priority: 'low' })).toBe(false);
      expect(evaluateConditionGroup(group, { status: 'closed', priority: 'high' })).toBe(false);
    });

    it('handles missing field values as undefined', () => {
      const group = {
        conditions: [{ field: 'missing_field', operator: 'equals' as const, value: 'test' }],
      };
      expect(evaluateConditionGroup(group, {})).toBe(false);
    });
  });
});
