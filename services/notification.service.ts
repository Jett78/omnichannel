import { prisma } from "@/lib/prisma";

/**
 * Phase 13E — notifications.
 *
 * Producers that already existed: ASSIGNMENT (conversation.service
 * assign), MENTION (internal notes), INVITATION, and automation
 * "notify" actions. This service adds the two customer-driven
 * producers — new conversation and new message — plus the read/list
 * API behind the /notifications page.
 *
 * Producer methods are self-catching: a notification failure must
 * never break message ingest.
 */

export interface NotificationView {
  id: string;
  type: string;
  title: string;
  body: string | null;
  entity: string | null;
  entityId: string | null;
  isRead: boolean;
  createdAt: string;
}

const ADMIN_ROLES = ["OWNER", "ADMIN"] as const;

async function adminUserIds(workspaceId: string): Promise<string[]> {
  const members = await prisma.workspaceMember.findMany({
    where: { workspaceId, role: { in: [...ADMIN_ROLES] } },
    select: { userId: true },
  });
  return members.map((m) => m.userId);
}

export const notificationService = {
  /** A customer started a new conversation → tell owners/admins. */
  async notifyNewConversation(workspaceId: string, conversationId: string): Promise<void> {
    try {
      const conversation = await prisma.conversation.findFirst({
        where: { id: conversationId, workspaceId },
        include: {
          contact: { select: { displayName: true } },
          channel: { select: { provider: true } },
        },
      });
      if (!conversation) return;
      const targets = await adminUserIds(workspaceId);
      if (targets.length === 0) return;
      await prisma.notification.createMany({
        data: targets.map((userId) => ({
          workspaceId,
          userId,
          type: "SYSTEM" as const,
          title: "New conversation",
          body: `${conversation.contact.displayName} on ${conversation.channel.provider.toLowerCase()}`,
          entity: "Conversation",
          entityId: conversationId,
        })),
      });
    } catch (error) {
      console.error("[notifications] new-conversation failed", error);
    }
  },

  /**
   * A customer sent another message in an existing conversation →
   * tell the assignee, or owners/admins while it is unassigned.
   */
  async notifyNewInboundMessage(
    workspaceId: string,
    conversationId: string,
    preview: string | null,
  ): Promise<void> {
    try {
      const conversation = await prisma.conversation.findFirst({
        where: { id: conversationId, workspaceId },
        select: {
          assigneeId: true,
          contact: { select: { displayName: true } },
        },
      });
      if (!conversation) return;
      const targets = conversation.assigneeId
        ? [conversation.assigneeId]
        : await adminUserIds(workspaceId);
      if (targets.length === 0) return;
      const body = preview?.trim() ? preview.trim().slice(0, 140) : "Sent a new message";
      await prisma.notification.createMany({
        data: targets.map((userId) => ({
          workspaceId,
          userId,
          type: "SYSTEM" as const,
          title: `New message from ${conversation.contact.displayName}`,
          body,
          entity: "Conversation",
          entityId: conversationId,
        })),
      });
    } catch (error) {
      console.error("[notifications] new-message failed", error);
    }
  },

  async listForUser(
    userId: string,
    workspaceId: string,
    limit = 100,
  ): Promise<NotificationView[]> {
    const rows = await prisma.notification.findMany({
      where: { userId, workspaceId },
      orderBy: { createdAt: "desc" },
      take: Math.min(Math.max(limit, 1), 200),
    });
    return rows.map((row) => ({
      id: row.id,
      type: row.type,
      title: row.title,
      body: row.body,
      entity: row.entity,
      entityId: row.entityId,
      isRead: row.isRead,
      createdAt: row.createdAt.toISOString(),
    }));
  },

  async markRead(userId: string, workspaceId: string, notificationId: string): Promise<void> {
    await prisma.notification.updateMany({
      where: { id: notificationId, userId, workspaceId },
      data: { isRead: true, readAt: new Date() },
    });
  },

  async markAllRead(userId: string, workspaceId: string): Promise<{ updated: number }> {
    const result = await prisma.notification.updateMany({
      where: { userId, workspaceId, isRead: false },
      data: { isRead: true, readAt: new Date() },
    });
    return { updated: result.count };
  },
};
