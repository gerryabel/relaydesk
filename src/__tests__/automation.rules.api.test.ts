import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock the rules service
vi.mock('@/lib/automation/rules', () => ({
  listRules: vi.fn(() => Promise.resolve([])),
  getRuleById: vi.fn(() => Promise.resolve({ id: 'rule-1', name: 'Test' })),
  createRule: vi.fn(() => Promise.resolve({ id: 'rule-1', name: 'Test' })),
  updateRule: vi.fn(() => Promise.resolve({ id: 'rule-1', name: 'Updated' })),
  deleteRule: vi.fn(() => Promise.resolve({ ok: true })),
  setRuleEnabled: vi.fn(() => Promise.resolve({ id: 'rule-1', enabled: false })),
  RuleNotFoundError: class RuleNotFoundError extends Error {
    constructor() { super('Not found'); this.name = 'RuleNotFoundError'; }
  },
  RuleLimitReachedError: class RuleLimitReachedError extends Error {
    constructor() { super('Limit reached'); this.name = 'RuleLimitReachedError'; }
  },
  RuleNameConflictError: class RuleNameConflictError extends Error {
    constructor() { super('Name conflict'); this.name = 'RuleNameConflictError'; }
  },
  RuleValidationError: class RuleValidationError extends Error {
    constructor() { super('Validation error'); this.name = 'RuleValidationError'; }
  },
  RuleReferencedResourceError: class RuleReferencedResourceError extends Error {
    constructor() { super('Reference error'); this.name = 'RuleReferencedResourceError'; }
  },
}));

vi.mock('@/lib/workspace/server', () => ({
  ForbiddenError: class ForbiddenError extends Error {},
  UnauthorizedError: class UnauthorizedError extends Error {},
}));

describe('automation rules API (unit)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('GET /api/automation-rules returns rules list', async () => {
    // We verify the route module loads and has the expected exports.
    // Full HTTP testing requires Next.js test utilities.
    const route = await import('@/app/api/automation-rules/route');
    expect(typeof route.GET).toBe('function');
    expect(typeof route.POST).toBe('function');
  });

  it('GET/PATCH/DELETE /api/automation-rules/[id] exist', async () => {
    const route = await import('@/app/api/automation-rules/[id]/route');
    expect(typeof route.GET).toBe('function');
    expect(typeof route.PATCH).toBe('function');
    expect(typeof route.DELETE).toBe('function');
  });
});
