import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock workspace/server before importing rules module
const mockMembership = {
  userId: 'user-1',
  workspaceId: 'workspace-1',
  role: 'owner' as const,
};

vi.mock('@/lib/workspace/server', () => ({
  getCurrentMembership: vi.fn(() => Promise.resolve(mockMembership)),
  assertWorkspaceOwner: vi.fn(() => Promise.resolve(mockMembership)),
}));

// Mock prisma client
const mockRule = {
  id: 'rule-1',
  workspaceId: 'workspace-1',
  name: 'Test Rule',
  description: null,
  enabled: true,
  priority: 0,
  triggerType: 'ticket.created',
  conditions: [{ field: 'priority', operator: 'equals', value: 'high' }],
  actions: [{ actionType: 'unassign', actionConfig: {} }],
  createdById: 'user-1',
  createdAt: new Date(),
  updatedAt: new Date(),
};

const prismaMock = {
  automationRule: {
    findMany: vi.fn(),
    findFirst: vi.fn(),
    findUnique: vi.fn(),
    count: vi.fn(),
    aggregate: vi.fn(),
    create: vi.fn(),
    update: vi.fn(),
    delete: vi.fn(),
  },
  $transaction: vi.fn(),
};

vi.mock('@/lib/db/prisma', () => ({
  prisma: prismaMock,
}));

describe('automation rules service', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('listRules', () => {
    it('returns rules ordered by priority, createdAt, id', async () => {
      prismaMock.automationRule.findMany = vi.fn().mockResolvedValue([mockRule]);
      const { listRules } = await import('@/lib/automation/rules');
      const result = await listRules();
      expect(result).toHaveLength(1);
      expect(prismaMock.automationRule.findMany).toHaveBeenCalledWith({
        where: { workspaceId: 'workspace-1' },
        orderBy: [{ priority: 'asc' }, { createdAt: 'asc' }, { id: 'asc' }],
      });
    });
  });

  describe('createRule', () => {
    it('creates a rule with auto-assigned priority', async () => {
      prismaMock.automationRule.count = vi.fn().mockResolvedValue(0);
      prismaMock.automationRule.aggregate = vi.fn().mockResolvedValue({ _max: { priority: 0 } });
      prismaMock.automationRule.create = vi.fn().mockResolvedValue(mockRule);
      prismaMock.$transaction = vi.fn(async (cb: (tx: typeof prismaMock) => unknown) => cb(prismaMock));
      const { createRule } = await import('@/lib/automation/rules');
      const result = await createRule({
        name: 'New Rule',
        triggerType: 'ticket.created',
        conditions: [{ field: 'priority', operator: 'equals', value: 'high' }],
        actions: [{ actionType: 'unassign', actionConfig: {} }],
      });
      expect(result.name).toBe('Test Rule');
      expect(prismaMock.automationRule.create).toHaveBeenCalled();
    });

    it('throws RuleValidationError for empty name', async () => {
      const { createRule, RuleValidationError } = await import('@/lib/automation/rules');
      await expect(
        createRule({
          name: '',
          triggerType: 'ticket.created',
          conditions: { conditions: [{ field: 'priority', operator: 'equals', value: 'high' }] },
          actions: [{ actionType: 'unassign', actionConfig: {} }],
        }),
      ).rejects.toBeInstanceOf(RuleValidationError);
    });
  });

  describe('deleteRule', () => {
    it('deletes the rule (hard delete, FK SetNull preserves executions)', async () => {
      prismaMock.automationRule.findFirst = vi.fn().mockResolvedValue({ id: 'rule-1' });
      prismaMock.automationRule.delete = vi.fn().mockResolvedValue(mockRule);
      const { deleteRule } = await import('@/lib/automation/rules');
      const result = await deleteRule('rule-1');
      expect(result.ok).toBe(true);
      expect(prismaMock.automationRule.delete).toHaveBeenCalledWith({ where: { id: 'rule-1' } });
    });

    it('throws RuleNotFoundError when rule not in workspace', async () => {
      prismaMock.automationRule.findFirst = vi.fn().mockResolvedValue(null);
      const { deleteRule, RuleNotFoundError } = await import('@/lib/automation/rules');
      await expect(deleteRule('unknown')).rejects.toBeInstanceOf(RuleNotFoundError);
    });
  });

  describe('setRuleEnabled', () => {
    it('updates the enabled flag', async () => {
      prismaMock.automationRule.findFirst = vi.fn().mockResolvedValue({ id: 'rule-1' });
      prismaMock.automationRule.update = vi.fn().mockResolvedValue(mockRule);
      const { setRuleEnabled } = await import('@/lib/automation/rules');
      await setRuleEnabled('rule-1', false);
      expect(prismaMock.automationRule.update).toHaveBeenCalledWith({
        where: { id: 'rule-1' },
        data: { enabled: false },
      });
    });
  });
});
