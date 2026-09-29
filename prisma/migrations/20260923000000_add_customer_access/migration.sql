-- Phase 9 Task 1: Customer Access Foundation
-- Adds the public workspace slug plus the customer magic-link and customer
-- session models. Customers remain outside the Better Auth User/Membership
-- authorization domain.

-- ─────────────────────────────────────────────────────────────────────────────
-- Workspace: public identifier for customer portal routing
-- ─────────────────────────────────────────────────────────────────────────────

-- 1. Add the column as nullable first so existing rows can be backfilled.
ALTER TABLE "Workspace" ADD COLUMN "slug" TEXT;

-- 2. Backfill deterministically from the workspace name.
--
-- This mirrors `buildWorkspaceSlugBase` / `truncateWithSuffix` in
-- src/lib/workspace/slug.ts exactly:
--   trim -> lower -> runs of non [a-z0-9] become '-' -> strip leading and
--   trailing '-' -> take first 48 chars -> strip a trailing '-' left by that
--   truncation -> fall back to 'workspace' if nothing remains.
--
-- Collision suffixes reserve room within the 48-char cap rather than growing
-- past it, matching `truncateWithSuffix`.
--
-- Collisions are resolved by appending -2, -3, ... in a stable order
-- (createdAt ASC, id ASC) so the same input database always produces the same
-- slugs.
DO $$
DECLARE
  ws          RECORD;
  base_slug   TEXT;
  candidate   TEXT;
  suffix      TEXT;
  attempt     INT;
BEGIN
  FOR ws IN SELECT "id", "name" FROM "Workspace" ORDER BY "createdAt" ASC, "id" ASC LOOP
    base_slug := COALESCE(
      NULLIF(
        regexp_replace(
          LEFT(
            regexp_replace(
              regexp_replace(
                regexp_replace(LOWER(btrim(ws."name")), '[^a-z0-9]+', '-', 'g'),
                '^-+', '', 'g'
              ),
              '-+$', '', 'g'
            ),
            48
          ),
          '-+$', '', 'g'
        ),
        ''
      ),
      'workspace'
    );

    candidate := base_slug;
    attempt := 2;

    WHILE EXISTS (SELECT 1 FROM "Workspace" w WHERE w."slug" = candidate) LOOP
      suffix := attempt::TEXT;
      candidate := LEFT(base_slug, GREATEST(1, 48 - LENGTH(suffix) - 1)) || '-' || suffix;
      attempt := attempt + 1;
    END LOOP;

    UPDATE "Workspace" SET "slug" = candidate WHERE "id" = ws."id";
  END LOOP;
END $$;

-- 3. Enforce NOT NULL + global uniqueness.
ALTER TABLE "Workspace" ALTER COLUMN "slug" SET NOT NULL;

CREATE UNIQUE INDEX "Workspace_slug_key" ON "Workspace"("slug");

-- ─────────────────────────────────────────────────────────────────────────────
-- CustomerMagicLink: single-use passwordless access token
-- ─────────────────────────────────────────────────────────────────────────────

CREATE TABLE "CustomerMagicLink" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "customerId" TEXT NOT NULL,
    "tokenHash" TEXT NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "consumedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "CustomerMagicLink_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "CustomerMagicLink_tokenHash_key" ON "CustomerMagicLink"("tokenHash");

CREATE INDEX "CustomerMagicLink_customerId_createdAt_idx" ON "CustomerMagicLink"("customerId", "createdAt");

CREATE INDEX "CustomerMagicLink_workspaceId_createdAt_idx" ON "CustomerMagicLink"("workspaceId", "createdAt");

CREATE INDEX "CustomerMagicLink_expiresAt_idx" ON "CustomerMagicLink"("expiresAt");

ALTER TABLE "CustomerMagicLink" ADD CONSTRAINT "CustomerMagicLink_workspaceId_fkey"
  FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id")
  ON DELETE CASCADE
  ON UPDATE CASCADE;

ALTER TABLE "CustomerMagicLink" ADD CONSTRAINT "CustomerMagicLink_customerId_fkey"
  FOREIGN KEY ("customerId") REFERENCES "Customer"("id")
  ON DELETE CASCADE
  ON UPDATE CASCADE;

-- ─────────────────────────────────────────────────────────────────────────────
-- CustomerSession: opaque, revocable customer portal session
-- ─────────────────────────────────────────────────────────────────────────────

CREATE TABLE "CustomerSession" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "customerId" TEXT NOT NULL,
    "tokenHash" TEXT NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "revokedAt" TIMESTAMP(3),
    "lastUsedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "CustomerSession_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "CustomerSession_tokenHash_key" ON "CustomerSession"("tokenHash");

CREATE INDEX "CustomerSession_customerId_createdAt_idx" ON "CustomerSession"("customerId", "createdAt");

CREATE INDEX "CustomerSession_workspaceId_createdAt_idx" ON "CustomerSession"("workspaceId", "createdAt");

CREATE INDEX "CustomerSession_expiresAt_idx" ON "CustomerSession"("expiresAt");

ALTER TABLE "CustomerSession" ADD CONSTRAINT "CustomerSession_workspaceId_fkey"
  FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id")
  ON DELETE CASCADE
  ON UPDATE CASCADE;

ALTER TABLE "CustomerSession" ADD CONSTRAINT "CustomerSession_customerId_fkey"
  FOREIGN KEY ("customerId") REFERENCES "Customer"("id")
  ON DELETE CASCADE
  ON UPDATE CASCADE;
