'use server';

import { revalidatePath } from 'next/cache';
import { ForbiddenError, UnauthorizedError } from '@/lib/workspace/server';
import {
  getMemberById,
  getMembers,
  updateMemberRole,
  MemberNotFoundError,
  MemberNotInWorkspaceError,
  CannotDemoteLastOwnerError,
  InvalidRoleChangeError,
} from './server';
import { updateMemberRoleSchema, type UpdateMemberRoleInput } from './schema';

export async function getMembersAction() {
  try {
    const members = await getMembers();
    return { data: members };
  } catch (error) {
    if (error instanceof ForbiddenError || error instanceof UnauthorizedError) {
      return { error: 'Unauthorized' };
    }
    return { error: 'Failed to load members' };
  }
}

export async function getMemberByIdAction(membershipId: string) {
  try {
    const member = await getMemberById(membershipId);
    return { data: member };
  } catch (error) {
    if (error instanceof MemberNotFoundError || error instanceof MemberNotInWorkspaceError) {
      return { error: 'Member not found' };
    }
    if (error instanceof ForbiddenError || error instanceof UnauthorizedError) {
      return { error: 'Unauthorized' };
    }
    return { error: 'Failed to load member' };
  }
}

export async function updateMemberRoleAction(membershipId: string, input: UpdateMemberRoleInput) {
  const parsed = updateMemberRoleSchema.safeParse(input);
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? 'Invalid role data' };
  }

  try {
    const member = await updateMemberRole(membershipId, parsed.data);
    revalidatePath('/dashboard/members');
    return { data: member };
  } catch (error) {
    if (error instanceof ForbiddenError) {
      return { error: 'Forbidden' };
    }
    if (error instanceof UnauthorizedError) {
      return { error: 'Unauthorized' };
    }
    if (error instanceof MemberNotFoundError) {
      return { error: 'Member not found' };
    }
    if (error instanceof MemberNotInWorkspaceError) {
      return { error: 'Member is not in this workspace' };
    }
    if (error instanceof CannotDemoteLastOwnerError) {
      return { error: error.message };
    }
    if (error instanceof InvalidRoleChangeError) {
      return { error: error.message };
    }
    return { error: 'Failed to update member role' };
  }
}
