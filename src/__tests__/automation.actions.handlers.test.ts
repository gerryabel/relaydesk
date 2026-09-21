import { describe, it, expect, vi, beforeEach } from 'vitest';

/**
 * Unit tests for action handlers with a mocked Prisma transaction client.
 *
 * These tests verify the business logic of each handler without requiring
 * a real database — the transaction client is mocked to assert the correct
 * sequence of calls.
 */

interface MockTx {
  membership: { findFirst: ReturnType<typeof vi.fn> };
  ticket: { findFirst: ReturnType<typeof vi.fn>; update: ReturnType<typeof vi.fn> };
  ticketTag: { findFirst: ReturnType<typeof vi.fn>; findUnique: ReturnType<typeof vi.fn>; create: ReturnType<typeof vi.fn>; delete: ReturnType<typeof vi.fn> };
  tag: { findFirst: ReturnType<typeof vi.fn> };
  ticketActivity: { create: ReturnType<typeof vi.fn> };
  internalNote: { findFirst: ReturnType<typeof vi.fn>; create: ReturnType<typeof vi.fn> };
  notification: { findFirst: ReturnType<typeof vi.fn>; create: ReturnType<typeof vi.fn> };
  outboxEvent: { create: ReturnType<typeof vi.fn> };
}

function makeMockTx(): MockTx {
  return {
    membership: { findFirst: vi.fn() },
    ticket: { findFirst: vi.fn(), update: vi.fn() },
    ticketTag: { findFirst: vi.fn(), findUnique: vi.fn(), create: vi.fn(), delete: vi.fn() },
    tag: { findFirst: vi.fn() },
    ticketActivity: { create: vi.fn() },
    internalNote: { findFirst: vi.fn(), create: vi.fn() },
    notification: { findFirst: vi.fn(), create: vi.fn() },
    outboxEvent: { create: vi.fn() },
  };
}

function makeContext(overrides: Partial<{
  workspaceId: string;
  ticketId: string;
  actionIndex: string;
}> = {}) {
  return {
    executionId: 'exec-1',
    workspaceId: overrides.workspaceId ?? 'workspace-1',
    ticketId: overrides.ticketId ?? 'ticket-1',
    actionIndex: 0,
    actionType: 'assign' as const,
    actionConfig: {},
    automationContext: {
      causedByAutomation: true,
      ruleId: 'rule-1',
      executionId: 'exec-1',
      actionIndex: 0,
      actorId: null,
    },
  };
}

describe('assign handler', () => {
  let mod: typeof import('@/lib/automation/actions/handlers');

  beforeEach(async () => {
    mod = await import('@/lib/automation/actions/handlers');
  });

  it('returns permanent failure when assignee is not in workspace', async () => {
    const tx = makeMockTx();
    tx.membership.findFirst.mockResolvedValue(null);

    const handler = mod.getActionHandler('assign')!;
    const ctx = makeContext();
    ctx.actionConfig = { assigneeId: 'user-x' };

    const result = await handler(ctx, tx as never);
    expect(result).toEqual({
      status: 'failed',
      error: expect.stringContaining('not a member'),
    });
  });

  it('returns completed when ticket already assigned to target (natural idempotency)', async () => {
    const tx = makeMockTx();
    tx.membership.findFirst.mockResolvedValue({ id: 'membership-1' });
    tx.ticket.findFirst.mockResolvedValue({ id: 'ticket-1', assignedToId: 'user-1', workspaceId: 'workspace-1' });

    const handler = mod.getActionHandler('assign')!;
    const ctx = makeContext();
    ctx.actionConfig = { assigneeId: 'user-1' };

    const result = await handler(ctx, tx as never);
    expect(result.status).toBe('completed');
    if (result.status === 'completed') {
      expect(result.summary).toBe('already-assigned');
    }
  });

  it('performs assignment when assignee is in workspace and not already assigned', async () => {
    const tx = makeMockTx();
    tx.membership.findFirst.mockResolvedValue({ id: 'membership-1' });
    tx.ticket.findFirst.mockResolvedValue({ id: 'ticket-1', assignedToId: null, workspaceId: 'workspace-1' });
    tx.ticket.update.mockResolvedValue({ id: 'ticket-1', assignedToId: 'user-1' });

    const handler = mod.getActionHandler('assign')!;
    const ctx = makeContext();
    ctx.actionConfig = { assigneeId: 'user-1' };

    const result = await handler(ctx, tx as never);
    expect(result.status).toBe('completed');
    expect(tx.ticket.update).toHaveBeenCalled();
    expect(tx.ticketActivity.create).toHaveBeenCalled();
  });
});

