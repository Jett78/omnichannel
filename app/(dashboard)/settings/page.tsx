import { BadgeCheck, TriangleAlert } from "lucide-react";
import Link from "next/link";
import { redirect } from "next/navigation";

import { AvatarWithBadge } from "@/components/avatar-with-badge";
import { PageHeader } from "@/components/layout/page-header";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { NotificationPreferences } from "@/features/settings/notification-preferences";
import { WorkspaceSettings } from "@/features/settings/workspace-settings";
import { TeamManagement } from "@/features/team/team-management";
import { getActiveWorkspace } from "@/lib/active-workspace";
import { getCurrentUser } from "@/lib/auth";
import { hasPermission } from "@/lib/permissions";
import { workspaceService } from "@/services/workspace.service";

export default async function SettingsPage() {
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

  const invitations = hasPermission(currentMember.role, "members.invite")
    ? await workspaceService.listInvitations(user.id, active.id).catch(() => [])
    : [];

  return (
    <div className="flex max-w-4xl flex-col gap-6">
      <PageHeader
        title="Settings"
        description={`Profile, workspace, team and preferences for ${active.name}.`}
      />

      <Card>
        <CardHeader>
          <CardTitle>Profile</CardTitle>
          <CardDescription>Your account across every workspace you belong to.</CardDescription>
        </CardHeader>
        <CardContent>
          <div className="flex flex-wrap items-center gap-4">
            <AvatarWithBadge name={user.name || user.email} image={user.image} size="lg" />
            <div className="min-w-0 flex-1 leading-tight">
              <p className="flex flex-wrap items-center gap-2 font-medium">
                {user.name}
                {user.emailVerified ? (
                  <Badge variant="success">
                    <BadgeCheck className="size-3" /> Email verified
                  </Badge>
                ) : (
                  <Badge variant="warning">Email not verified</Badge>
                )}
              </p>
              <p className="text-muted-foreground truncate text-sm">{user.email}</p>
            </div>
            {!user.emailVerified ? (
              <Button variant="outline" size="sm" asChild>
                <Link href="/verify-email">Verify email</Link>
              </Button>
            ) : null}
          </div>
        </CardContent>
      </Card>

      <WorkspaceSettings
        workspace={{
          id: active.id,
          name: active.name,
          slug: active.slug,
          timezone: active.timezone,
        }}
        currentRole={currentMember.role}
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

      <NotificationPreferences />

      <Card className="border-destructive/40">
        <CardHeader>
          <CardTitle className="text-destructive flex items-center gap-2">
            <TriangleAlert className="size-4" /> Danger zone
          </CardTitle>
          <CardDescription>
            Deleting a workspace permanently removes its channels, contacts and conversations.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <Button variant="destructive" disabled>
            Delete workspace
          </Button>
          <p className="text-muted-foreground mt-2 text-xs">
            Workspace deletion is disabled in this phase — it arrives with a typed-confirmation flow
            and a data-export option.
          </p>
        </CardContent>
      </Card>
    </div>
  );
}
