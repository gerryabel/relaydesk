import { prisma as defaultPrisma } from '@/lib/db/prisma';
import { z } from 'zod';
import {
  DEFAULT_SLA_POLICIES_MINUTES,
  minutesToMs,
  type TicketPriority,
} from '@/lib/tickets/sla';
import { assertWorkspaceOwner, getCurrentMembership } from './server';
import type { PrismaClient, Prisma } from '@/generated/prisma';

export const ALL_PRIORITIES: readonly TicketPriority[] = ['low', 'medium', 'high', 'urgent'];

export const MAX_SLA_MINUTES = 525600;

const singlePolicySchema = z.object({
  priority: z.enum(['low', 'medium', 'high', 'urgent']),
  responseMinutes: z
    .number({ error: 'Response minutes must be a number' })
    .int('Response minutes must be an integer')
    .min(1, 'Response minutes must be at least 1')
    .max(MAX_SLA_MINUTES, `Response minutes cannot exceed ${MAX_SLA_MINUTES}`),
  resolutionMinutes: z
    .number({ error: 'Resolution minutes must be a number' })
    .int('Resolution minutes must be an integer')
    .min(1, 'Resolution minutes must be at least 1')
    .max(MAX_SLA_MINUTES, `Resolution minutes cannot exceed ${MAX_SLA_MINUTES}`),
});

export const slaPolicyInputSchema = z
  .array(singlePolicySchema)
  .length(4, 'Exactly four SLA policies are required')
  .superRefine((policies, ctx) => {
    const seen = new Set<TicketPriority>();
    for (const policy of policies) {
      if (seen.has(policy.priority)) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: `Duplicate priority: ${policy.priority}`,
        });
      }
      seen.add(policy.priority);
    }
    for (const required of ALL_PRIORITIES) {
      if (!seen.has(required)) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: `Missing priority: ${required}`,
        });
      }
    }
  });

export type SlaPolicyInput = z.infer<typeof slaPolicyInputSchema>;

export type WorkspaceSlaPolicyRow = {
  priority: TicketPriority;
  responseMinutes: number;
  resolutionMinutes: number;
};

export class SlaPolicyNotFoundError extends Error {
  constructor(priority: TicketPriority, workspaceId: string) {
    super(`SLA policy for priority "${priority}" is not configured for workspace ${workspaceId}.`);
    this.name = 'SlaPolicyNotFoundError';
  }
}

export class SlaPolicyInvariantError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'SlaPolicyInvariantError';
  }
}

function sortByPriorityOrder(policies: WorkspaceSlaPolicyRow[]): WorkspaceSlaPolicyRow[] {
  const order: Record<TicketPriority, number> = { low: 0, medium: 1, high: 2, urgent: 3 };
  return [...policies].sort((a, b) => order[a.priority] - order[b.priority]);
}

/**
 * Returns all four SLA policies for the authenticated user's workspace.
 *
 * The workspace is resolved server-side from the membership — no client
 * identifier is trusted. If the persisted policy data is missing or
 * structurally invalid (not exactly one row per priority), this throws a
 * clear invariant error. It never silently falls back to hard-coded
 * defaults: missing policy data is a configuration error, not a defaulting
 * opportunity.
 */
export async function getWorkspaceSlaPolicies(): Promise<WorkspaceSlaPolicyRow[]> {
  const membership = await getCurrentMembership();

  const policies = await defaultPrisma.workspaceSlaPolicy.findMany({
    where: { workspaceId: membership.workspaceId },
    select: { priority: true, responseMinutes: true, resolutionMinutes: true },
  });

  return assertCompletePolicySet(policies, membership.workspaceId);
}

/**
 * Updates all four workspace SLA policies atomically inside a single
 * transaction. Authorization is OWNER-ONLY. A partial update must never
 * leave a mixed configuration.
 */
export async function updateWorkspaceSlaPolicies(
  input: SlaPolicyInput,
): Promise<WorkspaceSlaPolicyRow[]> {
  const parsed = slaPolicyInputSchema.parse(input);
  const membership = await assertWorkspaceOwner();

  const updated = await defaultPrisma.$transaction(async (tx) => {
    const results: WorkspaceSlaPolicyRow[] = [];
    for (const policy of parsed) {
      const row = await tx.workspaceSlaPolicy.update({
        where: {
          workspaceId_priority: {
            workspaceId: membership.workspaceId,
            priority: policy.priority,
          },
        },
        data: {
          responseMinutes: policy.responseMinutes,
          resolutionMinutes: policy.resolutionMinutes,
        },
        select: { priority: true, responseMinutes: true, resolutionMinutes: true },
      });
      results.push(row);
    }
    return results;
  });

  return sortByPriorityOrder(updated);
}

/**
 * Reads a single workspace SLA policy for use during ticket creation.
 *
 * The `db` argument accepts the same Prisma client/transaction used to
 * create the ticket, so the policy read and ticket insert share one atomic
 * unit. If the policy row is missing, this throws a
 * configuration/invariant error — it never falls back to hard-coded
 * defaults.
 */
export async function getWorkspaceSlaPolicy(
  db: PrismaClient | Prisma.TransactionClient,
  workspaceId: string,
  priority: TicketPriority,
): Promise<WorkspaceSlaPolicyRow> {
  const row = await db.workspaceSlaPolicy.findUnique({
    where: {
      workspaceId_priority: {
        workspaceId,
        priority,
      },
    },
  });

  if (!row) {
    throw new SlaPolicyNotFoundError(priority, workspaceId);
  }

  return row;
}

function assertCompletePolicySet(
  policies: WorkspaceSlaPolicyRow[],
  workspaceId: string,
): WorkspaceSlaPolicyRow[] {
  if (policies.length !== ALL_PRIORITIES.length) {
    throw new SlaPolicyInvariantError(
      `Workspace ${workspaceId} has ${policies.length} SLA policies but ${ALL_PRIORITIES.length} are required.`,
    );
  }

  const found = new Set(policies.map((policy) => policy.priority));
  for (const required of ALL_PRIORITIES) {
    if (!found.has(required)) {
      throw new SlaPolicyInvariantError(
        `Workspace ${workspaceId} is missing SLA policy for priority "${required}".`,
      );
    }
  }

  return sortByPriorityOrder(policies);
}

/**
 * Builds the data payload for provisioning a new workspace with the four
 * canonical default SLA policy rows. Reused by ensureDefaultWorkspace so the
 * application-level default definition is the single source of truth.
 */
export function buildDefaultSlaPolicyData(
  workspaceId: string,
): Array<{ id: string; workspaceId: string; priority: TicketPriority; responseMinutes: number; resolutionMinutes: number }> {
  return ALL_PRIORITIES.map((priority, index) => {
    const defaults = DEFAULT_SLA_POLICIES_MINUTES[priority];
    return {
      id: `sla_${workspaceId}_${index}_${priority}`,
      workspaceId,
      priority,
      responseMinutes: defaults.responseMinutes,
      resolutionMinutes: defaults.resolutionMinutes,
    };
  });
}

export function toResponseDeadlineMs(row: WorkspaceSlaPolicyRow): number {
  return minutesToMs(row.responseMinutes);
}

export function toResolutionDeadlineMs(row: WorkspaceSlaPolicyRow): number {
  return minutesToMs(row.resolutionMinutes);
}
