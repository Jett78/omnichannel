import { BadgeCheck, TriangleAlert } from "lucide-react";
import Link from "next/link";
import { redirect } from "next/navigation";

import { AvatarWithBadge } from "@/components/avatar-with-badge";
import { PageHeader } from "@/components/layout/page-header";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { NotificationPreferences } from "@/features/settings/notification-preferences";
import { AiKnowledge } from "@/features/settings/ai-knowledge";
import { AiModelConfig } from "@/features/settings/ai-model-config";
import { KnowledgeDocuments } from "@/features/settings/knowledge-documents";
import { StoreConnectionCard } from "@/features/settings/store-connection";
import { OutgoingWebhooks } from "@/features/settings/outgoing-webhooks";
import { WorkspaceSettings } from "@/features/settings/workspace-settings";
import { getActiveWorkspace } from "@/lib/active-workspace";
import { getCurrentUser } from "@/lib/auth";
import { hasPermission } from "@/lib/permissions";
import { getAiStatus, getEnvAiConfig } from "@/lib/ai";
import { countAiUsageThisMonth, knowledgeService } from "@/services/ai.service";
import { outgoingWebhookService } from "@/services/outgoing-webhook.service";
import { storeConnectionService } from "@/services/store.service";
import { aiConfigService } from "@/services/ai-config.service";
import { knowledgeDocumentService } from "@/services/knowledge-document.service";
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

  const canManageKnowledge = hasPermission(currentMember.role, "workspace.update");
  const [knowledgeEntries, aiUsageThisMonth] = await Promise.all([
    knowledgeService.list(user.id, active.id).catch(() => []),
    countAiUsageThisMonth(active.id).catch(() => 0),
  ]);
  const storeConnection = await storeConnectionService
    .get(user.id, active.id)
    .catch(() => null);
  const aiStatus = await getAiStatus(active.id).catch(() => ({
    configured: false,
    label: null,
    source: null,
  }));
  const envAi = getEnvAiConfig();
  const envAiLabel = envAi ? `${envAi.model} via ${new URL(envAi.baseUrl).hostname}` : null;
  const aiConfig = await aiConfigService.get(user.id, active.id).catch(() => null);
  const knowledgeDocuments = await knowledgeDocumentService
    .list(user.id, active.id)
    .catch(() => []);

  return (
    <div className="flex max-w-4xl flex-col gap-6">
      <PageHeader
        title="Settings"
        description={`Profile, workspace and preferences for ${active.name}. Team members and roles live on the Team page.`}
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

      {canManageWebhooks ? (
        <OutgoingWebhooks workspaceId={active.id} initialWebhooks={outgoingWebhooks} />
      ) : null}

      <AiModelConfig
        workspaceId={active.id}
        initialConfig={aiConfig}
        envConfigured={envAi !== null}
        envLabel={envAiLabel}
        canManage={canManageKnowledge}
      />

      <AiKnowledge
        workspaceId={active.id}
        initialEntries={knowledgeEntries}
        aiConfigured={aiStatus.configured}
        aiLabel={aiStatus.label}
        usageThisMonth={aiUsageThisMonth}
        canManage={canManageKnowledge}
      />

      <KnowledgeDocuments
        workspaceId={active.id}
        initialDocuments={knowledgeDocuments}
        canManage={canManageKnowledge}
      />

      <StoreConnectionCard
        workspaceId={active.id}
        initialConnection={storeConnection}
        canManage={canManageKnowledge}
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
