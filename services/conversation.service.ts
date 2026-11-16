import { AppError } from "@/lib/errors";
import { prisma } from "@/lib/prisma";
import { emitToWorkspace, emitToWorkspaceAndConversation } from "@/lib/realtime";
import { requireWorkspacePermission } from "@/lib/workspace-auth";
import { toUnifiedMessage } from "@/services/messaging.service";
import type { Conversation, ConversationStatus, Provider, Tag } from "@/generated/prisma/client";
import type { UnifiedMessage } from "@/types/messaging";

/**
 * Conversation service (Phase 4) — every method takes the acting user,
 * enforces workspace membership + permissions server-side
 * (lib/workspace-auth.ts), and scopes every query by workspaceId.
 */

export interface ConversationListItem {
  id: string;
  workspaceId: string;
  channelId: string;
  contactId: string;
  status: ConversationStatus;
  assigneeId: string | null;
  unreadCount: number;
  lastMessageAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
  contact: {
    id: string;
    displayName: string;
    avatarUrl: string | null;
    phone: string | null;
    email: string | null;
  };
  channel: { id: string; provider: Provider; displayName: string };
  assignee: { id: string; name: string } | null;
  tags: Array<{ id: string; name: string; color: string | null }>;
  preview: string | null;
  previewAt: Date | null;
}

export interface ListConversationsOptions {
  status?: ConversationStatus;
  assigneeId?: string;
  unassigned?: boolean;
  channelId?: string;
  search?: string;
  cursor?: string;
  limit?: number;
}

const conversationInclude = {
  contact: { select: { id: true, displayName: true, avatarUrl: true, phone: true, email: true } },
  channel: { select: { id: true, provider: true, displayName: true } },
  assignee: { select: { id: true, name: true } },
  tags: { include: { tag: true } },
  messages: { orderBy: { createdAt: "desc" as const }, take: 1 },
};

type ConversationRow = Conversation & {
  contact: ConversationListItem["contact"];
  channel: ConversationListItem["channel"];
  assignee: ConversationListItem["assignee"];
  tags: Array<{ tag: Tag }>;
  messages: Array<{ body: string | null; createdAt: Date }>;
};

function toListItem(row: ConversationRow): ConversationListItem {
  const last = row.messages[0];
  return {
    id: row.id,
    workspaceId: row.workspaceId,
    channelId: row.channelId,
    contactId: row.contactId,
    status: row.status,
    assigneeId: row.assigneeId,
    unreadCount: row.unreadCount,
    lastMessageAt: row.lastMessageAt,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
    contact: row.contact,
    channel: row.channel,
    assignee: row.assignee,
    tags: row.tags.map((t) => ({ id: t.tag.id, name: t.tag.name, color: t.tag.color })),
    preview: last?.body ?? null,
    previewAt: last?.createdAt ?? null,
  };
}

async function loadConversationOrThrow(
  workspaceId: string,
  conversationId: string,
): Promise<ConversationRow> {
  const row = await prisma.conversation.findFirst({
    where: { id: conversationId, workspaceId },
    include: conversationInclude,
  });
  if (!row) throw AppError.notFound("Conversation not found");
  return row as ConversationRow;
}

async function emitConversationUpdated(workspaceId: string, row: ConversationRow): Promise<void> {
  await emitToWorkspace(workspaceId, "conversation.updated", {
    workspaceId,
    conversation: {
      id: row.id,
      status: row.status,
      unreadCount: row.unreadCount,
      assigneeId: row.assigneeId,
      lastMessageAt: row.lastMessageAt?.toISOString() ?? null,
    },
  });
}

async function writeAudit(
  workspaceId: string,
  actorId: string,
  action: string,
  conversationId: string,
): Promise<void> {
  await prisma.auditLog.create({
    data: { workspaceId, actorId, action, entity: "Conversation", entityId: conversationId },
  });
}

