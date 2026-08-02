import { prisma } from '@/lib/db/prisma';
import type { Prisma } from '@/generated/prisma';

const DEFAULT_WORKSPACE_NAME = 'My Workspace';

type MembershipWithWorkspace = Prisma.MembershipGetPayload<{
  include: {
    workspace: true;
  };
}>;

export async function ensureDefaultWorkspace(userId: string): Promise<MembershipWithWorkspace> {
  const existing = await loadMembership(userId);

  if (existing) {
    return existing;
  }

  try {
    return await prisma.$transaction(async (tx) => {
      const workspace = await tx.workspace.create({
        data: {
          name: await computeWorkspaceName(userId),
        },
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
  } catch (rawError) {
    const error = rawError instanceof Error ? rawError : new Error(String(rawError));

    if (isUniqueMembershipError(error)) {
      const membership = await loadMembership(userId);

      if (membership) {
        return membership;
      }
    }

    console.error('Failed to provision default workspace', error);
    throw new Error('Gagal menyiapkan workspace default.');
  }
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
