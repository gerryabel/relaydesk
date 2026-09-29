import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { NextRequest } from 'next/server';
import { UnauthorizedError, ForbiddenError } from '@/lib/workspace/server';
import { ExecutionNotFoundError } from '@/lib/automation/execution-service';
import {
  listAutomationExecutions,
  getAutomationExecutionById,
  retryFailedFinalAction,
  ActionNotFoundError,
  ExecutionNotRetryableError,
  ExecutionRetryConflictError,
} from '@/lib/automation/executions';
import { GET as listExecutions } from '@/app/api/automation-executions/route';
import { GET as getExecution } from '@/app/api/automation-executions/[id]/route';
import { POST as retryAction } from '@/app/api/automation-executions/[executionId]/actions/[actionIndex]/retry/route';

/**
 * HTTP-surface coverage for the automation execution routes.
 *
 * The domain service is mocked so these tests assert exactly one thing per
 * case: the status code and payload the route produces for a given service
 * outcome or query input. Service behaviour itself is covered by
 * `automation.executions.integration.test.ts`.
 */

vi.mock('@/lib/automation/executions', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/automation/executions')>();
  return {
    ...actual,
    listAutomationExecutions: vi.fn(),
    getAutomationExecutionById: vi.fn(),
    retryFailedFinalAction: vi.fn(),
  };
});

vi.mock('@/lib/workspace/server', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/workspace/server')>();
  return { ...actual, getCurrentMembership: vi.fn(), assertWorkspaceOwner: vi.fn() };
});

const mockedList = vi.mocked(listAutomationExecutions);
const mockedGet = vi.mocked(getAutomationExecutionById);
const mockedRetry = vi.mocked(retryFailedFinalAction);

const listResult = {
  data: [
    {
      id: 'exec-1',
      workspaceId: 'ws-1',
      ruleId: 'rule-1',
      ruleNameSnapshot: 'Escalate urgent',
      sourceEventType: 'TICKET_CREATED',
      sourceEventId: 'outbox-1',
      sourceAggregateId: 'ticket-1',
      ticketId: 'ticket-1',
      status: 'partial_failure' as const,
      evaluatedConditions: true,
      skipReason: null,
      error: 'action 1 failed',
      actionCount: 2,
      failedActionCount: 1,
      startedAt: '2026-01-01T00:00:00.000Z',
      completedAt: '2026-01-01T00:00:02.000Z',
      createdAt: '2026-01-01T00:00:00.000Z',
      durationMs: 2_000,
      isRetryable: true,
    },
  ],
  page: 1,
  limit: 20,
  total: 1,
  totalPages: 1,
  hasPreviousPage: false,
  hasNextPage: false,
};

const detailResult = {
  execution: {
    id: 'exec-1',
    workspaceId: 'ws-1',
    ruleId: null,
    ruleNameSnapshot: 'Deleted Rule',
    rule: null,
    sourceEventType: 'TICKET_CREATED',
    sourceEventId: 'outbox-1',
    sourceAggregateId: 'ticket-1',
    ticketId: 'ticket-1',
    status: 'failed' as const,
    evaluatedConditions: true,
    skipReason: null,
    error: 'boom',
    leasedBy: null,
    leasedAt: null,
    startedAt: '2026-01-01T00:00:00.000Z',
    completedAt: '2026-01-01T00:00:01.000Z',
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:01.000Z',
    durationMs: 1_000,
    isRetryable: true,
  },
  actions: [
    {
      id: 'action-1',
      actionIndex: 0,
      actionType: 'unassign',
      actionConfig: {},
      status: 'failed',
      error: 'boom',
      startedAt: null,
      completedAt: null,
      createdAt: '2026-01-01T00:00:00.000Z',
      updatedAt: '2026-01-01T00:00:01.000Z',
      durationMs: null,
      isFinalAction: true,
      isRetryable: true,
    },
  ],
  sourceEvent: null,
  canRetry: true,
};

function listRequest(query = '') {
  return new NextRequest(`http://localhost/api/automation-executions${query}`, { signal: undefined });
}

function detailRequest(id = 'exec-1') {
  return new NextRequest(`http://localhost/api/automation-executions/${id}`, { signal: undefined });
}

function retryRequest(executionId = 'exec-1', actionIndex = '0') {
  return new NextRequest(
    `http://localhost/api/automation-executions/${executionId}/actions/${actionIndex}/retry`,
    { method: 'POST', signal: undefined },
  );
}