export const conversationService = {
  async listConversations(
    actorUserId: string,
    workspaceId: string,
    options: ListConversationsOptions = {},
  ): Promise<{ items: ConversationListItem[]; nextCursor: string | null }> {
    await requireWorkspacePermission(actorUserId, workspaceId, "conversations.view");
    const limit = Math.min(Math.max(options.limit ?? 30, 1), 100);
    const search = options.search?.trim();
    const rows = await prisma.conversation.findMany({
      where: {
        workspaceId,
        ...(options.status ? { status: options.status } : {}),
        ...(options.channelId ? { channelId: options.channelId } : {}),
        ...(options.unassigned
          ? { assigneeId: null }
          : options.assigneeId
            ? { assigneeId: options.assigneeId }
            : {}),
        ...(search
          ? {
              OR: [
                {
                  contact: {
                    displayName: { contains: search, mode: "insensitive" as const },
                  },
                },
                {
                  messages: {
                    some: { body: { contains: search, mode: "insensitive" as const } },
                  },
                },
              ],
            }
          : {}),
      },
      include: conversationInclude,
      orderBy: [{ lastMessageAt: "desc" }, { id: "desc" }],
      take: limit + 1,
      ...(options.cursor ? { cursor: { id: options.cursor }, skip: 1 } : {}),
    });
    const hasMore = rows.length > limit;
    const page = hasMore ? rows.slice(0, limit) : rows;
    return {
      items: page.map((row) => toListItem(row as ConversationRow)),
      nextCursor: hasMore ? (page[page.length - 1]?.id ?? null) : null,
    };
  },

  /** Search = listConversations with a query (contact name or message body). */
  async searchConversations(
    actorUserId: string,
    workspaceId: string,
    query: string,
    options: Omit<ListConversationsOptions, "search"> = {},
  ): Promise<{ items: ConversationListItem[]; nextCursor: string | null }> {
    return this.listConversations(actorUserId, workspaceId, { ...options, search: query });
  },

  async getConversation(
    actorUserId: string,
    workspaceId: string,
    conversationId: string,
  ): Promise<ConversationListItem> {
    await requireWorkspacePermission(actorUserId, workspaceId, "conversations.view");
    return toListItem(await loadConversationOrThrow(workspaceId, conversationId));
  },

  async listMessages(
    actorUserId: string,
    workspaceId: string,
    conversationId: string,
    options: { cursor?: string; limit?: number } = {},
  ): Promise<{ items: UnifiedMessage[]; nextCursor: string | null }> {
    await requireWorkspacePermission(actorUserId, workspaceId, "conversations.view");
    const conversation = await prisma.conversation.findFirst({
      where: { id: conversationId, workspaceId },
      select: { id: true, channelId: true, contactId: true },
    });
    if (!conversation) throw AppError.notFound("Conversation not found");

    const identity = await prisma.contactIdentity.findFirst({
      where: { channelId: conversation.channelId, contactId: conversation.contactId },
      select: { externalUserId: true },
    });

    const limit = Math.min(Math.max(options.limit ?? 100, 1), 200);
    const rows = await prisma.message.findMany({
      where: { conversationId },
      include: { attachments: true },
      orderBy: [{ createdAt: "asc" }, { id: "asc" }],
      take: limit,
      ...(options.cursor ? { cursor: { id: options.cursor }, skip: 1 } : {}),
    });
    return {
      items: rows.map((row) =>
        toUnifiedMessage(
          {
            ...row,
            conversation: {
              workspaceId,
              channelId: conversation.channelId,
              contactId: conversation.contactId,
            },
          },
          identity?.externalUserId ?? null,
        ),
      ),
      nextCursor: rows.length === limit ? (rows[rows.length - 1]?.id ?? null) : null,
    };
  },

  async markAsRead(
    actorUserId: string,
    workspaceId: string,
    conversationId: string,
  ): Promise<{ id: string; unreadCount: number }> {
    await requireWorkspacePermission(actorUserId, workspaceId, "conversations.reply");
    const row = await loadConversationOrThrow(workspaceId, conversationId);
    if (row.unreadCount !== 0) {
      await prisma.conversation.update({
        where: { id: conversationId },
        data: { unreadCount: 0 },
      });
      await emitConversationUpdated(workspaceId, { ...row, unreadCount: 0 });
    }
    return { id: conversationId, unreadCount: 0 };
  },

  async assignConversation(
    actorUserId: string,
    workspaceId: string,
    conversationId: string,
    assigneeId: string | null,
  ): Promise<ConversationListItem> {
    await requireWorkspacePermission(actorUserId, workspaceId, "conversations.assign");
    const row = await loadConversationOrThrow(workspaceId, conversationId);

    if (assigneeId) {
      const member = await prisma.workspaceMember.findUnique({
        where: { workspaceId_userId: { workspaceId, userId: assigneeId } },
      });
      if (!member) throw AppError.badRequest("Assignee is not a member of this workspace");
    }

    await prisma.$transaction(async (tx) => {
      await tx.conversation.update({
        where: { id: conversationId },
        data: { assigneeId },
      });
      await tx.conversationAssignment.create({
        data: {
          workspaceId,
          conversationId,
          assigneeId,
          assignedById: actorUserId,
          previousAssigneeId: row.assigneeId,
        },
      });
      await tx.auditLog.create({
        data: {
          workspaceId,
          actorId: actorUserId,
          action: "conversation.assign",
          entity: "Conversation",
          entityId: conversationId,
          meta: { assigneeId, previousAssigneeId: row.assigneeId },
        },
      });
      if (assigneeId && assigneeId !== actorUserId) {
        await tx.notification.create({
          data: {
            workspaceId,
            userId: assigneeId,
            type: "ASSIGNMENT",
            title: "You were assigned a conversation",
            body: `Conversation with ${row.contact.displayName}`,
            entity: "Conversation",
            entityId: conversationId,
          },
        });
      }
    });

    const updated = await loadConversationOrThrow(workspaceId, conversationId);
    await emitConversationUpdated(workspaceId, updated);
    return toListItem(updated);
  },

  async resolveConversation(
    actorUserId: string,
    workspaceId: string,
    conversationId: string,
  ): Promise<ConversationListItem> {
    await requireWorkspacePermission(actorUserId, workspaceId, "conversations.assign");
    const row = await loadConversationOrThrow(workspaceId, conversationId);
    if (row.status !== "OPEN" && row.status !== "PENDING") {
      throw AppError.badRequest(`Cannot resolve a conversation in status ${row.status}`);
    }
    await prisma.conversation.update({
      where: { id: conversationId },
      data: { status: "RESOLVED" },
    });
    await writeAudit(workspaceId, actorUserId, "conversation.resolve", conversationId);
    const updated = await loadConversationOrThrow(workspaceId, conversationId);
    await emitConversationUpdated(workspaceId, updated);
    return toListItem(updated);
  },

  async reopenConversation(
    actorUserId: string,
    workspaceId: string,
    conversationId: string,
  ): Promise<ConversationListItem> {
    await requireWorkspacePermission(actorUserId, workspaceId, "conversations.assign");
    const row = await loadConversationOrThrow(workspaceId, conversationId);
    if (row.status !== "RESOLVED" && row.status !== "SNOOZED") {
      throw AppError.badRequest(`Cannot reopen a conversation in status ${row.status}`);
    }
    await prisma.conversation.update({
      where: { id: conversationId },
      data: { status: "OPEN" },
    });
    await writeAudit(workspaceId, actorUserId, "conversation.reopen", conversationId);
    const updated = await loadConversationOrThrow(workspaceId, conversationId);
    await emitConversationUpdated(workspaceId, updated);
    return toListItem(updated);
  },

  /**
   * Internal agent note — stored as a PRIVATE_NOTE message in the same
   * thread. Never sent to the provider/customer.
   */
  async addInternalNote(
    actorUserId: string,
    workspaceId: string,
    conversationId: string,
    content: string,
  ): Promise<UnifiedMessage> {
    await requireWorkspacePermission(actorUserId, workspaceId, "conversations.reply");
    const conversation = await prisma.conversation.findFirst({
      where: { id: conversationId, workspaceId },
      select: { id: true, channelId: true, contactId: true },
    });
    if (!conversation) throw AppError.notFound("Conversation not found");

    const created = await prisma.message.create({
      data: {
        conversationId,
        direction: "OUTBOUND",
        type: "PRIVATE_NOTE",
        body: content,
        senderType: "AGENT",
        senderUserId: actorUserId,
        status: "SENT",
      },
      include: { attachments: true },
    });
    const unified = toUnifiedMessage({
      ...created,
      conversation: {
        workspaceId,
        channelId: conversation.channelId,
        contactId: conversation.contactId,
      },
    });
    await emitToWorkspaceAndConversation(workspaceId, conversationId, "message.created", {
      workspaceId,
      conversationId,
      message: { ...unified, createdAt: unified.createdAt.toISOString() },
    });
    return unified;
  },

  async addTag(
    actorUserId: string,
    workspaceId: string,
    conversationId: string,
    name: string,
  ): Promise<Array<{ id: string; name: string; color: string | null }>> {
    await requireWorkspacePermission(actorUserId, workspaceId, "conversations.assign");
    await loadConversationOrThrow(workspaceId, conversationId);
    const tag = await prisma.tag.upsert({
      where: { workspaceId_name: { workspaceId, name } },
      create: { workspaceId, name },
      update: {},
    });
    await prisma.conversationTag.upsert({
      where: { conversationId_tagId: { conversationId, tagId: tag.id } },
      create: { conversationId, tagId: tag.id },
      update: {},
    });
    const updated = await loadConversationOrThrow(workspaceId, conversationId);
    await emitConversationUpdated(workspaceId, updated);
    return updated.tags.map((t) => ({ id: t.tag.id, name: t.tag.name, color: t.tag.color }));
  },

  async removeTag(
    actorUserId: string,
    workspaceId: string,
    conversationId: string,
    name: string,
  ): Promise<Array<{ id: string; name: string; color: string | null }>> {
    await requireWorkspacePermission(actorUserId, workspaceId, "conversations.assign");
    await loadConversationOrThrow(workspaceId, conversationId);
    const tag = await prisma.tag.findUnique({
      where: { workspaceId_name: { workspaceId, name } },
    });
    if (tag) {
      await prisma.conversationTag.deleteMany({ where: { conversationId, tagId: tag.id } });
    }
    const updated = await loadConversationOrThrow(workspaceId, conversationId);
    await emitConversationUpdated(workspaceId, updated);
    return updated.tags.map((t) => ({ id: t.tag.id, name: t.tag.name, color: t.tag.color }));
  },
};
