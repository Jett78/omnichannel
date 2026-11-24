import { redirect } from "next/navigation";

import { AutomationRules } from "@/features/automation/automation-rules";
import { AiKnowledge } from "@/features/settings/ai-knowledge";
import { AiModelConfig } from "@/features/settings/ai-model-config";
import { KnowledgeDocuments } from "@/features/settings/knowledge-documents";
import { getActiveWorkspace } from "@/lib/active-workspace";
import { getCurrentUser } from "@/lib/auth";
import { getAiStatus, getEnvAiConfig } from "@/lib/ai";
import { prisma } from "@/lib/prisma";
import { aiConfigService } from "@/services/ai-config.service";
import { countAiUsageThisMonth, knowledgeService } from "@/services/ai.service";
import { automationService } from "@/services/automation.service";
import { cannedResponseService } from "@/services/canned-response.service";
import { knowledgeDocumentService } from "@/services/knowledge-document.service";
import { workspaceService } from "@/services/workspace.service";

/**
 * Automation page (Phase 13C) — real rules from the Phase-13B engine.
 * Server component: resolves the active workspace and hands the client
 * builder everything it needs (rules, recent runs, members, teams,
 * tags, saved replies, and the viewer's own membership). The AI
 * sections (model, assistant & knowledge base, knowledge documents)
 * live below the rules — they power the "Reply with AI" action and
 * the composer assistant; they moved here from Settings.
 */
export default async function AutomationPage() {
  const user = await getCurrentUser();
  if (!user) redirect("/api/session-expired");

  const active = await getActiveWorkspace(user.id);
  if (!active) redirect("/onboarding");

  const members = await workspaceService.listMembers(user.id, active.id);
  const me = members.find((member) => member.userId === user.id);
  const canManage = me?.role === "OWNER" || me?.role === "ADMIN";

  const [rules, runs, teams, tags, canned, channels] = await Promise.all([
    automationService.listRules(user.id, active.id),
    canManage ? automationService.listRuns(user.id, active.id, 100) : Promise.resolve([]),
    workspaceService.listTeams(user.id, active.id),
    prisma.tag.findMany({
      where: { workspaceId: active.id },
      orderBy: { name: "asc" },
      select: { id: true, name: true, color: true },
    }),
    cannedResponseService.list(user.id, active.id),
    prisma.channel.findMany({
      where: { workspaceId: active.id },
      orderBy: { displayName: "asc" },
      select: { id: true, provider: true, displayName: true },
    }),
  ]);

  const [knowledgeEntries, aiUsageThisMonth] = await Promise.all([
    knowledgeService.list(user.id, active.id).catch(() => []),
    countAiUsageThisMonth(active.id).catch(() => 0),
  ]);
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
    <AutomationRules
      workspaceId={active.id}
      initialRules={rules}
      initialRuns={runs}
      members={members.map((member) => ({
        userId: member.userId,
        name: member.user.name,
        email: member.user.email,
        role: member.role,
        teamId: member.teamId,
        isAvailable: member.isAvailable,
      }))}
      teams={teams.map((team) => ({ id: team.id, name: team.name }))}
      tags={tags}
      canned={canned.map((item) => ({ id: item.id, title: item.title, category: item.category }))}
      channels={channels.map((channel) => ({
        id: channel.id,
        provider: channel.provider,
        displayName: channel.displayName,
      }))}
      me={{
        userId: user.id,
        role: me?.role ?? "VIEWER",
        isAvailable: me?.isAvailable ?? true,
      }}
      canManage={canManage}
      aiSections={
        <div className="flex flex-col gap-6">
          <div>
            <p className="text-xs font-semibold tracking-wider text-muted-foreground uppercase">
              AI configuration
            </p>
            <p className="text-muted-foreground mt-1 text-sm">
              The model, knowledge and documents that power AI replies and the composer
              assistant.
            </p>
          </div>

          <AiModelConfig
            workspaceId={active.id}
            initialConfig={aiConfig}
            envConfigured={envAi !== null}
            envLabel={envAiLabel}
            canManage={canManage}
          />

          <AiKnowledge
            workspaceId={active.id}
            initialEntries={knowledgeEntries}
            aiConfigured={aiStatus.configured}
            aiLabel={aiStatus.label}
            usageThisMonth={aiUsageThisMonth}
            canManage={canManage}
          />

          <KnowledgeDocuments
            workspaceId={active.id}
            initialDocuments={knowledgeDocuments}
            canManage={canManage}
          />
        </div>
      }
    />
  );
}
