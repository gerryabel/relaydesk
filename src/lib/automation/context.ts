export interface AutomationContext {
  causedByAutomation: boolean;
  ruleId?: string | null;
  executionId?: string;
  actionIndex?: number;
  actorId: string | null;
}

export function createAutomationContext(
  overrides: Partial<AutomationContext> = {},
): AutomationContext {
  return {
    causedByAutomation: false,
    actorId: null,
    ...overrides,
  };
}
