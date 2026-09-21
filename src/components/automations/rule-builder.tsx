'use client';

import { useState } from 'react';
import type { RuleResponse } from '@/lib/automation/rules';
import type { AutomationTriggerType } from '@/lib/automation/types';
import { getConditionFields, STATUS_VALUES, PRIORITY_VALUES, SLA_TYPE_VALUES } from '@/lib/automation/condition-fields';
import type { ConditionOperator } from '@/lib/automation/condition-fields';
import type { AutomationActionType } from '@/lib/automation/actions/schema';

export interface RuleBuilderProps {
  initialRule?: RuleResponse;
  members: Array<{ id: string; name: string }>;
  tags: Array<{ id: string; name: string }>;
  onSave: (input: {
    name: string;
    description?: string;
    triggerType: string;
    conditions: unknown;
    actions: Array<{ actionType: string; actionConfig: Record<string, unknown> }>;
  }) => Promise<void>;
  onCancel: () => void;
}

const TRIGGER_OPTIONS: { value: AutomationTriggerType; label: string }[] = [
  { value: 'ticket.created', label: 'Ticket created' },
  { value: 'ticket.status_changed', label: 'Status changed' },
  { value: 'ticket.priority_changed', label: 'Priority changed' },
  { value: 'ticket.assigned', label: 'Ticket assigned' },
  { value: 'ticket.unassigned', label: 'Ticket unassigned' },
  { value: 'ticket.tag_added', label: 'Tag added' },
  { value: 'ticket.tag_removed', label: 'Tag removed' },
  { value: 'ticket.customer_linked', label: 'Customer linked' },
  { value: 'ticket.customer_unlinked', label: 'Customer unlinked' },
  { value: 'sla.at_risk', label: 'SLA at risk' },
  { value: 'sla.breached', label: 'SLA breached' },
];

const ACTION_OPTIONS: { value: AutomationActionType; label: string }[] = [
  { value: 'assign', label: 'Assign to agent' },
  { value: 'unassign', label: 'Unassign' },
  { value: 'set-status', label: 'Set status' },
  { value: 'set-priority', label: 'Set priority' },
  { value: 'add-tag', label: 'Add tag' },
  { value: 'remove-tag', label: 'Remove tag' },
  { value: 'internal-note', label: 'Add internal note' },
  { value: 'notification', label: 'Send notification' },
];

interface ConditionRow {
  id: string;
  field: string;
  operator: ConditionOperator;
  value: string;
}

interface ActionRow {
  id: string;
  actionType: AutomationActionType;
  config: Record<string, string>;
}

let rowCounter = 0;
function nextId() {
  return `row-${++rowCounter}`;
}

