import { describe, it, expect } from 'vitest';
import { automationEvaluationPayloadSchema } from '@/lib/automation/events';

describe('automation events schema', () => {
  it('validates a correct AUTOMATION_EVALUATION payload', () => {
    const payload = {
      triggerType: 'ticket.created',
      triggerPayload: { ticketId: 'ticket-1' },
      automationContext: {
        causedByAutomation: false,
        actorId: 'user-1',
      },
      workspaceId: 'workspace-1',
      ticketId: 'ticket-1',
      actorId: 'user-1',
    };

    const result = automationEvaluationPayloadSchema.safeParse(payload);
    expect(result.success).toBe(true);
  });

  it('rejects payload missing triggerType', () => {
    const payload = {
      triggerPayload: {},
      automationContext: { causedByAutomation: false, actorId: null },
      workspaceId: 'workspace-1',
      ticketId: 'ticket-1',
      actorId: null,
    };

    const result = automationEvaluationPayloadSchema.safeParse(payload);
    expect(result.success).toBe(false);
  });

  it('rejects payload missing workspaceId', () => {
    const payload = {
      triggerType: 'ticket.created',
      triggerPayload: {},
      automationContext: { causedByAutomation: false, actorId: null },
      ticketId: 'ticket-1',
      actorId: null,
    };

    const result = automationEvaluationPayloadSchema.safeParse(payload);
    expect(result.success).toBe(false);
  });

  it('accepts optional automationContext fields', () => {
    const payload = {
      triggerType: 'ticket.assigned',
      triggerPayload: {},
      automationContext: {
        causedByAutomation: true,
        ruleId: 'rule-1',
        executionId: 'exec-1',
        actionIndex: 0,
        actorId: null,
      },
      workspaceId: 'workspace-1',
      ticketId: 'ticket-1',
      actorId: null,
    };

    const result = automationEvaluationPayloadSchema.safeParse(payload);
    expect(result.success).toBe(true);
  });

  it('rejects non-boolean causedByAutomation', () => {
    const payload = {
      triggerType: 'ticket.created',
      triggerPayload: {},
      automationContext: {
        causedByAutomation: 'false',
        actorId: null,
      },
      workspaceId: 'workspace-1',
      ticketId: 'ticket-1',
      actorId: null,
    };

    const result = automationEvaluationPayloadSchema.safeParse(payload);
    expect(result.success).toBe(false);
  });
});
