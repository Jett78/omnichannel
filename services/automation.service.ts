import { runInAutomation } from "@/lib/automation-context";
import { AppError } from "@/lib/errors";
import { prisma } from "@/lib/prisma";
import { requireWorkspacePermission } from "@/lib/workspace-auth";
import { Prisma } from "@/generated/prisma/client";
import { aiAssistantService } from "@/services/ai.service";
import { conversationService } from "@/services/conversation.service";
import { messagingService } from "@/services/messaging.service";

/**
 * Phase 13B — automation rules + smart assignment.
 *
 * One engine powers both: a rule has a trigger, optional conditions,
 * and an ordered action list. Smart assignment is the `assign` action
 * with a strategy:
 *  - specific     → one named member (availability ignored — explicit)
 *  - round_robin  → next available member in stable join order
 *  - least_busy   → available member with fewest active conversations
 * "Available" = WorkspaceMember.isAvailable AND role OWNER/ADMIN/AGENT.
 *
 * Actions run through the NORMAL services as the rule's creator, so
 * permissions, the Meta 24h window, activity messages, audits and
 * outgoing webhooks all behave exactly as if that admin did it by
 * hand. A window violation fails that one action honestly and is
 * recorded on the run — never faked as sent.
 *
 * Recursion: engine execution runs inside runInAutomation(), and the
 * service hooks (lib/automation-hook.ts) skip events raised while it
 * is active, so automation-caused changes never trigger more rules.
 */

export type AutomationTrigger =
  | "conversation.created"
  | "message.created"
  | "conversation.assigned"
  | "conversation.resolved"
  | "tag.added";

export interface AutomationConditions {
  /** Channel provider ids ("facebook", "whatsapp", …) — any match. */
  providers?: string[];
  /** Conversation must carry at least one of these tag ids. */
  tagIds?: string[];
  unassignedOnly?: boolean;
  /** message.created only: fire solely for a conversation's first inbound message. */
  firstMessageOnly?: boolean;
  /**
   * Message-text filter (keyword auto-reply): the triggering message's
   * body must contain at least one of these words/phrases
   * (case-insensitive substring). Only events that carry a message
   * body can match — message.created and conversation.created.
   */
  keywords?: string[];
}

export type AutomationAction =
  | {
      type: "assign";
      strategy: "specific" | "round_robin" | "least_busy";
      userId?: string;
      teamId?: string;
    }
  | { type: "add_tag"; name: string }
  | { type: "send_canned"; cannedResponseId: string }
  | { type: "ai_reply" }
  | { type: "notify"; userIds?: string[]; message: string }
  | { type: "set_status"; status: "OPEN" | "RESOLVED" }
  | { type: "set_priority"; priority: "LOW" | "MEDIUM" | "HIGH" | "URGENT" };

export interface AutomationRuleView {
  id: string;
  name: string;
  enabled: boolean;
  trigger: string;
  conditions: AutomationConditions | null;
  actions: AutomationAction[];
  createdById: string;
  createdAt: string;
  updatedAt: string;
}

export interface AutomationRunView {
  id: string;
  ruleId: string;
  ruleName: string;
  conversationId: string;
  trigger: string;
  results: Array<{ type: string; ok: boolean; detail: string }>;
  createdAt: string;
}

interface RuleRow {
  id: string;
  workspaceId: string;
  name: string;
  enabled: boolean;
  trigger: string;
  conditions: unknown;
  actions: unknown;
  roundRobinCursor: string | null;
  createdById: string;
  createdAt: Date;
  updatedAt: Date;
}

