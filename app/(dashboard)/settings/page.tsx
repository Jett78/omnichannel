import { TriangleAlert } from "lucide-react";
import { redirect } from "next/navigation";

import { PageHeader } from "@/components/layout/page-header";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { DeleteWorkspace } from "@/features/settings/delete-workspace";
import { NotificationPreferences } from "@/features/settings/notification-preferences";
import { StoreConnectionCard } from "@/features/settings/store-connection";
import { OutgoingWebhooks } from "@/features/settings/outgoing-webhooks";
import { WorkspaceSettings } from "@/features/settings/workspace-settings";
import { getActiveWorkspace } from "@/lib/active-workspace";
import { getCurrentUser } from "@/lib/auth";
import { hasPermission } from "@/lib/permissions";
import { outgoingWebhookService } from "@/services/outgoing-webhook.service";
import { storeConnectionService } from "@/services/store.service";
import { workspaceService } from "@/services/workspace.service";

export default async function SettingsPage() {
  const user = await getCurrentUser();
  if (!user) redirect("/api/session-expired");

  const active = await getActiveWorkspace(user.id);
  if (!active) redirect("/onboarding");

  // Members are fetched only to resolve the viewer's own role (the
  // permission flags below) — team management itself lives on the
  // Team page, not in Settings.
  const members = await workspaceService.listMembers(user.id, active.id);
  const currentMember = members.find((m) => m.user.id === user.id);
  if (!currentMember) redirect("/onboarding");

  const canManageWebhooks = hasPermission(currentMember.role, "workspace.update");
  const outgoingWebhooks = canManageWebhooks
    ? await outgoingWebhookService.listWebhooks(user.id, active.id).catch(() => [])
    : [];

  // The AI sections (model, assistant & knowledge, documents) live on
  // the Automation page — they power the automation rules. Settings
  // keeps profile, workspace, webhooks, the store connection and
  // notification preferences.
  const canManage = hasPermission(currentMember.role, "workspace.update");
  const storeConnection = await storeConnectionService
    .get(user.id, active.id)
    .catch(() => null);

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title="Settings"
        description={`Workspace settings and preferences for ${active.name}. Your personal account lives on the Profile page; team members and roles live on the Team page.`}
      />

      <WorkspaceSettings
        workspace={{
          id: active.id,
          name: active.name,
          slug: active.slug,
          timezone: active.timezone,
        }}
        currentRole={currentMember.role}
      />

      {canManageWebhooks ? (
        <OutgoingWebhooks workspaceId={active.id} initialWebhooks={outgoingWebhooks} />
      ) : null}

      <StoreConnectionCard
        workspaceId={active.id}
        initialConnection={storeConnection}
        canManage={canManage}
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
          {currentMember.role === "OWNER" ? (
            <DeleteWorkspace workspaceId={active.id} workspaceName={active.name} />
          ) : (
            <p className="text-muted-foreground text-sm">
              Only the workspace owner can delete this workspace.
            </p>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