export function RuleBuilder({ initialRule, members, tags, onSave, onCancel }: RuleBuilderProps) {
  const [name, setName] = useState(initialRule?.name ?? '');
  const [description, setDescription] = useState(initialRule?.description ?? '');
  const [triggerType, setTriggerType] = useState<AutomationTriggerType>(
    (initialRule?.triggerType as AutomationTriggerType) ?? 'ticket.created',
  );
  const [conditions, setConditions] = useState<ConditionRow[]>(() => {
    if (initialRule?.conditions && Array.isArray(initialRule.conditions) && initialRule.conditions.length > 0) {
      return (initialRule.conditions as Array<{ field?: string; operator?: string; value?: unknown }>).map((c) => ({
        id: nextId(),
        field: c.field ?? '',
        operator: (c.operator as ConditionOperator) ?? 'equals',
        value: c.value != null ? String(c.value) : '',
      }));
    }
    return [{ id: nextId(), field: '', operator: 'equals', value: '' }];
  });
  const [actions, setActions] = useState<ActionRow[]>(() => {
    if (initialRule?.actions && Array.isArray(initialRule.actions) && initialRule.actions.length > 0) {
      return (initialRule.actions as Array<{ actionType?: string; actionConfig?: Record<string, unknown> }>).map((a) => ({
        id: nextId(),
        actionType: (a.actionType as AutomationActionType) ?? 'assign',
        config: Object.fromEntries(Object.entries(a.actionConfig ?? {}).map(([k, v]) => [k, String(v)])),
      }));
    }
    return [{ id: nextId(), actionType: 'assign', config: {} }];
  });
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const conditionFields = getConditionFields(triggerType);

  const handleTriggerChange = (newTrigger: AutomationTriggerType) => {
    setTriggerType(newTrigger);
    // Reset conditions when trigger changes — fields are different.
    setConditions([{ id: nextId(), field: '', operator: 'equals', value: '' }]);
  };

  const addCondition = () => {
    setConditions((prev) => [...prev, { id: nextId(), field: '', operator: 'equals', value: '' }]);
  };

  const updateCondition = (id: string, updates: Partial<ConditionRow>) => {
    setConditions((prev) => prev.map((c) => (c.id === id ? { ...c, ...updates } : c)));
  };

  const removeCondition = (id: string) => {
    setConditions((prev) => (prev.length > 1 ? prev.filter((c) => c.id !== id) : prev));
  };

  const addAction = () => {
    setActions((prev) => [...prev, { id: nextId(), actionType: 'assign', config: {} }]);
  };

  const updateAction = (id: string, updates: Partial<ActionRow>) => {
    setActions((prev) => prev.map((a) => (a.id === id ? { ...a, ...updates } : a)));
  };

  const removeAction = (id: string) => {
    setActions((prev) => (prev.length > 1 ? prev.filter((a) => a.id !== id) : prev));
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);

    if (!name.trim()) {
      setError('Name is required');
      return;
    }

    // Build conditions payload
    const conditionsPayload = conditions
      .filter((c) => c.field)
      .map((c) => {
        const fieldDef = conditionFields.find((f) => f.field === c.field);
        let value: unknown = c.value;
        // Parse value based on field type
        if (fieldDef?.type === 'agent' || fieldDef?.type === 'customer' || fieldDef?.type === 'tag') {
          // IDs — keep as string
          value = c.value;
        }
        return { field: c.field, operator: c.operator, value };
      });

    if (conditionsPayload.length === 0) {
      setError('At least one condition is required');
      return;
    }

    // Build actions payload
    const actionsPayload = actions.map((a) => {
      const config: Record<string, unknown> = {};
      for (const [k, v] of Object.entries(a.config)) {
        if (v) config[k] = v;
      }
      return { actionType: a.actionType, actionConfig: config };
    });

    if (actionsPayload.length === 0) {
      setError('At least one action is required');
      return;
    }

    setSaving(true);
    try {
      await onSave({
        name: name.trim(),
        description: description.trim() || undefined,
        triggerType,
        conditions: conditionsPayload,
        actions: actionsPayload,
      });
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to save rule');
      setSaving(false);
    }
  };

  const renderValueInput = (cond: ConditionRow) => {
    const fieldDef = conditionFields.find((f) => f.field === cond.field);
    if (!fieldDef) {
      return (
        <input
          type="text"
          value={cond.value}
          onChange={(e) => updateCondition(cond.id, { value: e.target.value })}
          className="rounded-md border border-neutral-300 px-2 py-1 text-sm dark:border-neutral-700 dark:bg-neutral-800 dark:text-neutral-100"
          placeholder="Value"
        />
      );
    }

    // is_set / is_not_set don't need a value
    if (cond.operator === 'is_set' || cond.operator === 'is_not_set') {
      return null;
    }

    if (fieldDef.type === 'status') {
      return (
        <select
          value={cond.value}
          onChange={(e) => updateCondition(cond.id, { value: e.target.value })}
          className="rounded-md border border-neutral-300 px-2 py-1 text-sm dark:border-neutral-700 dark:bg-neutral-800 dark:text-neutral-100"
        >
          <option value="">Select status</option>
          {STATUS_VALUES.map((s) => (
            <option key={s} value={s}>
              {s}
            </option>
          ))}
        </select>
      );
    }

    if (fieldDef.type === 'priority') {
      return (
        <select
          value={cond.value}
          onChange={(e) => updateCondition(cond.id, { value: e.target.value })}
          className="rounded-md border border-neutral-300 px-2 py-1 text-sm dark:border-neutral-700 dark:bg-neutral-800 dark:text-neutral-100"
        >
          <option value="">Select priority</option>
          {PRIORITY_VALUES.map((p) => (
            <option key={p} value={p}>
              {p}
            </option>
          ))}
        </select>
      );
    }

    if (fieldDef.type === 'slaType') {
      return (
        <select
          value={cond.value}
          onChange={(e) => updateCondition(cond.id, { value: e.target.value })}
          className="rounded-md border border-neutral-300 px-2 py-1 text-sm dark:border-neutral-700 dark:bg-neutral-800 dark:text-neutral-100"
        >
          <option value="">Select SLA type</option>
          {SLA_TYPE_VALUES.map((s) => (
            <option key={s} value={s}>
              {s}
            </option>
          ))}
        </select>
      );
    }

    if (fieldDef.type === 'agent') {
      return (
        <select
          value={cond.value}
          onChange={(e) => updateCondition(cond.id, { value: e.target.value })}
          className="rounded-md border border-neutral-300 px-2 py-1 text-sm dark:border-neutral-700 dark:bg-neutral-800 dark:text-neutral-100"
        >
          <option value="">Select member</option>
          {members.map((m) => (
            <option key={m.id} value={m.id}>
              {m.name}
            </option>
          ))}
        </select>
      );
    }

    if (fieldDef.type === 'tag') {
      return (
        <select
          value={cond.value}
          onChange={(e) => updateCondition(cond.id, { value: e.target.value })}
          className="rounded-md border border-neutral-300 px-2 py-1 text-sm dark:border-neutral-700 dark:bg-neutral-800 dark:text-neutral-100"
        >
          <option value="">Select tag</option>
          {tags.map((t) => (
            <option key={t.id} value={t.id}>
              {t.name}
            </option>
          ))}
        </select>
      );
    }

    // customer / text — free input
    return (
      <input
        type="text"
        value={cond.value}
        onChange={(e) => updateCondition(cond.id, { value: e.target.value })}
        className="rounded-md border border-neutral-300 px-2 py-1 text-sm dark:border-neutral-700 dark:bg-neutral-800 dark:text-neutral-100"
        placeholder="Value"
      />
    );
  };

  const renderActionConfig = (action: ActionRow) => {
    switch (action.actionType) {
      case 'assign':
        return (
          <select
            value={action.config.assigneeId ?? ''}
            onChange={(e) => updateAction(action.id, { config: { assigneeId: e.target.value } })}
            className="rounded-md border border-neutral-300 px-2 py-1 text-sm dark:border-neutral-700 dark:bg-neutral-800 dark:text-neutral-100"
            aria-label="Assignee"
          >
            <option value="">Select member</option>
            {members.map((m) => (
              <option key={m.id} value={m.id}>
                {m.name}
              </option>
            ))}
          </select>
        );
      case 'set-status':
        return (
          <select
            value={action.config.status ?? ''}
            onChange={(e) => updateAction(action.id, { config: { status: e.target.value } })}
            className="rounded-md border border-neutral-300 px-2 py-1 text-sm dark:border-neutral-700 dark:bg-neutral-800 dark:text-neutral-100"
            aria-label="Status"
          >
            <option value="">Select status</option>
            {STATUS_VALUES.map((s) => (
              <option key={s} value={s}>
                {s}
              </option>
            ))}
          </select>
        );
      case 'set-priority':
        return (
          <select
            value={action.config.priority ?? ''}
            onChange={(e) => updateAction(action.id, { config: { priority: e.target.value } })}
            className="rounded-md border border-neutral-300 px-2 py-1 text-sm dark:border-neutral-700 dark:bg-neutral-800 dark:text-neutral-100"
            aria-label="Priority"
          >
            <option value="">Select priority</option>
            {PRIORITY_VALUES.map((p) => (
              <option key={p} value={p}>
                {p}
              </option>
            ))}
          </select>
        );
      case 'add-tag':
      case 'remove-tag':
        return (
          <select
            value={action.config.tagId ?? ''}
            onChange={(e) => updateAction(action.id, { config: { tagId: e.target.value } })}
            className="rounded-md border border-neutral-300 px-2 py-1 text-sm dark:border-neutral-700 dark:bg-neutral-800 dark:text-neutral-100"
            aria-label="Tag"
          >
            <option value="">Select tag</option>
            {tags.map((t) => (
              <option key={t.id} value={t.id}>
                {t.name}
              </option>
            ))}
          </select>
        );
      case 'internal-note':
        return (
          <div className="flex flex-col gap-2">
            <select
              value={action.config.authorId ?? ''}
              onChange={(e) => updateAction(action.id, { config: { ...action.config, authorId: e.target.value } })}
              className="rounded-md border border-neutral-300 px-2 py-1 text-sm dark:border-neutral-700 dark:bg-neutral-800 dark:text-neutral-100"
              aria-label="Note author"
            >
              <option value="">Select author</option>
              {members.map((m) => (
                <option key={m.id} value={m.id}>
                  {m.name}
                </option>
              ))}
            </select>
            <textarea
              value={action.config.body ?? ''}
              onChange={(e) => updateAction(action.id, { config: { ...action.config, body: e.target.value } })}
              className="rounded-md border border-neutral-300 px-2 py-1 text-sm dark:border-neutral-700 dark:bg-neutral-800 dark:text-neutral-100"
              placeholder="Note body"
              rows={2}
              aria-label="Note body"
            />
          </div>
        );
      case 'notification':
        return (
          <div className="flex flex-col gap-2">
            <select
              value={action.config.recipientId ?? ''}
              onChange={(e) => updateAction(action.id, { config: { ...action.config, recipientId: e.target.value } })}
              className="rounded-md border border-neutral-300 px-2 py-1 text-sm dark:border-neutral-700 dark:bg-neutral-800 dark:text-neutral-100"
              aria-label="Recipient"
            >
              <option value="">Select recipient</option>
              {members.map((m) => (
                <option key={m.id} value={m.id}>
                  {m.name}
                </option>
              ))}
            </select>
            <input
              type="text"
              value={action.config.message ?? ''}
              onChange={(e) => updateAction(action.id, { config: { ...action.config, message: e.target.value } })}
              className="rounded-md border border-neutral-300 px-2 py-1 text-sm dark:border-neutral-700 dark:bg-neutral-800 dark:text-neutral-100"
              placeholder="Message"
              aria-label="Notification message"
            />
          </div>
        );
      default:
        return null;
    }
  };

  return (
    <form onSubmit={handleSubmit} className="flex flex-col gap-5">
      {error ? (
        <p className="text-sm text-red-600 dark:text-red-400" role="alert">
          {error}
        </p>
      ) : null}

      <div className="flex flex-col gap-4 rounded-lg border border-neutral-200 bg-white p-5 dark:border-neutral-800 dark:bg-neutral-900">
        <h2 className="text-sm font-medium text-neutral-700 dark:text-neutral-200">General</h2>
        <div className="flex flex-col gap-3">
          <label className="flex flex-col gap-1">
            <span className="text-sm text-neutral-700 dark:text-neutral-300">Name</span>
            <input
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              className="rounded-md border border-neutral-300 px-2 py-1 text-sm dark:border-neutral-700 dark:bg-neutral-800 dark:text-neutral-100"
              required
              maxLength={100}
              aria-label="Rule name"
            />
          </label>
          <label className="flex flex-col gap-1">
            <span className="text-sm text-neutral-700 dark:text-neutral-300">Description (optional)</span>
            <textarea
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              className="rounded-md border border-neutral-300 px-2 py-1 text-sm dark:border-neutral-700 dark:bg-neutral-800 dark:text-neutral-100"
              rows={2}
              maxLength={500}
              aria-label="Rule description"
            />
          </label>
          <label className="flex flex-col gap-1">
            <span className="text-sm text-neutral-700 dark:text-neutral-300">Trigger</span>
            <select
              value={triggerType}
              onChange={(e) => handleTriggerChange(e.target.value as AutomationTriggerType)}
              className="rounded-md border border-neutral-300 px-2 py-1 text-sm dark:border-neutral-700 dark:bg-neutral-800 dark:text-neutral-100"
              aria-label="Trigger type"
            >
              {TRIGGER_OPTIONS.map((opt) => (
                <option key={opt.value} value={opt.value}>
                  {opt.label}
                </option>
              ))}
            </select>
          </label>
        </div>
      </div>

      <div className="flex flex-col gap-4 rounded-lg border border-neutral-200 bg-white p-5 dark:border-neutral-800 dark:bg-neutral-900">
        <div className="flex items-center justify-between">
          <h2 className="text-sm font-medium text-neutral-700 dark:text-neutral-200">Conditions</h2>
          <button
            type="button"
            onClick={addCondition}
            className="text-sm text-neutral-600 hover:text-neutral-900 dark:text-neutral-400 dark:hover:text-neutral-100"
          >
            + Add condition
          </button>
        </div>
        <p className="text-xs text-neutral-500 dark:text-neutral-400">
          All conditions must match (AND). Only fields available for the selected trigger are shown.
        </p>
        <div className="flex flex-col gap-3">
          {conditions.map((cond) => (
            <div key={cond.id} className="flex flex-wrap items-center gap-2">
              <select
                value={cond.field}
                onChange={(e) => updateCondition(cond.id, { field: e.target.value, value: '' })}
                className="rounded-md border border-neutral-300 px-2 py-1 text-sm dark:border-neutral-700 dark:bg-neutral-800 dark:text-neutral-100"
                aria-label="Condition field"
              >
                <option value="">Select field</option>
                {conditionFields.map((f) => (
                  <option key={f.field} value={f.field}>
                    {f.label}
                  </option>
                ))}
              </select>
              <select
                value={cond.operator}
                onChange={(e) => updateCondition(cond.id, { operator: e.target.value as ConditionOperator })}
                className="rounded-md border border-neutral-300 px-2 py-1 text-sm dark:border-neutral-700 dark:bg-neutral-800 dark:text-neutral-100"
                aria-label="Condition operator"
              >
                <option value="equals">equals</option>
                <option value="not_equals">not equals</option>
                <option value="is_set">is set</option>
                <option value="is_not_set">is not set</option>
              </select>
              {renderValueInput(cond)}
              <button
                type="button"
                onClick={() => removeCondition(cond.id)}
                disabled={conditions.length <= 1}
                className="text-sm text-neutral-500 hover:text-red-600 disabled:opacity-30"
                aria-label="Remove condition"
              >
                Remove
              </button>
            </div>
          ))}
        </div>
      </div>

      <div className="flex flex-col gap-4 rounded-lg border border-neutral-200 bg-white p-5 dark:border-neutral-800 dark:bg-neutral-900">
        <div className="flex items-center justify-between">
          <h2 className="text-sm font-medium text-neutral-700 dark:text-neutral-200">Actions</h2>
          <button
            type="button"
            onClick={addAction}
            disabled={actions.length >= 5}
            className="text-sm text-neutral-600 hover:text-neutral-900 disabled:opacity-30 dark:text-neutral-400 dark:hover:text-neutral-100"
          >
            + Add action
          </button>
        </div>
        <div className="flex flex-col gap-4">
          {actions.map((action) => (
            <div key={action.id} className="flex flex-col gap-2 rounded-md border border-neutral-200 p-3 dark:border-neutral-700">
              <div className="flex items-center justify-between">
                <select
                  value={action.actionType}
                  onChange={(e) => updateAction(action.id, { actionType: e.target.value as AutomationActionType, config: {} })}
                  className="rounded-md border border-neutral-300 px-2 py-1 text-sm dark:border-neutral-700 dark:bg-neutral-800 dark:text-neutral-100"
                  aria-label="Action type"
                >
                  {ACTION_OPTIONS.map((opt) => (
                    <option key={opt.value} value={opt.value}>
                      {opt.label}
                    </option>
                  ))}
                </select>
                <button
                  type="button"
                  onClick={() => removeAction(action.id)}
                  disabled={actions.length <= 1}
                  className="text-sm text-neutral-500 hover:text-red-600 disabled:opacity-30"
                  aria-label="Remove action"
                >
                  Remove
                </button>
              </div>
              {renderActionConfig(action)}
            </div>
          ))}
        </div>
      </div>

      <div className="flex items-center gap-3">
        <button
          type="submit"
          disabled={saving}
          className="inline-flex items-center justify-center rounded-md bg-neutral-900 px-4 py-2 text-sm font-medium text-white transition hover:bg-neutral-800 disabled:opacity-50 dark:bg-neutral-100 dark:text-neutral-900 dark:hover:bg-neutral-200"
        >
          {saving ? 'Saving...' : initialRule ? 'Update rule' : 'Create rule'}
        </button>
        <button
          type="button"
          onClick={onCancel}
          className="inline-flex items-center justify-center rounded-md border border-neutral-300 px-4 py-2 text-sm hover:border-neutral-900 dark:border-neutral-700 dark:hover:border-neutral-100"
        >
          Cancel
        </button>
      </div>
    </form>
  );
}
