import { prisma } from '@/lib/db/prisma';
import { assertWorkspaceOwner, getCurrentMembership } from '@/lib/workspace/server';
import { updateMemberRoleSchema, type UpdateMemberRoleInput } from './schema';

const MAX_SERIAL_RETRIES = 3;
const RETRY_BASE_MS = 25;

function isTransactionConflictError(error: unknown): boolean {
  if (!error || typeof error !== 'object') return false;
  const code = (error as { code?: unknown }).code;
  if (code === 'P2034') return true;
  const meta = (error as { meta?: { code?: unknown } }).meta;
  if (meta && meta.code === 'P2034') return true;
  const message = (error as { message?: unknown }).message;
  return typeof message === 'string' && message.includes('P2034');
}

async function executeWithRetry<T>(operation: () => Promise<T>): Promise<T> {
  let attempt = 0;

  for (;;) {
    try {
      return await operation();
    } catch (error) {
      const isLastAttempt = attempt >= MAX_SERIAL_RETRIES;
      if (isLastAttempt || !isTransactionConflictError(error)) {
        throw error;
      }

      const delay = RETRY_BASE_MS * 2 ** attempt + Math.floor(Math.random() * RETRY_BASE_MS);
      await new Promise((resolve) => setTimeout(resolve, delay));
      attempt += 1;
    }
  }
}

export class MemberNotFoundError extends Error {
  constructor(message = 'Member tidak ditemukan di workspace ini.') {
    super(message);
    this.name = 'MemberNotFoundError';
  }
}

export class MemberNotInWorkspaceError extends Error {
  constructor(message = 'Member bukan bagian dari workspace ini.') {
    super(message);
    this.name = 'MemberNotInWorkspaceError';
  }
}

export class CannotDemoteLastOwnerError extends Error {
  constructor(message = 'Tidak dapat mengubah role owner terakhir. Workspace harus memiliki minimal satu owner.') {
    super(message);
    this.name = 'CannotDemoteLastOwnerError';
  }
}

export class InvalidRoleChangeError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'InvalidRoleChangeError';
  }
}

export type MemberRole = 'owner' | 'member';

export type MemberDetail = {
  membershipId: string;
  userId: string;
  name: string;
  email: string;
  image: string | null;
  role: MemberRole;
  joinedAt: string;
  isAssignable: boolean;
};

async function getMembershipWithUser(membershipId: string) {
  return prisma.membership.findUnique({
    where: { id: membershipId },
    include: { user: true },
  });
}

function toMemberDetail(membershipId: string, role: MemberRole, joinedAt: string) {
  return (user: { id: string; name: string; email: string; image: string | null }): MemberDetail => ({
    membershipId,
    userId: user.id,
    name: user.name,
    email: user.email,
    image: user.image,
    role,
    joinedAt,
    isAssignable: true,
  });
}

/**
 * Lists all members of the current workspace with their roles and
 * assignment eligibility.
 *
 * Assignment eligibility derives from the existing domain rule: any
 * workspace member is assignable to tickets. No separate availability
 * or presence model exists or is introduced.
 */
export async function getMembers(): Promise<MemberDetail[]> {
  const membership = await getCurrentMembership();

  const rows = await prisma.membership.findMany({
    where: { workspaceId: membership.workspaceId },
    include: {
      user: {
        select: { id: true, name: true, email: true, image: true },
      },
    },
    orderBy: { user: { name: 'asc' } },
  });

  return rows.map((row) =>
    toMemberDetail(row.id, row.role as MemberRole, row.createdAt.toISOString())(row.user),
  );
}

/**
 * Returns a single member of the current workspace.
 *
 * Throws MemberNotInWorkspaceError when the given membership id does not
 * belong to the current workspace. This preserves workspace isolation.
 */
export async function getMemberById(membershipId: string): Promise<MemberDetail> {
  const current = await getCurrentMembership();
  const row = await getMembershipWithUser(membershipId);

  if (!row || row.workspaceId !== current.workspaceId) {
    throw new MemberNotInWorkspaceError();
  }

  return toMemberDetail(row.id, row.role as MemberRole, row.createdAt.toISOString())(row.user);
}

/**
 * Updates a member's workspace role.
 *
 * Authorization:
 *   - Requires the caller to be a workspace owner.
 *
 * Invariants:
 *   - WorkspaceRole is restricted to owner | member (validated by schema).
 *   - A role cannot be changed to the same value (no-op).
 *   - Demoting the last owner is rejected. The owner-count check and the
 *     role update run inside a single SERIALIZABLE transaction, and any
 *     PostgreSQL serialization conflict (Prisma P2034) is retried by
 *     executeWithRetry(). Serializable isolation plus conflict retry is
 *     what guarantees the invariant under concurrency: two concurrent
 *     demotions cannot both commit and leave the workspace ownerless.
 *
 * Throws:
 *   - ForbiddenError (via assertWorkspaceOwner) when caller is not owner.
 *   - MemberNotInWorkspaceError when target is not in current workspace.
 *   - MemberNotFoundError when the target membership id does not exist.
 *   - InvalidRoleChangeError when the new role equals the current one.
 *   - CannotDemoteLastOwnerError when the change would leave the
 *     workspace ownerless.
 */
export async function updateMemberRole(
  membershipId: string,
  input: UpdateMemberRoleInput,
): Promise<MemberDetail> {
  const parsed = updateMemberRoleSchema.parse(input);
  await assertWorkspaceOwner();

  const target = await prisma.membership.findUnique({
    where: { id: membershipId },
  });

  if (!target) {
    throw new MemberNotFoundError();
  }

  const current = await getCurrentMembership();
  if (target.workspaceId !== current.workspaceId) {
    throw new MemberNotInWorkspaceError();
  }

  if (target.role === parsed.role) {
    throw new InvalidRoleChangeError(`Member already has role: ${parsed.role}`);
  }

  // The role update runs in a SERIALIZABLE transaction with P2034 conflict
  // retry (executeWithRetry) regardless of whether the target role is owner
  // or member. Serializable isolation plus conflict retry is what protects
  // the last-owner invariant under concurrency.

  const updated = await executeWithRetry(() =>
    prisma.$transaction(
      async (tx) => {
        if (parsed.role === 'member') {
          const ownerCount = await tx.membership.count({
            where: { workspaceId: target.workspaceId, role: 'owner' },
          });

          if (ownerCount <= 1) {
            throw new CannotDemoteLastOwnerError();
          }
        }

        return tx.membership.update({
          where: { id: membershipId },
          data: { role: parsed.role },
          include: {
            user: {
              select: { id: true, name: true, email: true, image: true },
            },
          },
        });
      },
      { isolationLevel: 'Serializable' },
    ),
  );

  return toMemberDetail(
    updated.id,
    updated.role as MemberRole,
    updated.createdAt.toISOString(),
  )(updated.user);
}
