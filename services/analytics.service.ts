import { prisma } from "@/lib/prisma";
import { requireWorkspacePermission } from "@/lib/workspace-auth";
import type { Provider } from "@/generated/prisma/client";

/**
 * Analytics service — every number is aggregated from real workspace
 * data (conversations, messages, assignments, and the audit log's
 * resolve events). Nothing is estimated or sampled.
 *
 * Definitions (kept honest on purpose):
 * - "Conversations" per day = conversations created that day.
 * - "Resolved" per day = conversation.resolve audit events that day.
 * - "First response" = minutes from a conversation's first inbound
 *   message to the first agent reply after it, averaged per day over
 *   the conversations whose first inbound arrived that day.
 * - "Resolution time" (Phase 13F) = minutes from a conversation's
 *   creation to a conversation.resolve audit event, averaged over the
 *   resolve events in range (a reopened-then-resolved conversation
 *   contributes one sample per resolve event).
 * - Incoming/outgoing (Phase 13F) split messagesInRange by direction
 *   (system and private-note messages are already excluded).
 */
export interface AnalyticsTrendPoint {
  day: string;
  conversations: number;
  resolved: number;
  responseMinutes: number | null;
}

export interface AnalyticsData {
  rangeDays: number;
  totals: {
    openNow: number;
    unassignedNow: number;
    conversationsInRange: number;
    messagesInRange: number;
    incomingMessages: number;
    outgoingMessages: number;
    resolvedInRange: number;
    avgResponseMinutes: number | null;
    avgResolutionMinutes: number | null;
  };
  trend: AnalyticsTrendPoint[];
  channelShare: Array<{ provider: Provider; conversations: number }>;
  leaderboard: Array<{
    agentId: string;
    agent: string;
    assigned: number;
    resolved: number;
    avgResponseMinutes: number | null;
  }>;
}

function dayKey(date: Date): string {
  return date.toISOString().slice(0, 10);
}

function dayLabel(key: string): string {
  return new Date(`${key}T00:00:00Z`).toLocaleDateString("en-GB", {
    day: "numeric",
    month: "short",
    timeZone: "UTC",
  });
}

