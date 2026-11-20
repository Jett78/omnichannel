import { redirect } from "next/navigation";

import { AutomationRules } from "@/features/automation/automation-rules";
import { getActiveWorkspace } from "@/lib/active-workspace";
import { getCurrentUser } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { automationService } from "@/services/automation.service";
import { cannedResponseService } from "@/services/canned-response.service";
import { workspaceService } from "@/services/workspace.service";

/**
 * Automation page (Phase 13C) — real rules from the Phase-13B engine.
 * Server component: resolves the active workspace and hands the client
 * builder everything it needs (rules, recent runs, members, teams,
 * tags, saved replies, and the viewer's own membership).
 */
export default async function AutomationPage() {
  const user = await getCurrentUser();
  if (!user) redirect("/api/session-expired");

  const active = await getActiveWorkspace(user.id);
  if (!active) redirect("/onboarding");

  const members = await workspaceService.listMembers(user.id, active.id);
  const me = members.find((member) => member.userId === user.id);
  const canManage = me?.role === "OWNER" || me?.role === "ADMIN";

  const [rules, runs, teams, tags, canned] = await Promise.all([
    automationService.listRules(user.id, active.id),
    canManage ? automationService.listRuns(user.id, active.id, 20) : Promise.resolve([]),
    workspaceService.listTeams(user.id, active.id),
    prisma.tag.findMany({
      where: { workspaceId: active.id },
      orderBy: { name: "asc" },
      select: { id: true, name: true, color: true },
    }),
    cannedResponseService.list(user.id, active.id),
  ]);

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
      me={{
        userId: user.id,
        role: me?.role ?? "VIEWER",
        isAvailable: me?.isAvailable ?? true,
      }}
      canManage={canManage}
    />
  );
}
