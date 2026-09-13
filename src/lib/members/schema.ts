import { z } from 'zod';

export const memberRoleSchema = z.enum(['owner', 'member']);

export type MemberRole = z.infer<typeof memberRoleSchema>;

export const updateMemberRoleSchema = z.object({
  role: memberRoleSchema,
});

export type UpdateMemberRoleInput = z.infer<typeof updateMemberRoleSchema>;
