import { redirect } from "next/navigation";

import { PageHeader } from "@/components/layout/page-header";
import { TeamManagement } from "@/features/team/team-management";
import { getActiveWorkspace } from "@/lib/active-workspace";
import { getCurrentUser } from "@/lib/auth";
import { hasPermission } from "@/lib/permissions";
import { workspaceService } from "@/services/workspace.service";

export default async function TeamPage() {
  const user = await getCurrentUser();
  if (!user) redirect("/api/session-expired");

  const active = await getActiveWorkspace(user.id);
  if (!active) redirect("/onboarding");

  const [members, teams] = await Promise.all([
    workspaceService.listMembers(user.id, active.id),
    workspaceService.listTeams(user.id, active.id),
  ]);
  const currentMember = members.find((m) => m.user.id === user.id);
  if (!currentMember) redirect("/onboarding");

  // Pending invitations are only visible to members who can invite.
  const invitations = hasPermission(currentMember.role, "members.invite")
    ? await workspaceService.listInvitations(user.id, active.id).catch(() => [])
    : [];

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title="Team"
        description={`Members, roles and teams for ${active.name}. Invitations are sent by email with a 7-day accept link.`}
      />
      <TeamManagement
        workspaceId={active.id}
        workspaceName={active.name}
        members={members.map((m) => ({
          id: m.id,
          role: m.role,
          user: m.user,
          team: m.team,
          joinedLabel: m.createdAt.toLocaleDateString("en-GB", {
            day: "numeric",
            month: "short",
            year: "numeric",
          }),
        }))}
        teams={teams.map((t) => ({
          id: t.id,
          name: t.name,
          description: t.description,
          memberCount: t._count.members,
        }))}
        invitations={invitations.map((invitation) => ({
          id: invitation.id,
          email: invitation.email,
          role: invitation.role,
          invitedByName: invitation.invitedBy?.name ?? "A teammate",
          expiresLabel: invitation.expiresAt.toLocaleDateString("en-GB", {
            day: "numeric",
            month: "short",
            year: "numeric",
          }),
        }))}
        currentUserId={user.id}
        currentRole={currentMember.role}
      />
    </div>
  );
}
