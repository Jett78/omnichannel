-- Chatwoot-style teams: many-to-many membership + allowAutoAssign flag.
-- Replaces WorkspaceMember.teamId (one team per member) with a
-- TeamMember join table (a member can be in several teams).

-- Team gains the auto-assign flag.
ALTER TABLE "Team" ADD COLUMN "allowAutoAssign" BOOLEAN NOT NULL DEFAULT true;

-- Join table.
CREATE TABLE "TeamMember" (
    "id" TEXT NOT NULL,
    "teamId" TEXT NOT NULL,
    "workspaceMemberId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "TeamMember_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "TeamMember_teamId_workspaceMemberId_key" ON "TeamMember"("teamId", "workspaceMemberId");
CREATE INDEX "TeamMember_workspaceMemberId_idx" ON "TeamMember"("workspaceMemberId");

ALTER TABLE "TeamMember" ADD CONSTRAINT "TeamMember_teamId_fkey" FOREIGN KEY ("teamId") REFERENCES "Team"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "TeamMember" ADD CONSTRAINT "TeamMember_workspaceMemberId_fkey" FOREIGN KEY ("workspaceMemberId") REFERENCES "WorkspaceMember"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Backfill existing single-team assignments.
INSERT INTO "TeamMember" ("id", "teamId", "workspaceMemberId", "createdAt")
SELECT 'tm_' || md5(random()::text || clock_timestamp()::text || "id"), "teamId", "id", CURRENT_TIMESTAMP
FROM "WorkspaceMember"
WHERE "teamId" IS NOT NULL;

-- Drop the old single-team column.
ALTER TABLE "WorkspaceMember" DROP CONSTRAINT IF EXISTS "WorkspaceMember_teamId_fkey";
DROP INDEX IF EXISTS "WorkspaceMember_teamId_idx";
ALTER TABLE "WorkspaceMember" DROP COLUMN "teamId";