describe('unassign handler', () => {
  let mod: typeof import('@/lib/automation/actions/handlers');

  beforeEach(async () => {
    mod = await import('@/lib/automation/actions/handlers');
  });

  it('returns completed when ticket already unassigned (natural idempotency)', async () => {
    const tx = makeMockTx();
    tx.ticket.findFirst.mockResolvedValue({ id: 'ticket-1', assignedToId: null });

    const handler = mod.getActionHandler('unassign')!;
    const ctx = makeContext();

    const result = await handler(ctx, tx as never);
    expect(result.status).toBe('completed');
    if (result.status === 'completed') {
      expect(result.summary).toBe('already-unassigned');
    }
    expect(tx.ticket.update).not.toHaveBeenCalled();
  });

  it('performs unassignment when ticket is assigned', async () => {
    const tx = makeMockTx();
    tx.ticket.findFirst.mockResolvedValue({ id: 'ticket-1', assignedToId: 'user-1' });
    tx.ticket.update.mockResolvedValue({ id: 'ticket-1', assignedToId: null });

    const handler = mod.getActionHandler('unassign')!;
    const ctx = makeContext();

    const result = await handler(ctx, tx as never);
    expect(result.status).toBe('completed');
    expect(tx.ticket.update).toHaveBeenCalled();
  });
});

describe('set-status handler', () => {
  let mod: typeof import('@/lib/automation/actions/handlers');

  beforeEach(async () => {
    mod = await import('@/lib/automation/actions/handlers');
  });

  it('returns completed when ticket already in desired status (natural idempotency)', async () => {
    const tx = makeMockTx();
    tx.ticket.findFirst.mockResolvedValue({ id: 'ticket-1', status: 'in_progress', resolvedAt: null });

    const handler = mod.getActionHandler('set-status')!;
    const ctx = makeContext();
    ctx.actionConfig = { status: 'in_progress' };

    const result = await handler(ctx, tx as never);
    expect(result.status).toBe('completed');
    if (result.status === 'completed') {
      expect(result.summary).toBe('already-in_progress');
    }
    expect(tx.ticket.update).not.toHaveBeenCalled();
  });

  it('returns permanent failure for invalid transition', async () => {
    const tx = makeMockTx();
    tx.ticket.findFirst.mockResolvedValue({ id: 'ticket-1', status: 'open', resolvedAt: null });

    const handler = mod.getActionHandler('set-status')!;
    const ctx = makeContext();
    ctx.actionConfig = { status: 'closed' };

    const result = await handler(ctx, tx as never);
    expect(result).toEqual({
      status: 'failed',
      error: expect.stringContaining('Invalid status transition'),
    });
  });

  it('performs valid status change', async () => {
    const tx = makeMockTx();
    tx.ticket.findFirst.mockResolvedValue({ id: 'ticket-1', status: 'open', resolvedAt: null });
    tx.ticket.update.mockResolvedValue({ id: 'ticket-1', status: 'in_progress' });

    const handler = mod.getActionHandler('set-status')!;
    const ctx = makeContext();
    ctx.actionConfig = { status: 'in_progress' };

    const result = await handler(ctx, tx as never);
    expect(result.status).toBe('completed');
    expect(tx.ticket.update).toHaveBeenCalled();
  });
});

describe('set-priority handler', () => {
  let mod: typeof import('@/lib/automation/actions/handlers');

  beforeEach(async () => {
    mod = await import('@/lib/automation/actions/handlers');
  });

  it('returns completed when ticket already at desired priority (natural idempotency)', async () => {
    const tx = makeMockTx();
    tx.ticket.findFirst.mockResolvedValue({ id: 'ticket-1', priority: 'high' });

    const handler = mod.getActionHandler('set-priority')!;
    const ctx = makeContext();
    ctx.actionConfig = { priority: 'high' };

    const result = await handler(ctx, tx as never);
    expect(result.status).toBe('completed');
    if (result.status === 'completed') {
      expect(result.summary).toBe('already-high');
    }
    expect(tx.ticket.update).not.toHaveBeenCalled();
  });

  it('performs priority change', async () => {
    const tx = makeMockTx();
    tx.ticket.findFirst.mockResolvedValue({ id: 'ticket-1', priority: 'low' });
    tx.ticket.update.mockResolvedValue({ id: 'ticket-1', priority: 'high' });

    const handler = mod.getActionHandler('set-priority')!;
    const ctx = makeContext();
    ctx.actionConfig = { priority: 'high' };

    const result = await handler(ctx, tx as never);
    expect(result.status).toBe('completed');
    expect(tx.ticket.update).toHaveBeenCalled();
  });
});

