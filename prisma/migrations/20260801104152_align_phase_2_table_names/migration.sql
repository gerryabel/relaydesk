ALTER TABLE "workspaces" RENAME TO "Workspace";
ALTER TABLE "memberships" RENAME TO "Membership";
ALTER TABLE "tickets" RENAME TO "Ticket";
ALTER TABLE "messages" RENAME TO "Message";

ALTER TABLE "Workspace" RENAME CONSTRAINT "workspaces_pkey" TO "Workspace_pkey";
ALTER TABLE "Membership" RENAME CONSTRAINT "memberships_pkey" TO "Membership_pkey";
ALTER TABLE "Ticket" RENAME CONSTRAINT "tickets_pkey" TO "Ticket_pkey";
ALTER TABLE "Message" RENAME CONSTRAINT "messages_pkey" TO "Message_pkey";

ALTER INDEX "memberships_userId_key" RENAME TO "Membership_userId_key";
ALTER INDEX "memberships_workspaceId_idx" RENAME TO "Membership_workspaceId_idx";
ALTER INDEX "tickets_workspaceId_idx" RENAME TO "Ticket_workspaceId_idx";
ALTER INDEX "tickets_createdById_idx" RENAME TO "Ticket_createdById_idx";
ALTER INDEX "messages_ticketId_idx" RENAME TO "Message_ticketId_idx";
ALTER INDEX "messages_createdById_idx" RENAME TO "Message_createdById_idx";

ALTER TABLE "Membership" RENAME CONSTRAINT "memberships_userId_fkey" TO "Membership_userId_fkey";
ALTER TABLE "Membership" RENAME CONSTRAINT "memberships_workspaceId_fkey" TO "Membership_workspaceId_fkey";
ALTER TABLE "Ticket" RENAME CONSTRAINT "tickets_workspaceId_fkey" TO "Ticket_workspaceId_fkey";
ALTER TABLE "Ticket" RENAME CONSTRAINT "tickets_createdById_fkey" TO "Ticket_createdById_fkey";
ALTER TABLE "Message" RENAME CONSTRAINT "messages_ticketId_fkey" TO "Message_ticketId_fkey";
ALTER TABLE "Message" RENAME CONSTRAINT "messages_createdById_fkey" TO "Message_createdById_fkey";
