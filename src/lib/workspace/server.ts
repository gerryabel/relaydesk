import { prisma } from '@/lib/db/prisma';
import type { Prisma } from '@/generated/prisma';
import { getServerAuthSession } from '@/lib/auth/session';
import { buildDefaultSlaPolicyData } from '@/lib/workspace/sla-policy';
import { generateWorkspaceSlug } from '@/lib/workspace/slug';

const DEFAULT_WORKSPACE_NAME = 'My Workspace';

/** Bounded retries for name-derived workspace slug collisions. */
const WORKSPACE_SLUG_PROVISION_ATTEMPTS = 5;

type MembershipWithWorkspace = Prisma.MembershipGetPayload<{
  include: {
    workspace: true;
  };
}>;

export type MembershipInfo = MembershipWithWorkspace;

export class UnauthorizedError extends Error {
  constructor(message = 'Unauthorized') {
    super(message);
    this.name = 'UnauthorizedError';
  }
}

export class ForbiddenError extends Error {
  constructor(message = 'No workspace membership found') {
    super(message);
    this.name = 'ForbiddenError';
  }
}

export async function getCurrentMembership(): Promise<MembershipInfo> {
  const session = await getServerAuthSession();

  if (!session?.user?.id) {
    throw new UnauthorizedError('No authenticated session');
  }

  const membership = await prisma.membership.findUnique({
    where: { userId: session.user.id },
    include: { workspace: true },
  });

  if (!membership) {
    throw new ForbiddenError('No workspace membership found');
  }

  return membership as MembershipInfo;
}

export async function getCurrentWorkspace(): Promise<MembershipInfo['workspace']> {
  const membership = await getCurrentMembership();
  return membership.workspace;
}

/**
 * Verifies the current user is a workspace owner.
 *
 * Built on the existing WorkspaceRole model and getCurrentMembership().
 * Reusable by privileged Team Management and Workspace Settings operations.
 * Server-side only — never rely on this check being performed on the client.
 */
export async function assertWorkspaceOwner(): Promise<MembershipInfo> {
  const membership = await getCurrentMembership();

  if (membership.role !== 'owner') {
    throw new ForbiddenError('Only workspace owners can perform this action.');
  }

  return membership;
}

export type WorkspaceMember = {
  id: string;
  name: string;
  email: string;
  image: string | null;
  role: 'owner' | 'member';
  joinedAt: string;
  isAssignable: boolean;
};

export async function getWorkspaceMembers(): Promise<WorkspaceMember[]> {
  const membership = await getCurrentMembership();
  const members = await prisma.membership.findMany({
    where: {
      workspaceId: membership.workspaceId,
    },
    include: {
      user: {
        select: {
          id: true,
          name: true,
          email: true,
          image: true,
        },
      },
    },
    orderBy: {
      user: {
        name: 'asc',
      },
    },
  });

  return members.map((membership) => ({
    id: membership.user.id,
    name: membership.user.name,
    email: membership.user.email,
    image: membership.user.image,
    role: membership.role,
    joinedAt: membership.createdAt.toISOString(),
    isAssignable: true,
  }));
}

export async function ensureDefaultWorkspace(userId: string): Promise<MembershipWithWorkspace> {
  const existing = await loadMembership(userId);

  if (existing) {
    return existing;
  }

  try {
    for (let attempt = 0; attempt < WORKSPACE_SLUG_PROVISION_ATTEMPTS; attempt += 1) {
      try {
        return await provisionWorkspace(userId);
      } catch (rawError) {
        const error = rawError instanceof Error ? rawError : new Error(String(rawError));

        if (isUniqueMembershipError(error)) {
          const membership = await loadMembership(userId);

          if (membership) {
            return membership;
          }
        }

        // Two workspaces can race to claim the same name-derived slug. The
        // unique index rejects the loser; retry so provisioning picks the
        // next candidate instead of failing outright.
        if (isUniqueWorkspaceSlugError(error)) {
          continue;
        }

        throw error;
      }
    }

    throw new Error('Gagal menyiapkan workspace default.');
  } catch (error) {
    console.error('Failed to provision default workspace', error);
    throw new Error('Gagal menyiapkan workspace default.');
  }
}

async function provisionWorkspace(userId: string): Promise<MembershipWithWorkspace> {
  return prisma.$transaction(async (tx) => {
    const workspaceName = await computeWorkspaceName(userId);
    const slug = await generateWorkspaceSlug(tx, workspaceName);

    const workspace = await tx.workspace.create({
      data: {
        name: workspaceName,
        slug,
      },
    });

    await tx.workspaceSlaPolicy.createMany({
      data: buildDefaultSlaPolicyData(workspace.id),
    });

    return tx.membership.create({
      data: {
        userId,
        workspaceId: workspace.id,
        role: 'owner',
      },
      include: { workspace: true },
    });
  });
}

export async function getDefaultWorkspace(userId: string): Promise<MembershipWithWorkspace | null> {
  const membership = await loadMembership(userId);

  return membership;
}

async function loadMembership(userId: string): Promise<MembershipWithWorkspace | null> {
  const membership = await prisma.membership.findUnique({
    where: { userId },
    include: { workspace: true },
  });

  return membership;
}

async function computeWorkspaceName(userId: string): Promise<string> {
  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: { name: true },
  });

  const baseName = (user?.name?.trim() || 'My').slice(0, 90);
  const computed = `${baseName} Workspace`;

  return computed.length <= 100 ? computed : DEFAULT_WORKSPACE_NAME;
}

function isUniqueMembershipError(error: Error): boolean {
  const known = error as Error & {
    code?: string;
    meta?: { target?: string[]; modelName?: string };
    message?: string;
  };

  const hasUserIdTarget = Array.isArray(known.meta?.target) && known.meta.target.includes('userId');
  const hasMembershipModel = known.meta?.modelName === 'Membership';
  const messageMentionsUserId =
    typeof known.message === 'string' && known.message.toLowerCase().includes('userid');

  return known.code === 'P2002' && (hasUserIdTarget || hasMembershipModel || messageMentionsUserId);
}

function isUniqueWorkspaceSlugError(error: Error): boolean {
  const known = error as Error & {
    code?: string;
    meta?: { target?: string[]; modelName?: string };
    message?: string;
  };

  const hasSlugTarget = Array.isArray(known.meta?.target) && known.meta.target.includes('slug');
  const hasWorkspaceModel = known.meta?.modelName === 'Workspace';
  const messageMentionsSlug =
    typeof known.message === 'string' &&
    (known.message.includes('Workspace_slug_key') || known.message.toLowerCase().includes('slug'));

  return known.code === 'P2002' && (hasSlugTarget || hasWorkspaceModel || messageMentionsSlug);
}
