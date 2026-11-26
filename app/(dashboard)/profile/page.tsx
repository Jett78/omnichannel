import { redirect } from "next/navigation";

import { PageHeader } from "@/components/layout/page-header";
import { ProfileForms } from "@/features/profile/profile-forms";
import { getActiveWorkspace } from "@/lib/active-workspace";
import { getCurrentUser } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { workspaceService } from "@/services/workspace.service";

/**
 * Dedicated profile page (Jeet, 2026-11-26) — until now the account
 * menu's "Profile" pointed at /settings, which only showed a
 * read-only summary. Personal info, workspace memberships, password
 * and sessions live here; /settings keeps workspace-level config.
 */
export default async function ProfilePage() {
  const user = await getCurrentUser();
  if (!user) redirect("/api/session-expired");

  const [active, workspaces, userRow] = await Promise.all([
    getActiveWorkspace(user.id),
    workspaceService.listWorkspacesForUser(user.id),
    prisma.user.findUnique({ where: { id: user.id }, select: { createdAt: true } }),
  ]);

  const memberSinceLabel = userRow
    ? new Intl.DateTimeFormat("en-GB", {
        day: "numeric",
        month: "long",
        year: "numeric",
        timeZone: active?.timezone ?? "Asia/Kathmandu",
      }).format(userRow.createdAt)
    : "—";

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title="Profile"
        description="Your personal account — name, workspaces, password and sessions."
      />
      <ProfileForms
        user={{
          name: user.name,
          email: user.email,
          image: user.image ?? null,
          emailVerified: user.emailVerified,
        }}
        memberSinceLabel={memberSinceLabel}
        workspaces={workspaces.map((workspace) => ({
          id: workspace.id,
          name: workspace.name,
          slug: workspace.slug,
          role: workspace.members[0]?.role ?? null,
          isActive: workspace.id === active?.id,
        }))}
      />
    </div>
  );
}
