import { prisma } from '@/lib/db/prisma';
import { z } from 'zod';
import { assertWorkspaceOwner, getCurrentMembership } from './server';

export const MAX_WORKSPACE_NAME_LENGTH = 100;

export const workspaceNameSchema = z
  .object({
    name: z
      .string({ error: 'Workspace name is required' })
      .trim()
      .min(1, 'Workspace name cannot be empty')
      .max(
        MAX_WORKSPACE_NAME_LENGTH,
        `Workspace name cannot exceed ${MAX_WORKSPACE_NAME_LENGTH} characters`,
      ),
  })
  .transform((input) => ({ name: input.name.trim() }));

export type WorkspaceNameInput = z.infer<typeof workspaceNameSchema>;

export type WorkspaceSettings = {
  id: string;
  name: string;
};

/**
 * Returns the current workspace's settings for the authenticated user's
 * membership. The workspace is resolved server-side from the session —
 * no client-supplied workspace identifier is trusted.
 */
export async function getWorkspaceSettings(): Promise<WorkspaceSettings> {
  const membership = await getCurrentMembership();

  const workspace = await prisma.workspace.findUnique({
    where: { id: membership.workspaceId },
    select: { id: true, name: true },
  });

  if (!workspace) {
    throw new Error('Workspace not found');
  }

  return { id: workspace.id, name: workspace.name };
}

/**
 * Updates the current workspace's name.
 *
 * Authorization: OWNER-ONLY via assertWorkspaceOwner().
 * The workspace is resolved server-side from the authenticated user's
 * membership — a client cannot target another workspace.
 *
 * Throws:
 *  - UnauthorizedError when there is no authenticated session.
 *  - ForbiddenError when the caller is not the workspace owner or has no
 *    workspace membership.
 */
export async function updateWorkspaceName(
  input: WorkspaceNameInput,
): Promise<WorkspaceSettings> {
  const parsed = workspaceNameSchema.parse(input);
  const membership = await assertWorkspaceOwner();

  const workspace = await prisma.workspace.update({
    where: { id: membership.workspaceId },
    data: { name: parsed.name },
    select: { id: true, name: true },
  });

  return { id: workspace.id, name: workspace.name };
}