function toRuleView(row: RuleRow): AutomationRuleView {
  return {
    id: row.id,
    name: row.name,
    enabled: row.enabled,
    trigger: row.trigger,
    conditions: (row.conditions as AutomationConditions | null) ?? null,
    actions: (row.actions as AutomationAction[]) ?? [],
    createdById: row.createdById,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

const ASSIGNABLE_ROLES = ["OWNER", "ADMIN", "AGENT"] as const;

export const automationService = {
  async listRules(actorUserId: string, workspaceId: string): Promise<AutomationRuleView[]> {
    await requireWorkspacePermission(actorUserId, workspaceId, "conversations.view");
    const rows = await prisma.automationRule.findMany({
      where: { workspaceId },
      orderBy: { createdAt: "asc" },
    });
    return rows.map(toRuleView);
  },

  async createRule(
    actorUserId: string,
    workspaceId: string,
    input: {
      name: string;
      trigger: AutomationTrigger;
      conditions?: AutomationConditions;
      actions: AutomationAction[];
      enabled?: boolean;
    },
  ): Promise<AutomationRuleView> {
    await requireWorkspacePermission(actorUserId, workspaceId, "workspace.update");
    const row = await prisma.automationRule.create({
      data: {
        workspaceId,
        name: input.name.trim(),
        trigger: input.trigger,
        conditions: (input.conditions ?? undefined) as Prisma.InputJsonValue | undefined,
        actions: input.actions as unknown as object[],
        enabled: input.enabled ?? true,
        createdById: actorUserId,
      },
    });
    return toRuleView(row);
  },

  async updateRule(
    actorUserId: string,
    workspaceId: string,
    ruleId: string,
    input: Partial<{
      name: string;
      trigger: AutomationTrigger;
      conditions: AutomationConditions | null;
      actions: AutomationAction[];
      enabled: boolean;
    }>,
  ): Promise<AutomationRuleView> {
    await requireWorkspacePermission(actorUserId, workspaceId, "workspace.update");
    const existing = await prisma.automationRule.findFirst({
      where: { id: ruleId, workspaceId },
      select: { id: true },
    });
    if (!existing) throw AppError.notFound("Automation rule not found");
    const row = await prisma.automationRule.update({
      where: { id: ruleId },
      data: {
        ...(input.name !== undefined ? { name: input.name.trim() } : {}),
        ...(input.trigger !== undefined ? { trigger: input.trigger } : {}),
        ...(input.conditions !== undefined
          ? {
              // Explicit null clears the conditions (DbNull = SQL NULL
              // for a Json column); an object replaces them.
              conditions:
                input.conditions === null
                  ? Prisma.DbNull
                  : (input.conditions as Prisma.InputJsonValue),
            }
          : {}),
        ...(input.actions !== undefined
          ? { actions: input.actions as unknown as object[] }
          : {}),
        ...(input.enabled !== undefined ? { enabled: input.enabled } : {}),
      },
    });
    return toRuleView(row);
  },

  async deleteRule(actorUserId: string, workspaceId: string, ruleId: string): Promise<void> {
    await requireWorkspacePermission(actorUserId, workspaceId, "workspace.update");
    const existing = await prisma.automationRule.findFirst({
      where: { id: ruleId, workspaceId },
      select: { id: true },
    });
    if (!existing) throw AppError.notFound("Automation rule not found");
    await prisma.automationRule.delete({ where: { id: ruleId } });
  },

  async listRuns(
    actorUserId: string,
    workspaceId: string,
    limit = 50,
  ): Promise<AutomationRunView[]> {
    await requireWorkspacePermission(actorUserId, workspaceId, "workspace.update");
    const rows = await prisma.automationRun.findMany({
      where: { workspaceId },
      orderBy: { createdAt: "desc" },
      take: Math.min(Math.max(limit, 1), 200),
      include: { rule: { select: { name: true } } },
    });
    return rows.map((row) => ({
      id: row.id,
      ruleId: row.ruleId,
      ruleName: row.rule.name,
      conversationId: row.conversationId,
      trigger: row.trigger,
      results: (row.results as AutomationRunView["results"]) ?? [],
      createdAt: row.createdAt.toISOString(),
    }));
  },

  /** The signed-in member's own smart-assignment availability toggle. */
  async setMyAvailability(
    actorUserId: string,
    workspaceId: string,
    isAvailable: boolean,
  ): Promise<{ isAvailable: boolean }> {
    const member = await prisma.workspaceMember.findUnique({
      where: { workspaceId_userId: { workspaceId, userId: actorUserId } },
      select: { id: true },
    });
    if (!member) throw AppError.forbidden("You are not a member of this workspace");
    await prisma.workspaceMember.update({
      where: { id: member.id },
      data: { isAvailable },
    });
    return { isAvailable };
  },
};

// ─── Engine ─────────────────────────────────────────────────────────

interface ActionResult {
  type: string;
  ok: boolean;
  detail: string;
}

async function loadConversationContext(workspaceId: string, conversationId: string) {
  return prisma.conversation.findFirst({
    where: { id: conversationId, workspaceId },
    include: {
      channel: { select: { provider: true } },
      contact: { select: { displayName: true } },
      tags: { select: { tagId: true } },
    },
  });
}

async function conditionsMatch(
  conditions: AutomationConditions | null,
  workspaceId: string,
  conversation: NonNullable<Awaited<ReturnType<typeof loadConversationContext>>>,
  messageBody?: string | null,
): Promise<boolean> {
  if (!conditions) return true;
  if (conditions.providers?.length) {
    const providerId = conversation.channel.provider.toLowerCase();
    if (!conditions.providers.some((p) => p.toLowerCase() === providerId)) return false;
  }
  if (conditions.tagIds?.length) {
    const owned = new Set(conversation.tags.map((t) => t.tagId));
    if (!conditions.tagIds.some((id) => owned.has(id))) return false;
  }
  if (conditions.unassignedOnly && conversation.assigneeId) return false;
  if (conditions.keywords?.length) {
    // Keyword auto-reply: needs the triggering message's text. Events
    // without a body (assign/resolve/tag) can never match.
    const body = (messageBody ?? "").toLowerCase();
    if (!body) return false;
    const hit = conditions.keywords.some((keyword) => {
      const needle = keyword.trim().toLowerCase();
      return needle !== "" && body.includes(needle);
    });
    if (!hit) return false;
  }
  if (conditions.firstMessageOnly) {
    const inboundCount = await prisma.message.count({
      where: { conversationId: conversation.id, direction: "INBOUND" },
    });
    if (inboundCount > 1) return false;
  }
  return true;
}

async function availableCandidates(workspaceId: string, teamId?: string) {
  return prisma.workspaceMember.findMany({
    where: {
      workspaceId,
      isAvailable: true,
      role: { in: [...ASSIGNABLE_ROLES] },
      ...(teamId ? { teamId } : {}),
    },
    orderBy: [{ createdAt: "asc" }, { userId: "asc" }],
    select: { userId: true },
  });
}

async function runAssignAction(
  rule: RuleRow,
  workspaceId: string,
  conversationId: string,
  action: Extract<AutomationAction, { type: "assign" }>,
): Promise<ActionResult> {
  if (action.strategy === "specific") {
    if (!action.userId) return { type: "assign", ok: false, detail: "No user selected" };
    const member = await prisma.workspaceMember.findUnique({
      where: { workspaceId_userId: { workspaceId, userId: action.userId } },
      select: { id: true },
    });
    if (!member) return { type: "assign", ok: false, detail: "Target is not a workspace member" };
    await conversationService.assignConversation(
      rule.createdById,
      workspaceId,
      conversationId,
      action.userId,
    );
    return { type: "assign", ok: true, detail: `Assigned to the selected member` };
  }

  const candidates = await availableCandidates(workspaceId, action.teamId);
  if (candidates.length === 0) {
    return { type: "assign", ok: false, detail: "No available agents" };
  }

  let pick: string;
  if (action.strategy === "round_robin") {
    const cursorIndex = candidates.findIndex((c) => c.userId === rule.roundRobinCursor);
    const next = candidates[(cursorIndex + 1) % candidates.length];
    if (!next) return { type: "assign", ok: false, detail: "No available agents" };
    pick = next.userId;
    await prisma.automationRule.update({
      where: { id: rule.id },
      data: { roundRobinCursor: pick },
    });
  } else {
    // least_busy — fewest active (non-resolved) conversations.
    const grouped = await prisma.conversation.groupBy({
      by: ["assigneeId"],
      where: {
        workspaceId,
        assigneeId: { in: candidates.map((c) => c.userId) },
        status: { in: ["OPEN", "PENDING", "SNOOZED"] },
      },
      _count: { _all: true },
    });
    const counts = new Map(grouped.map((g) => [g.assigneeId, g._count._all]));
    let best = candidates[0];
    for (const candidate of candidates) {
      if ((counts.get(candidate.userId) ?? 0) < (counts.get(best?.userId ?? "") ?? 0)) {
        best = candidate;
      }
    }
    if (!best) return { type: "assign", ok: false, detail: "No available agents" };
    pick = best.userId;
  }

  await conversationService.assignConversation(rule.createdById, workspaceId, conversationId, pick);
  return {
    type: "assign",
    ok: true,
    detail: `Assigned via ${action.strategy === "round_robin" ? "round-robin" : "least-busy"}`,
  };
}

async function runAction(
  rule: RuleRow,
  workspaceId: string,
  conversationId: string,
  contactName: string,
  action: AutomationAction,
): Promise<ActionResult> {
  const actor = rule.createdById;
  switch (action.type) {
    case "assign":
      return runAssignAction(rule, workspaceId, conversationId, action);
    case "add_tag": {
      await conversationService.addTag(actor, workspaceId, conversationId, action.name);
      return { type: "add_tag", ok: true, detail: `Tag "${action.name}" added` };
    }
    case "send_canned": {
      const canned = await prisma.cannedResponse.findFirst({
        where: { id: action.cannedResponseId, workspaceId },
      });
      if (!canned) return { type: "send_canned", ok: false, detail: "Saved reply not found" };
      const content = canned.body.replace(/\{\{\s*contact\.name\s*\}\}/g, contactName);
      await messagingService.sendOutboundMessage(actor, workspaceId, conversationId, {
        content,
        type: "TEXT",
        metadata: { viaAutomation: rule.id },
      });
      return { type: "send_canned", ok: true, detail: `Sent saved reply "${canned.title}"` };
    }
    case "ai_reply": {
      // Human takeover: if any outbound agent message exists that was
      // NOT sent by an automation, a human is handling this thread and
      // the AI must not talk over them. Automation sends (canned + AI)
      // carry metadata.viaAutomation, so the AI can still continue a
      // conversation it has been handling alone.
      const priorOutbound = await prisma.message.findMany({
        where: { conversationId, direction: "OUTBOUND", senderType: "AGENT" },
        select: { metadata: true },
      });
      const humanReplied = priorOutbound.some((message) => {
        const meta = message.metadata as { viaAutomation?: string } | null;
        return !meta?.viaAutomation;
      });
      if (humanReplied) {
        return {
          type: "ai_reply",
          ok: true,
          detail: "Skipped — a human agent has replied in this conversation",
        };
      }
      // Generation reuses the Phase 13G assistant (thread context +
      // keyword-matched knowledge). Without AI_API_KEY this throws
      // AiNotConfiguredError and the run records the failure honestly.
      const suggestion = await aiAssistantService.suggestReply(
        actor,
        workspaceId,
        conversationId,
      );
      await messagingService.sendOutboundMessage(actor, workspaceId, conversationId, {
        content: suggestion.text,
        type: "TEXT",
        metadata: { viaAutomation: rule.id, aiGenerated: true },
      });
      return {
        type: "ai_reply",
        ok: true,
        detail: suggestion.knowledgeUsed.length
          ? `AI reply sent (used knowledge: ${suggestion.knowledgeUsed.join(", ")})`
          : "AI reply sent",
      };
    }
    case "notify": {
      let targets: string[];
      if (action.userIds?.length) {
        const members = await prisma.workspaceMember.findMany({
          where: { workspaceId, userId: { in: action.userIds } },
          select: { userId: true },
        });
        targets = members.map((m) => m.userId);
      } else {
        const admins = await prisma.workspaceMember.findMany({
          where: { workspaceId, role: { in: ["OWNER", "ADMIN"] } },
          select: { userId: true },
        });
        targets = admins.map((m) => m.userId);
      }
      if (targets.length === 0) return { type: "notify", ok: false, detail: "No one to notify" };
      const body = action.message.replace(/\{\{\s*contact\.name\s*\}\}/g, contactName);
      await prisma.notification.createMany({
        data: targets.map((userId) => ({
          workspaceId,
          userId,
          type: "SYSTEM" as const,
          title: `Automation: ${rule.name}`,
          body,
          entity: "conversation",
          entityId: conversationId,
        })),
      });
      return { type: "notify", ok: true, detail: `Notified ${targets.length} member(s)` };
    }
    case "set_status": {
      const current = await prisma.conversation.findFirst({
        where: { id: conversationId, workspaceId },
        select: { status: true },
      });
      if (!current) return { type: "set_status", ok: false, detail: "Conversation not found" };
      if (action.status === "RESOLVED") {
        if (current.status === "OPEN" || current.status === "PENDING") {
          await conversationService.resolveConversation(actor, workspaceId, conversationId);
        }
        return { type: "set_status", ok: true, detail: "Conversation resolved" };
      }
      if (current.status === "RESOLVED" || current.status === "SNOOZED") {
        await conversationService.reopenConversation(actor, workspaceId, conversationId);
      }
      return { type: "set_status", ok: true, detail: "Conversation open" };
    }
    case "set_priority": {
      await conversationService.setPriority(actor, workspaceId, conversationId, action.priority);
      return { type: "set_priority", ok: true, detail: `Priority set to ${action.priority}` };
    }
  }
}

export const automationEngine = {
  /**
   * Evaluate every enabled rule for (workspace, trigger) against one
   * conversation. Self-catching by contract — callers (the hooks) must
   * never fail because an automation failed.
   */
  async handleEvent(
    workspaceId: string,
    trigger: AutomationTrigger,
    context: { conversationId: string; messageBody?: string | null },
  ): Promise<void> {
    try {
      const rules = await prisma.automationRule.findMany({
        where: { workspaceId, trigger, enabled: true },
        orderBy: { createdAt: "asc" },
      });
      if (rules.length === 0) return;
      const conversation = await loadConversationContext(workspaceId, context.conversationId);
      if (!conversation) return;

      for (const rule of rules) {
        const conditions = (rule.conditions as AutomationConditions | null) ?? null;
        if (
          !(await conditionsMatch(conditions, workspaceId, conversation, context.messageBody))
        )
          continue;
        const actions = (rule.actions as AutomationAction[]) ?? [];
        const results: ActionResult[] = [];
        await runInAutomation(async () => {
          for (const action of actions) {
            try {
              results.push(
                await runAction(
                  rule,
                  workspaceId,
                  conversation.id,
                  conversation.contact.displayName,
                  action,
                ),
              );
            } catch (error) {
              results.push({
                type: action.type,
                ok: false,
                detail: error instanceof Error ? error.message : "Action failed",
              });
            }
          }
        });
        await prisma.automationRun.create({
          data: {
            workspaceId,
            ruleId: rule.id,
            conversationId: conversation.id,
            trigger,
            results: results as unknown as object[],
          },
        });
      }
    } catch (error) {
      console.error("[automation] handleEvent failed", error);
    }
  },
};