beforeEach(() => {
  mockedList.mockReset();
  mockedGet.mockReset();
  mockedRetry.mockReset();
  mockedList.mockResolvedValue(listResult);
  mockedGet.mockResolvedValue(detailResult);
  mockedRetry.mockResolvedValue({
    executionId: 'exec-1',
    actionIndex: 0,
    actionStatus: 'pending',
    executionStatus: 'awaiting_actions',
  });
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('GET /api/automation-executions', () => {
  it('returns the paginated execution list', async () => {
    const response = await listExecutions(listRequest());
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.data).toHaveLength(1);
    expect(body).toMatchObject({
      page: 1,
      limit: 20,
      total: 1,
      totalPages: 1,
      hasPreviousPage: false,
      hasNextPage: false,
    });
  });

  it('applies the documented defaults when no query is supplied', async () => {
    await listExecutions(listRequest());

    expect(mockedList).toHaveBeenCalledWith({ page: 1, limit: 20 });
  });

  it('maps query parameters onto service filters', async () => {
    await listExecutions(
      listRequest(
        '?page=2&limit=50&status=failed&ruleId=rule-9&triggerType=TICKET_CREATED' +
          '&ticketId=ticket-7&from=2026-01-01T00:00:00Z&to=2026-02-01T00:00:00Z',
      ),
    );

    expect(mockedList).toHaveBeenCalledWith({
      page: 2,
      limit: 50,
      status: 'failed',
      ruleId: 'rule-9',
      sourceEventType: 'TICKET_CREATED',
      ticketId: 'ticket-7',
      from: new Date('2026-01-01T00:00:00Z'),
      to: new Date('2026-02-01T00:00:00Z'),
    });
  });

  it('accepts an explicit UTC offset on date filters', async () => {
    await listExecutions(listRequest('?from=2026-01-01T00:00:00%2B07:00'));

    expect(mockedList).toHaveBeenCalledWith(
      expect.objectContaining({ from: new Date('2025-12-31T17:00:00Z') }),
    );
  });

  it('ignores unknown query parameters', async () => {
    const response = await listExecutions(listRequest('?status=completed&sort=whatever'));

    expect(response.status).toBe(200);
    expect(mockedList).toHaveBeenCalledWith({ page: 1, limit: 20, status: 'completed' });
  });

  it.each([
    ['an unknown status', '?status=exploded'],
    ['a zero page', '?page=0'],
    ['a negative page', '?page=-1'],
    ['a non-numeric page', '?page=abc'],
    ['a page size above the maximum', '?limit=101'],
    ['a non-numeric page size', '?limit=lots'],
    ['a non-integer page size', '?limit=10.5'],
    ['a malformed date', '?from=yesterday'],
    ['to before from', '?from=2026-02-01T00:00:00Z&to=2026-01-01T00:00:00Z'],
    ['to equal to from', '?from=2026-01-01T00:00:00Z&to=2026-01-01T00:00:00Z'],
  ])('returns 400 for %s', async (_label, query) => {
    const response = await listExecutions(listRequest(query));
    const body = await response.json();

    expect(response.status).toBe(400);
    expect(typeof body.error).toBe('string');
    expect(mockedList).not.toHaveBeenCalled();
  });

  it('returns 401 when there is no authenticated membership', async () => {
    mockedList.mockRejectedValueOnce(new UnauthorizedError('No session'));

    const response = await listExecutions(listRequest());

    expect(response.status).toBe(401);
    expect(await response.json()).toEqual({ error: 'Unauthorized' });
  });

  it('returns 403 when the caller lacks access', async () => {
    mockedList.mockRejectedValueOnce(new ForbiddenError('Not a member'));

    const response = await listExecutions(listRequest());

    expect(response.status).toBe(403);
    expect(await response.json()).toEqual({ error: 'Forbidden' });
  });

  it('returns a generic 500 for unexpected failures', async () => {
    mockedList.mockRejectedValueOnce(new Error('database exploded'));

    const response = await listExecutions(listRequest());
    const body = await response.json();

    expect(response.status).toBe(500);
    expect(body).toEqual({ error: 'Failed to load automation executions' });
  });
});

describe('GET /api/automation-executions/[id]', () => {
  it('returns the execution detail payload', async () => {
    const response = await getExecution(detailRequest(), {
      params: Promise.resolve({ id: 'exec-1' }),
    });
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.execution.id).toBe('exec-1');
    expect(body.actions).toHaveLength(1);
    expect(body.sourceEvent).toBeNull();
    expect(body.canRetry).toBe(true);
    expect(mockedGet).toHaveBeenCalledWith('exec-1');
  });

  it('returns 404 for an unknown execution', async () => {
    mockedGet.mockRejectedValueOnce(new ExecutionNotFoundError());

    const response = await getExecution(detailRequest('missing'), {
      params: Promise.resolve({ id: 'missing' }),
    });

    expect(response.status).toBe(404);
    expect(await response.json()).toEqual({ error: 'Automation execution not found' });
  });

  it('returns the same 404 when the execution belongs to another workspace', async () => {
    // The service throws an identical error for both cases, so the route cannot
    // disclose cross-workspace existence.
    mockedGet.mockRejectedValueOnce(new ExecutionNotFoundError());

    const response = await getExecution(detailRequest('someone-elses'), {
      params: Promise.resolve({ id: 'someone-elses' }),
    });
    const body = await response.json();

    expect(response.status).toBe(404);
    expect(body).toEqual({ error: 'Automation execution not found' });
    expect(JSON.stringify(body)).not.toContain('someone-elses');
  });

  it('returns 401 when there is no authenticated membership', async () => {
    mockedGet.mockRejectedValueOnce(new UnauthorizedError('No session'));

    const response = await getExecution(detailRequest(), {
      params: Promise.resolve({ id: 'exec-1' }),
    });

    expect(response.status).toBe(401);
  });

  it('returns 403 when the caller lacks access', async () => {
    mockedGet.mockRejectedValueOnce(new ForbiddenError('Not a member'));

    const response = await getExecution(detailRequest(), {
      params: Promise.resolve({ id: 'exec-1' }),
    });

    expect(response.status).toBe(403);
  });

  it('returns a generic 500 for unexpected failures', async () => {
    mockedGet.mockRejectedValueOnce(new Error('database exploded'));

    const response = await getExecution(detailRequest(), {
      params: Promise.resolve({ id: 'exec-1' }),
    });

    expect(response.status).toBe(500);
    expect(await response.json()).toEqual({ error: 'Failed to load automation execution' });
  });
});

