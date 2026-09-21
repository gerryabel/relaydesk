import type { AutomationTriggerType } from './types';

/**
 * Condition field type taxonomy.
 *
 * Each field exposed in the rule builder UI has one of these types,
 * which determines both the available operators AND the value input widget.
 *
 * 'customer' is a distinct type (NOT 'agent') because customerId and
 * assigneeId come from different lookups (customers vs members).
 */
export type ConditionFieldType = 'status' | 'priority' | 'agent' | 'customer' | 'tag' | 'slaType' | 'text';

export type ConditionOperator = 'equals' | 'not_equals' | 'includes' | 'excludes' | 'is_set' | 'is_not_set';

export interface ConditionField {
  /** Field name as it appears in the normalized trigger payload. */
  field: string;
  /** Human-readable label for the UI. */
  label: string;
  /** Field type — determines operators + value widget. */
  type: ConditionFieldType;
  /** Allowed operators for this field. */
  operators: ConditionOperator[];
  /** Optional helper text shown in the UI. */
  description?: string;
}

/**
 * Status values for conditions.
 */
export const STATUS_VALUES = ['open', 'in_progress', 'waiting_customer', 'resolved', 'closed'] as const;
export type StatusValue = (typeof STATUS_VALUES)[number];

/**
 * Priority values for conditions.
 */
export const PRIORITY_VALUES = ['low', 'medium', 'high', 'urgent'] as const;
export type PriorityValue = (typeof PRIORITY_VALUES)[number];

/**
 * SLA type values.
 */
export const SLA_TYPE_VALUES = ['response', 'resolution'] as const;
export type SlaTypeValue = (typeof SLA_TYPE_VALUES)[number];

/**
 * Operators applicable to enum-like fields (status, priority, slaType).
 */
const ENUM_OPERATORS: ConditionOperator[] = ['equals', 'not_equals'];

/**
 * Operators applicable to entity-reference fields (agent, customer, tag).
 * These fields hold an ID — `is_set`/`is_not_set` are useful to check
 * whether a ticket is assigned / linked to a customer / has a tag.
 */
const ENTITY_OPERATORS: ConditionOperator[] = ['equals', 'not_equals', 'is_set', 'is_not_set'];

/**
 * CONDITION_FIELDS_BY_TRIGGER — the single source of truth for which
 * condition fields are available for each trigger type.
 *
 * IMPORTANT: every field listed here MUST be present in the normalized
 * trigger payload for that trigger type (see the trigger payload
 * normalization in tickets/server.ts, tags/server.ts, sla/evaluation.ts).
 *
 * - For `ticket.created`: the payload provides priority, status (= 'open'),
 *   assignedToId (= null), customerId (= null), createdById.
 * - For `status_changed` / `priority_changed`: `status` / `priority` hold
 *   the CURRENT value (= `to`); `from` holds the previous value.
 * - For `assigned`/`unassigned`: `assigneeId` / `previousAssigneeId`.
 * - For `tag_added`/`tag_removed`: `tagId` / `tagName`.
 * - For `customer_linked`/`customer_unlinked`: `customerId`.
 * - For `sla.at_risk`/`sla.breached`: `slaType` / `assignedToId`.
 */
export const CONDITION_FIELDS_BY_TRIGGER: Record<AutomationTriggerType, ConditionField[]> = {
  'ticket.created': [
    { field: 'priority', label: 'Priority', type: 'priority', operators: ENUM_OPERATORS },
    { field: 'status', label: 'Status', type: 'status', operators: ENUM_OPERATORS },
    { field: 'assignedToId', label: 'Assignee', type: 'agent', operators: ENTITY_OPERATORS, description: 'Ticket assignee' },
    { field: 'customerId', label: 'Customer', type: 'customer', operators: ENTITY_OPERATORS, description: 'Linked customer' },
    { field: 'createdById', label: 'Created by', type: 'agent', operators: ENTITY_OPERATORS, description: 'Ticket creator' },
  ],
  'ticket.status_changed': [
    { field: 'status', label: 'Status (current)', type: 'status', operators: ENUM_OPERATORS, description: 'The new status after the change' },
    { field: 'from', label: 'Status (previous)', type: 'status', operators: ENUM_OPERATORS, description: 'The status before the change' },
  ],
  'ticket.priority_changed': [
    { field: 'priority', label: 'Priority (current)', type: 'priority', operators: ENUM_OPERATORS, description: 'The new priority after the change' },
    { field: 'from', label: 'Priority (previous)', type: 'priority', operators: ENUM_OPERATORS, description: 'The priority before the change' },
  ],
  'ticket.assigned': [
    { field: 'assigneeId', label: 'Assignee', type: 'agent', operators: ENTITY_OPERATORS, description: 'New assignee' },
    { field: 'previousAssigneeId', label: 'Previous assignee', type: 'agent', operators: ENTITY_OPERATORS, description: 'Assignee before this change' },
  ],
  'ticket.unassigned': [
    { field: 'previousAssigneeId', label: 'Previous assignee', type: 'agent', operators: ENTITY_OPERATORS, description: 'Assignee before unassignment' },
  ],
  'ticket.tag_added': [
    { field: 'tagId', label: 'Tag', type: 'tag', operators: ['equals', 'not_equals'], description: 'Tag that was added' },
  ],
  'ticket.tag_removed': [
    { field: 'tagId', label: 'Tag', type: 'tag', operators: ['equals', 'not_equals'], description: 'Tag that was removed' },
  ],
  'ticket.customer_linked': [
    { field: 'customerId', label: 'Customer', type: 'customer', operators: ENTITY_OPERATORS, description: 'Customer linked to the ticket' },
  ],
  'ticket.customer_unlinked': [
    { field: 'customerId', label: 'Customer', type: 'customer', operators: ENTITY_OPERATORS, description: 'Customer unlinked from the ticket' },
  ],
  'sla.at_risk': [
    { field: 'slaType', label: 'SLA type', type: 'slaType', operators: ENUM_OPERATORS, description: 'Response or resolution SLA' },
    { field: 'assignedToId', label: 'Assignee', type: 'agent', operators: ENTITY_OPERATORS, description: 'Ticket assignee at risk notification target' },
  ],
  'sla.breached': [
    { field: 'slaType', label: 'SLA type', type: 'slaType', operators: ENUM_OPERATORS, description: 'Response or resolution SLA' },
    { field: 'assignedToId', label: 'Assignee', type: 'agent', operators: ENTITY_OPERATORS, description: 'Ticket assignee breach notification target' },
  ],
};

/**
 * Returns the condition fields available for a given trigger type.
 * Falls back to an empty array if the trigger is unknown.
 */
export function getConditionFields(triggerType: AutomationTriggerType): ConditionField[] {
  return CONDITION_FIELDS_BY_TRIGGER[triggerType] ?? [];
}
