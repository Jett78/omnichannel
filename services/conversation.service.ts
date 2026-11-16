import { prisma } from "@/lib/prisma";
import type { ConversationStatus } from "@/generated/prisma/client";

/**
 * Conversation service — all queries are workspace-scoped.
 * Read paths are real; write paths that depend on provider adapters
 * (sending replies) arrive in Phase 2/3.
 */
export const conversationService = {
  async listForWorkspace(
    workspaceId: string,
    options?: { status?: ConversationStatus; assigneeId?: string; limit?: number },
  ) {
    return prisma.conversation.findMany({
      where: {
        workspaceId,
        ...(options?.status ? { status: options.status } : {}),
        ...(options?.assigneeId ? { assigneeId: options.assigneeId } : {}),
      },
      include: {
        contact: { select: { id: true, displayName: true, avatarUrl: true } },
        channel: { select: { id: true, provider: true, displayName: true } },
        messages: { orderBy: { createdAt: "desc" }, take: 1 },
      },
      orderBy: { lastMessageAt: "desc" },
      take: options?.limit ?? 50,
    });
  },

  async getForWorkspace(workspaceId: string, conversationId: string) {
    return prisma.conversation.findFirst({
      where: { id: conversationId, workspaceId },
      include: {
        contact: true,
        channel: true,
        messages: { orderBy: { createdAt: "asc" }, include: { attachments: true } },
      },
    });
  },

  async assign(workspaceId: string, conversationId: string, assigneeId: string | null) {
    return prisma.conversation.update({
      where: { id: conversationId, workspaceId },
      data: { assigneeId },
    });
  },

  async setStatus(workspaceId: string, conversationId: string, status: ConversationStatus) {
    return prisma.conversation.update({
      where: { id: conversationId, workspaceId },
      data: { status },
    });
  },
};