describe('add-tag handler', () => {
  let mod: typeof import('@/lib/automation/actions/handlers');

  beforeEach(async () => {
    mod = await import('@/lib/automation/actions/handlers');
  });

  it('returns permanent failure when tag is not in workspace', async () => {
    const tx = makeMockTx();
    tx.ticket.findFirst.mockResolvedValue({ id: 'ticket-1', workspaceId: 'workspace-1' });
    tx.tag.findFirst.mockResolvedValue({ id: 'tag-1', workspaceId: 'workspace-2', name: 'Tag' });

    const handler = mod.getActionHandler('add-tag')!;
    const ctx = makeContext();
    ctx.actionConfig = { tagId: 'tag-1' };

    const result = await handler(ctx, tx as never);
    expect(result).toEqual({
      status: 'failed',
      error: expect.stringContaining('does not belong to workspace'),
    });
  });

  it('returns completed when ticket already has the tag (natural idempotency)', async () => {
    const tx = makeMockTx();
    tx.ticket.findFirst.mockResolvedValue({ id: 'ticket-1', workspaceId: 'workspace-1' });
    tx.tag.findFirst.mockResolvedValue({ id: 'tag-1', workspaceId: 'workspace-1', name: 'Tag' });
    tx.ticketTag.findUnique.mockResolvedValue({ ticketId: 'ticket-1' });

    const handler = mod.getActionHandler('add-tag')!;
    const ctx = makeContext();
    ctx.actionConfig = { tagId: 'tag-1' };

    const result = await handler(ctx, tx as never);
    expect(result.status).toBe('completed');
    if (result.status === 'completed') {
      expect(result.summary).toBe('tag-already-present');
    }
    expect(tx.ticketTag.create).not.toHaveBeenCalled();
  });

  it('adds tag when not already present', async () => {
    const tx = makeMockTx();
    tx.ticket.findFirst.mockResolvedValue({ id: 'ticket-1', workspaceId: 'workspace-1' });
    tx.tag.findFirst.mockResolvedValue({ id: 'tag-1', workspaceId: 'workspace-1', name: 'Tag' });
    tx.ticketTag.findUnique.mockResolvedValue(null);

    const handler = mod.getActionHandler('add-tag')!;
    const ctx = makeContext();
    ctx.actionConfig = { tagId: 'tag-1' };

    const result = await handler(ctx, tx as never);
    expect(result.status).toBe('completed');
    expect(tx.ticketTag.create).toHaveBeenCalled();
  });
});

describe('remove-tag handler', () => {
  let mod: typeof import('@/lib/automation/actions/handlers');

  beforeEach(async () => {
    mod = await import('@/lib/automation/actions/handlers');
  });

  it('returns completed when ticket does not have the tag (natural idempotency)', async () => {
    const tx = makeMockTx();
    tx.ticket.findFirst.mockResolvedValue({ id: 'ticket-1', workspaceId: 'workspace-1' });
    tx.ticketTag.findFirst.mockResolvedValue(null);

    const handler = mod.getActionHandler('remove-tag')!;
    const ctx = makeContext();
    ctx.actionConfig = { tagId: 'tag-1' };

    const result = await handler(ctx, tx as never);
    expect(result.status).toBe('completed');
    if (result.status === 'completed') {
      expect(result.summary).toBe('tag-already-absent');
    }
    expect(tx.ticketTag.delete).not.toHaveBeenCalled();
  });

  it('removes tag when present', async () => {
    const tx = makeMockTx();
    tx.ticket.findFirst.mockResolvedValue({ id: 'ticket-1', workspaceId: 'workspace-1' });
    tx.ticketTag.findFirst.mockResolvedValue({
      ticketId: 'ticket-1',
      tag: { id: 'tag-1', name: 'Tag', workspaceId: 'workspace-1' },
    });

    const handler = mod.getActionHandler('remove-tag')!;
    const ctx = makeContext();
    ctx.actionConfig = { tagId: 'tag-1' };

    const result = await handler(ctx, tx as never);
    expect(result.status).toBe('completed');
    expect(tx.ticketTag.delete).toHaveBeenCalled();
  });
});