describe('POST /api/automation-executions/[executionId]/actions/[actionIndex]/retry', () => {
  function retryRoute(executionId = 'exec-1', actionIndex = '0') {
    return retryAction(retryRequest(executionId, actionIndex), {
      params: Promise.resolve({ executionId, actionIndex }),
    });
  }

  it('returns the new action and execution state', async () => {
    const response = await retryRoute('exec-1', '0');
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body).toEqual({
      executionId: 'exec-1',
      actionIndex: 0,
      actionStatus: 'pending',
      executionStatus: 'awaiting_actions',
    });
    expect(mockedRetry).toHaveBeenCalledWith('exec-1', 0);
  });

  it('coerces the action index from the path', async () => {
    await retryRoute('exec-1', '3');

    expect(mockedRetry).toHaveBeenCalledWith('exec-1', 3);
  });

  it('does not read a request body to influence the operation', async () => {
    const request = new NextRequest(
      'http://localhost/api/automation-executions/exec-1/actions/0/retry',
      {
        method: 'POST',
        body: JSON.stringify({ actionIndex: 9, workspaceId: 'someone-elses' }),
        headers: { 'content-type': 'application/json' },
        signal: undefined,
      },
    );

    const response = await retryAction(request, {
      params: Promise.resolve({ executionId: 'exec-1', actionIndex: '0' }),
    });

    expect(response.status).toBe(200);
    expect(mockedRetry).toHaveBeenCalledWith('exec-1', 0);
  });

  it.each([
    ['a negative action index', '-1'],
    ['a fractional action index', '1.5'],
    ['a non-numeric action index', 'first'],
    ['an out-of-range action index', '1001'],
  ])('returns 400 for %s', async (_label, actionIndex) => {
    const response = await retryRoute('exec-1', actionIndex);

    expect(response.status).toBe(400);
    expect(mockedRetry).not.toHaveBeenCalled();
  });

  it('returns 400 for an empty execution id', async () => {
    const response = await retryAction(retryRequest('', '0'), {
      params: Promise.resolve({ executionId: '', actionIndex: '0' }),
    });

    expect(response.status).toBe(400);
    expect(mockedRetry).not.toHaveBeenCalled();
  });

  it('returns 401 when there is no authenticated membership', async () => {
    mockedRetry.mockRejectedValueOnce(new UnauthorizedError('No session'));

    const response = await retryRoute();

    expect(response.status).toBe(401);
    expect(await response.json()).toEqual({ error: 'Unauthorized' });
  });

  it('returns 403 for a workspace member', async () => {
    mockedRetry.mockRejectedValueOnce(new ForbiddenError('Only workspace owners can do this'));

    const response = await retryRoute();

    expect(response.status).toBe(403);
    expect(await response.json()).toEqual({ error: 'Forbidden' });
  });

  it('returns 404 when the execution is unknown or owned by another workspace', async () => {
    mockedRetry.mockRejectedValueOnce(new ExecutionNotFoundError());

    const response = await retryRoute('someone-elses', '0');
    const body = await response.json();

    expect(response.status).toBe(404);
    expect(body.code).toBe('ExecutionNotFoundError');
  });

  it('returns 404 when the action does not exist', async () => {
    mockedRetry.mockRejectedValueOnce(new ActionNotFoundError());

    const response = await retryRoute('exec-1', '7');
    const body = await response.json();


    expect(response.status).toBe(404);
    expect(body.code).toBe('ActionNotFoundError');
  });

  describe('404 response safety', () => {
    // Attacker-controlled path segments must never be reflected back in an
    // error body, otherwise a 404 turns into a reflected-XSS sink.
    const hostileExecutionId = '<script>alert("xss")</script>';
    const hostileActionIndex = '999';

    it('does not echo the execution id when the execution is not found', async () => {
      mockedRetry.mockRejectedValueOnce(new ExecutionNotFoundError());

      const response = await retryRoute(hostileExecutionId, hostileActionIndex);
      const serialized = await response.text();

      expect(response.status).toBe(404);
      expect(serialized).not.toContain(hostileExecutionId);
      expect(serialized).not.toContain('script');
      expect(serialized).not.toContain(hostileActionIndex);
      expect(JSON.parse(serialized)).toEqual({
        error: 'Automation execution not found',
        code: 'ExecutionNotFoundError',
      });
    });

    it('does not echo the execution id or action index when the action is not found', async () => {
      mockedRetry.mockRejectedValueOnce(new ActionNotFoundError());

      const response = await retryRoute(hostileExecutionId, hostileActionIndex);
      const serialized = await response.text();

      expect(response.status).toBe(404);
      expect(serialized).not.toContain(hostileExecutionId);
      expect(serialized).not.toContain('script');
      expect(serialized).not.toContain(hostileActionIndex);
      expect(JSON.parse(serialized)).toEqual({
        error: 'Automation action execution not found',
        code: 'ActionNotFoundError',
      });
    });

    it('does not echo them for a 409 either', async () => {
      mockedRetry.mockRejectedValueOnce(
        new ExecutionNotRetryableError('Only the final automation action can be retried'),
      );

      const response = await retryRoute(hostileExecutionId, hostileActionIndex);
      const serialized = await response.text();

      expect(response.status).toBe(409);
      expect(serialized).not.toContain(hostileExecutionId);
      expect(serialized).not.toContain('script');
      expect(serialized).not.toContain(hostileActionIndex);
    });
  });

  it('returns 409 when the action is not retryable', async () => {
    mockedRetry.mockRejectedValueOnce(
      new ExecutionNotRetryableError('Only the final automation action can be retried'),
    );

    const response = await retryRoute('exec-1', '0');
    const body = await response.json();

    expect(response.status).toBe(409);
    expect(body.code).toBe('ExecutionNotRetryableError');
  });

  it('returns 409 when a concurrent retry already won', async () => {
    mockedRetry.mockRejectedValueOnce(new ExecutionRetryConflictError());

    const response = await retryRoute('exec-1', '0');
    const body = await response.json();

    expect(response.status).toBe(409);
    expect(body.code).toBe('ExecutionRetryConflictError');
  });

  it('returns a generic 500 for unexpected failures', async () => {
    mockedRetry.mockRejectedValueOnce(new Error('database exploded'));

    const response = await retryRoute();
    const body = await response.json();

    expect(response.status).toBe(500);
    expect(body).toEqual({ error: 'Failed to retry automation action', code: 'RetryFailed' });
  });
});