export const analyticsService = {
  async getAnalytics(
    actorUserId: string,
    workspaceId: string,
    rangeDays: 7 | 30 | 90,
  ): Promise<AnalyticsData> {
    await requireWorkspacePermission(actorUserId, workspaceId, "conversations.view");

    const now = new Date();
    const start = new Date(
      Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()),
    );
    start.setUTCDate(start.getUTCDate() - (rangeDays - 1));

    const dayKeys: string[] = [];
    for (let i = 0; i < rangeDays; i += 1) {
      const d = new Date(start);
      d.setUTCDate(d.getUTCDate() + i);
      dayKeys.push(dayKey(d));
    }

    const [
      conversationsInRange,
      resolveEvents,
      messages,
      assignmentEvents,
      openNow,
      unassignedNow,
      members,
    ] = await Promise.all([
      prisma.conversation.findMany({
        where: { workspaceId, createdAt: { gte: start } },
        select: { createdAt: true, channel: { select: { provider: true } } },
      }),
      prisma.auditLog.findMany({
        where: { workspaceId, action: "conversation.resolve", createdAt: { gte: start } },
        select: { createdAt: true, actorId: true, entityId: true },
      }),
      prisma.message.findMany({
        where: {
          conversation: { workspaceId },
          createdAt: { gte: start },
          type: { notIn: ["SYSTEM", "PRIVATE_NOTE"] },
        },
        select: {
          conversationId: true,
          direction: true,
          senderType: true,
          senderUserId: true,
          createdAt: true,
        },
        orderBy: { createdAt: "asc" },
      }),
      prisma.conversationAssignment.findMany({
        where: { workspaceId, createdAt: { gte: start }, assigneeId: { not: null } },
        select: { assigneeId: true },
      }),
      prisma.conversation.count({
        where: { workspaceId, status: { in: ["OPEN", "PENDING"] } },
      }),
      prisma.conversation.count({
        where: { workspaceId, status: { in: ["OPEN", "PENDING"] }, assigneeId: null },
      }),
      prisma.workspaceMember.findMany({
        where: { workspaceId },
        select: { user: { select: { id: true, name: true } } },
      }),
    ]);

    // ── Trend buckets ────────────────────────────────────────────────
    const conversationsByDay = new Map<string, number>();
    const channelCounts = new Map<Provider, number>();
    for (const conversation of conversationsInRange) {
      const key = dayKey(conversation.createdAt);
      conversationsByDay.set(key, (conversationsByDay.get(key) ?? 0) + 1);
      const provider = conversation.channel.provider;
      channelCounts.set(provider, (channelCounts.get(provider) ?? 0) + 1);
    }
    const resolvedByDay = new Map<string, number>();
    const resolvedByAgent = new Map<string, number>();
    for (const event of resolveEvents) {
      const key = dayKey(event.createdAt);
      resolvedByDay.set(key, (resolvedByDay.get(key) ?? 0) + 1);
      if (event.actorId) {
        resolvedByAgent.set(event.actorId, (resolvedByAgent.get(event.actorId) ?? 0) + 1);
      }
    }

    // ── First response times ─────────────────────────────────────────
    interface ResponseSample {
      day: string;
      minutes: number;
      agentId: string | null;
    }
    const samples: ResponseSample[] = [];
    const byConversation = new Map<string, typeof messages>();
    for (const message of messages) {
      const list = byConversation.get(message.conversationId);
      if (list) list.push(message);
      else byConversation.set(message.conversationId, [message]);
    }
    for (const conversationMessages of byConversation.values()) {
      const firstInbound = conversationMessages.find((m) => m.direction === "INBOUND");
      if (!firstInbound) continue;
      const firstReply = conversationMessages.find(
        (m) =>
          m.direction === "OUTBOUND" &&
          m.senderType === "AGENT" &&
          m.createdAt > firstInbound.createdAt,
      );
      if (!firstReply) continue;
      samples.push({
        day: dayKey(firstInbound.createdAt),
        minutes: (firstReply.createdAt.getTime() - firstInbound.createdAt.getTime()) / 60_000,
        agentId: firstReply.senderUserId,
      });
    }
    const responseByDay = new Map<string, number[]>();
    const responseByAgent = new Map<string, number[]>();
    for (const sample of samples) {
      const dayList = responseByDay.get(sample.day) ?? [];
      dayList.push(sample.minutes);
      responseByDay.set(sample.day, dayList);
      if (sample.agentId) {
        const agentList = responseByAgent.get(sample.agentId) ?? [];
        agentList.push(sample.minutes);
        responseByAgent.set(sample.agentId, agentList);
      }
    }
    const average = (values: number[]): number | null =>
      values.length === 0
        ? null
        : Math.round((values.reduce((sum, v) => sum + v, 0) / values.length) * 10) / 10;

    const trend: AnalyticsTrendPoint[] = dayKeys.map((key) => ({
      day: dayLabel(key),
      conversations: conversationsByDay.get(key) ?? 0,
      resolved: resolvedByDay.get(key) ?? 0,
      responseMinutes: average(responseByDay.get(key) ?? []),
    }));

    // ── Leaderboard ──────────────────────────────────────────────────
    const assignedByAgent = new Map<string, number>();
    for (const event of assignmentEvents) {
      if (event.assigneeId) {
        assignedByAgent.set(event.assigneeId, (assignedByAgent.get(event.assigneeId) ?? 0) + 1);
      }
    }
    const memberNames = new Map(members.map((m) => [m.user.id, m.user.name]));
    const agentIds = new Set<string>([
      ...assignedByAgent.keys(),
      ...resolvedByAgent.keys(),
      ...responseByAgent.keys(),
    ]);
    const leaderboard = [...agentIds]
      .map((agentId) => ({
        agentId,
        agent: memberNames.get(agentId) ?? "Former member",
        assigned: assignedByAgent.get(agentId) ?? 0,
        resolved: resolvedByAgent.get(agentId) ?? 0,
        avgResponseMinutes: average(responseByAgent.get(agentId) ?? []),
      }))
      .sort((a, b) => b.resolved - a.resolved || b.assigned - a.assigned);

    // ── Resolution times (Phase 13F) ─────────────────────────────────
    const resolvedConversationIds = [
      ...new Set(resolveEvents.map((event) => event.entityId).filter(Boolean)),
    ] as string[];
    const resolvedConversations = resolvedConversationIds.length
      ? await prisma.conversation.findMany({
          where: { workspaceId, id: { in: resolvedConversationIds } },
          select: { id: true, createdAt: true },
        })
      : [];
    const resolvedCreatedAt = new Map(
      resolvedConversations.map((c) => [c.id, c.createdAt]),
    );
    const resolutionMinutes: number[] = [];
    for (const event of resolveEvents) {
      const createdAt = event.entityId ? resolvedCreatedAt.get(event.entityId) : undefined;
      if (createdAt) {
        resolutionMinutes.push((event.createdAt.getTime() - createdAt.getTime()) / 60_000);
      }
    }
    const incomingMessages = messages.filter((m) => m.direction === "INBOUND").length;

    return {
      rangeDays,
      totals: {
        openNow,
        unassignedNow,
        conversationsInRange: conversationsInRange.length,
        messagesInRange: messages.length,
        incomingMessages,
        outgoingMessages: messages.length - incomingMessages,
        resolvedInRange: resolveEvents.length,
        avgResponseMinutes: average(samples.map((s) => s.minutes)),
        avgResolutionMinutes: average(resolutionMinutes),
      },
      trend,
      channelShare: [...channelCounts.entries()]
        .map(([provider, conversations]) => ({ provider, conversations }))
        .sort((a, b) => b.conversations - a.conversations),
      leaderboard,
    };
  },
};