describe('internal-note handler', () => {
  let mod: typeof import('@/lib/automation/actions/handlers');

  beforeEach(async () => {
    mod = await import('@/lib/automation/actions/handlers');
  });

  it('returns permanent failure when authorId is not in workspace', async () => {
    const tx = makeMockTx();
    tx.membership.findFirst.mockResolvedValue(null);

    const handler = mod.getActionHandler('internal-note')!;
    const ctx = makeContext();
    ctx.actionConfig = { body: 'Test note', authorId: 'user-x' };

    const result = await handler(ctx, tx as never);
    expect(result).toEqual({
      status: 'failed',
      error: expect.stringContaining('not a member'),
    });
  });

  it('creates note with automation-origin marker and dedupe key', async () => {
    const tx = makeMockTx();
    tx.ticket.findFirst.mockResolvedValue({ id: 'ticket-1' });
    tx.membership.findFirst.mockResolvedValue({ id: 'membership-1' });
    tx.internalNote.findFirst.mockResolvedValue(null);
    tx.internalNote.create.mockResolvedValue({ id: 'note-1' });

    const handler = mod.getActionHandler('internal-note')!;
    const ctx = makeContext();
    ctx.actionConfig = { body: 'Test note', authorId: 'user-1' };

    const result = await handler(ctx, tx as never);
    expect(result.status).toBe('completed');
    expect(tx.internalNote.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          body: '[Automation] Test note',
          authorId: 'user-1',
          automationDedupeKey: 'exec-1:0',
        }),
      }),
    );
  });

  it('returns existing note on deduplication hit (idempotent)', async () => {
    const tx = makeMockTx();
    tx.ticket.findFirst.mockResolvedValue({ id: 'ticket-1' });
    tx.membership.findFirst.mockResolvedValue({ id: 'membership-1' });
    tx.internalNote.findFirst.mockResolvedValue({ id: 'note-existing' });

    const handler = mod.getActionHandler('internal-note')!;
    const ctx = makeContext();
    ctx.actionConfig = { body: 'Test note', authorId: 'user-1' };

    const result = await handler(ctx, tx as never);
    expect(result.status).toBe('completed');
    expect(tx.internalNote.create).not.toHaveBeenCalled();
  });
});

describe('notification handler', () => {
  let mod: typeof import('@/lib/automation/actions/handlers');

  beforeEach(async () => {
    mod = await import('@/lib/automation/actions/handlers');
  });

  it('returns permanent failure when recipient is not in workspace', async () => {
    const tx = makeMockTx();
    tx.membership.findFirst.mockResolvedValue(null);

    const handler = mod.getActionHandler('notification')!;
    const ctx = makeContext();
    ctx.actionConfig = { recipientId: 'user-x', title: 'Hi', body: 'World' };

    const result = await handler(ctx, tx as never);
    expect(result).toEqual({
      status: 'failed',
      error: expect.stringContaining('not a member'),
    });
  });

  it('creates notification with automation-origin marker and dedupe key', async () => {
    const tx = makeMockTx();
    tx.membership.findFirst.mockResolvedValue({ id: 'membership-1' });
    tx.ticket.findFirst.mockResolvedValue({ id: 'ticket-1' });
    tx.notification.findFirst.mockResolvedValue(null);
    tx.notification.create.mockResolvedValue({ id: 'notif-1' });

    const handler = mod.getActionHandler('notification')!;
    const ctx = makeContext();
    ctx.actionConfig = { recipientId: 'user-1', title: 'Alert', body: 'Something happened' };

    const result = await handler(ctx, tx as never);
    expect(result.status).toBe('completed');
    expect(tx.notification.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          title: '[Automation] Alert',
          body: 'Something happened',
          automationDedupeKey: 'exec-1:0',
        }),
      }),
    );
  });

  it('returns existing notification on deduplication hit (idempotent)', async () => {
    const tx = makeMockTx();
    tx.membership.findFirst.mockResolvedValue({ id: 'membership-1' });
    tx.ticket.findFirst.mockResolvedValue({ id: 'ticket-1' });
    tx.notification.findFirst.mockResolvedValue({ id: 'notif-existing' });

    const handler = mod.getActionHandler('notification')!;
    const ctx = makeContext();
    ctx.actionConfig = { recipientId: 'user-1', title: 'Alert', body: 'Something happened' };

    const result = await handler(ctx, tx as never);
    expect(result.status).toBe('completed');
    expect(tx.notification.create).not.toHaveBeenCalled();
  });
});
