export const AUTOMATION_TRIGGER_TYPES = {
  TICKET_CREATED: 'ticket.created',
  TICKET_ASSIGNED: 'ticket.assigned',
  TICKET_UNASSIGNED: 'ticket.unassigned',
  STATUS_CHANGED: 'ticket.status_changed',
  PRIORITY_CHANGED: 'ticket.priority_changed',
  TAG_ADDED: 'ticket.tag_added',
  TAG_REMOVED: 'ticket.tag_removed',
  CUSTOMER_LINKED: 'ticket.customer_linked',
  CUSTOMER_UNLINKED: 'ticket.customer_unlinked',
  SLA_AT_RISK: 'sla.at_risk',
  SLA_BREACHED: 'sla.breached',
} as const;

export type AutomationTriggerType = (typeof AUTOMATION_TRIGGER_TYPES)[keyof typeof AUTOMATION_TRIGGER_TYPES];

export interface AutomationContext {
  causedByAutomation: boolean;
  ruleId?: string | null;
  executionId?: string;
  actionIndex?: number;
  actorId: string | null;
}

export interface AutomationEvaluationPayload {
  triggerType: AutomationTriggerType;
  triggerPayload: Record<string, unknown>;
  automationContext: AutomationContext;
  workspaceId: string;
  ticketId: string;
  actorId: string | null;
}

export interface AutomationActionConfig {
  actionType: string;
  actionConfig: Record<string, unknown>;
}

export interface AutomationRuleConfig {
  id: string;
  workspaceId: string;
  name: string;
  enabled: boolean;
  triggerType: string;
  conditions: unknown[];
  actions: AutomationActionConfig[];
}

export interface AutomationExecutionRecord {
  id: string;
  workspaceId: string;
  ruleId: string;
  sourceEventType: string;
  sourceEventId: string;
  sourceAggregateId: string;
  ticketId: string | null;
  status: string;
  leasedBy: string | null;
  leasedAt: Date | null;
  evaluatedConditions: boolean;
  skipReason: string | null;
  error: string | null;
  startedAt: Date;
  completedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
}

export interface AutomationActionExecutionRecord {
  id: string;
  executionId: string;
  actionIndex: number;
  actionType: string;
  actionConfig: Record<string, unknown>;
  status: string;
  error: string | null;
  startedAt: Date | null;
  completedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
}
