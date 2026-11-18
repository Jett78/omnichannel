import { AppError } from "@/lib/errors";
import { prisma } from "@/lib/prisma";
import { emitToWorkspace, emitToWorkspaceAndConversation } from "@/lib/realtime";
import { requireWorkspacePermission } from "@/lib/workspace-auth";
import { toUnifiedMessage } from "@/services/messaging.service";
import type {
  Conversation,
  ConversationPriority,
  ConversationStatus,
  Provider,
  Tag,
} from "@/generated/prisma/client";
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
  priority: ConversationPriority | null;
  snoozedUntil: Date | null;
  assigneeId: string | null;
  unreadCount: number;
  /** True when the newest real message is inbound and unanswered. */
  awaitingReply: boolean;
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
  /** Only conversations where this user was @-mentioned in a note. */
  mentionedUserId?: string;
  sort?: "latest" | "waiting" | "priority";
  cursor?: string;
  limit?: number;
}

const conversationInclude = {
  contact: { select: { id: true, displayName: true, avatarUrl: true, phone: true, email: true } },
  channel: { select: { id: true, provider: true, displayName: true } },
  assignee: { select: { id: true, name: true } },
  tags: { include: { tag: true } },
  // Preview = newest REAL message; SYSTEM activity entries never
  // become the preview or affect the awaiting-reply flag.
  messages: {
    where: { type: { not: "SYSTEM" as const } },
    orderBy: { createdAt: "desc" as const },
    take: 1,
  },
};

type ConversationRow = Conversation & {
  contact: ConversationListItem["contact"];
  channel: ConversationListItem["channel"];
  assignee: ConversationListItem["assignee"];
  tags: Array<{ tag: Tag }>;
  messages: Array<{
    body: string | null;
    createdAt: Date;
    direction: "INBOUND" | "OUTBOUND";
    type: string;
  }>;
};

/** List preview for a message with no text body (media, templates). */
function mediaPreview(type: string, direction: "INBOUND" | "OUTBOUND"): string | null {
  const outbound = direction === "OUTBOUND";
  switch (type) {
    case "IMAGE":
      return outbound ? "You sent a photo" : "Photo";
    case "VIDEO":
      return outbound ? "You sent a video" : "Video";
    case "AUDIO":
      return outbound ? "You sent a voice message" : "Voice message";
    case "FILE":
      return outbound ? "You sent a file" : "File";
    case "LOCATION":
      return outbound ? "You sent a location" : "Location";
    case "STICKER":
      return outbound ? "You sent a sticker" : "Sticker";
    case "TEMPLATE":
      return outbound ? "You sent a template" : "Template";
    default:
      return null;
  }
}

function toListItem(row: ConversationRow): ConversationListItem {
  const last = row.messages[0];
  return {
    id: row.id,
    workspaceId: row.workspaceId,
    channelId: row.channelId,
    contactId: row.contactId,
    status: row.status,
    priority: row.priority,
    snoozedUntil: row.snoozedUntil,
    assigneeId: row.assigneeId,
    unreadCount: row.unreadCount,
    awaitingReply: last?.direction === "INBOUND",
    lastMessageAt: row.lastMessageAt,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
    contact: row.contact,
    channel: row.channel,
    assignee: row.assignee,
    tags: row.tags.map((t) => ({ id: t.tag.id, name: t.tag.name, color: t.tag.color })),
    preview: last ? (last.body ?? mediaPreview(last.type, last.direction)) : null,
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
      priority: row.priority,
      snoozedUntil: row.snoozedUntil?.toISOString() ?? null,
      unreadCount: row.unreadCount,
      assigneeId: row.assigneeId,
      lastMessageAt: row.lastMessageAt?.toISOString() ?? null,
    },
  });
}

async function actorName(actorUserId: string): Promise<string> {
  const user = await prisma.user.findUnique({
    where: { id: actorUserId },
    select: { name: true },
  });
  return user?.name ?? "A teammate";
}

/**
 * Chatwoot-style activity entry in the thread timeline ("Jeet resolved
 * this conversation"). Stored as a SYSTEM message; excluded from list
 * previews by the include filter above.
 */
async function addActivityMessage(
  workspaceId: string,
  conversation: { id: string; channelId: string; contactId: string },
  body: string,
): Promise<void> {
  const created = await prisma.message.create({
    data: {
      conversationId: conversation.id,
      direction: "OUTBOUND",
      type: "SYSTEM",
      body,
      senderType: "SYSTEM",
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
  await emitToWorkspaceAndConversation(workspaceId, conversation.id, "message.created", {
    workspaceId,
    conversationId: conversation.id,
    message: { ...unified, createdAt: unified.createdAt.toISOString() },
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
    // Lazy unsnooze: timed snoozes whose deadline passed reopen here
    // (a customer reply also unsnoozes at ingest time).
    await prisma.conversation.updateMany({
      where: {
        workspaceId,
        status: "SNOOZED",
        snoozedUntil: { not: null, lt: new Date() },
      },
      data: { status: "OPEN", snoozedUntil: null },
    });
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
        ...(options.mentionedUserId
          ? {
              messages: {
                some: {
                  type: "PRIVATE_NOTE" as const,
                  metadata: {
                    path: ["mentions"],
                    array_contains: [options.mentionedUserId],
                  },
                },
              },
            }
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
      orderBy:
        options.sort === "waiting"
          ? [{ lastMessageAt: "asc" }, { id: "asc" }]
          : options.sort === "priority"
            ? [
                { priority: { sort: "desc" as const, nulls: "last" as const } },
                { lastMessageAt: "desc" },
                { id: "desc" },
              ]
            : [{ lastMessageAt: "desc" }, { id: "desc" }],
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

    if (assigneeId !== row.assigneeId) {
      const name = await actorName(actorUserId);
      const assigneeName = assigneeId
        ? ((await prisma.user.findUnique({
            where: { id: assigneeId },
            select: { name: true },
          }))?.name ?? "a teammate")
        : null;
      await addActivityMessage(
        workspaceId,
        row,
        assigneeId
          ? assigneeId === actorUserId
            ? `${name} assigned this conversation to themselves`
            : `${name} assigned this conversation to ${assigneeName}`
          : `${name} unassigned this conversation`,
      );
    }

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
    await addActivityMessage(
      workspaceId,
      row,
      `${await actorName(actorUserId)} resolved this conversation`,
    );
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
      data: { status: "OPEN", snoozedUntil: null },
    });
    await writeAudit(workspaceId, actorUserId, "conversation.reopen", conversationId);
    await addActivityMessage(
      workspaceId,
      row,
      `${await actorName(actorUserId)} reopened this conversation`,
    );
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
      select: {
        id: true,
        channelId: true,
        contactId: true,
        contact: { select: { displayName: true } },
      },
    });
    if (!conversation) throw AppError.notFound("Conversation not found");

    // @-mentions: "@Teammate Name" in a note notifies that member and
    // files the conversation under their Mentions view.
    const members = await prisma.workspaceMember.findMany({
      where: { workspaceId },
      include: { user: { select: { id: true, name: true } } },
    });
    const lowered = content.toLowerCase();
    const mentionedIds = members
      .map((m) => m.user)
      .filter((u) => u.id !== actorUserId && lowered.includes(`@${u.name.toLowerCase()}`))
      .map((u) => u.id);

    const created = await prisma.message.create({
      data: {
        conversationId,
        direction: "OUTBOUND",
        type: "PRIVATE_NOTE",
        body: content,
        senderType: "AGENT",
        senderUserId: actorUserId,
        status: "SENT",
        ...(mentionedIds.length > 0 ? { metadata: { mentions: mentionedIds } } : {}),
      },
      include: { attachments: true },
    });
    if (mentionedIds.length > 0) {
      const name = await actorName(actorUserId);
      await prisma.notification.createMany({
        data: mentionedIds.map((userId) => ({
          workspaceId,
          userId,
          type: "MENTION" as const,
          title: `${name} mentioned you in a note`,
          body: `Conversation with ${conversation.contact.displayName}`,
          entity: "Conversation",
          entityId: conversationId,
        })),
      });
    }
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

  /**
   * Manually set/clear the contact's phone and email from the inbox
   * (Customer details → Edit). Channels auto-fill only some of this —
   * WhatsApp sets the phone from the wa_id; Messenger shares neither
   * phone nor email — so agents fill the rest when a customer shares it
   * in chat. An empty string clears the field; an omitted field is left
   * unchanged.
   */
  async updateContactDetails(
    actorUserId: string,
    workspaceId: string,
    conversationId: string,
    input: { phone?: string; email?: string },
  ): Promise<ConversationListItem["contact"]> {
    await requireWorkspacePermission(actorUserId, workspaceId, "conversations.assign");
    const row = await loadConversationOrThrow(workspaceId, conversationId);
    const data: { phone?: string | null; email?: string | null } = {};
    if (input.phone !== undefined) {
      data.phone = input.phone.trim() === "" ? null : input.phone.trim();
    }
    if (input.email !== undefined) {
      data.email = input.email.trim() === "" ? null : input.email.trim();
    }
    if (Object.keys(data).length > 0) {
      await prisma.contact.update({ where: { id: row.contactId }, data });
    }
    const updated = await loadConversationOrThrow(workspaceId, conversationId);
    await emitConversationUpdated(workspaceId, updated);
    return updated.contact;
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

  /** Set or clear the conversation priority (Chatwoot: Low→Urgent). */
  async setPriority(
    actorUserId: string,
    workspaceId: string,
    conversationId: string,
    priority: ConversationPriority | null,
  ): Promise<ConversationListItem> {
    await requireWorkspacePermission(actorUserId, workspaceId, "conversations.assign");
    const row = await loadConversationOrThrow(workspaceId, conversationId);
    if (row.priority === priority) return toListItem(row);
    await prisma.conversation.update({
      where: { id: conversationId },
      data: { priority },
    });
    await writeAudit(workspaceId, actorUserId, "conversation.priority", conversationId);
    const name = await actorName(actorUserId);
    await addActivityMessage(
      workspaceId,
      row,
      priority
        ? `${name} set the priority to ${priority.charAt(0) + priority.slice(1).toLowerCase()}`
        : `${name} cleared the priority`,
    );
    const updated = await loadConversationOrThrow(workspaceId, conversationId);
    await emitConversationUpdated(workspaceId, updated);
    return toListItem(updated);
  },

  /**
   * Snooze an open conversation: `until` a moment, or null for "until
   * the next customer reply". Expired timed snoozes reopen lazily in
   * listConversations; a customer reply unsnoozes at ingest.
   */
  async snoozeConversation(
    actorUserId: string,
    workspaceId: string,
    conversationId: string,
    until: Date | null,
  ): Promise<ConversationListItem> {
    await requireWorkspacePermission(actorUserId, workspaceId, "conversations.assign");
    const row = await loadConversationOrThrow(workspaceId, conversationId);
    if (row.status !== "OPEN" && row.status !== "PENDING") {
      throw AppError.badRequest(`Cannot snooze a conversation in status ${row.status}`);
    }
    if (until && until.getTime() <= Date.now()) {
      throw AppError.badRequest("Snooze time must be in the future");
    }
    await prisma.conversation.update({
      where: { id: conversationId },
      data: { status: "SNOOZED", snoozedUntil: until },
    });
    await writeAudit(workspaceId, actorUserId, "conversation.snooze", conversationId);
    const name = await actorName(actorUserId);
    await addActivityMessage(
      workspaceId,
      row,
      until
        ? `${name} snoozed this conversation until ${until.toLocaleString("en-GB", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" })}`
        : `${name} snoozed this conversation until the next reply`,
    );
    const updated = await loadConversationOrThrow(workspaceId, conversationId);
    await emitConversationUpdated(workspaceId, updated);
    return toListItem(updated);
  },

  /** Permanently delete a conversation and its messages. */
  async deleteConversation(
    actorUserId: string,
    workspaceId: string,
    conversationId: string,
  ): Promise<{ id: string }> {
    await requireWorkspacePermission(actorUserId, workspaceId, "conversations.assign");
    await loadConversationOrThrow(workspaceId, conversationId);
    await prisma.conversation.delete({ where: { id: conversationId } });
    await writeAudit(workspaceId, actorUserId, "conversation.delete", conversationId);
    await emitToWorkspace(workspaceId, "conversation.deleted", { workspaceId, conversationId });
    return { id: conversationId };
  },

  /** Other conversations with the same contact (Previous conversations panel). */
  async listContactConversations(
    actorUserId: string,
    workspaceId: string,
    conversationId: string,
  ): Promise<ConversationListItem[]> {
    await requireWorkspacePermission(actorUserId, workspaceId, "conversations.view");
    const row = await loadConversationOrThrow(workspaceId, conversationId);
    const rows = await prisma.conversation.findMany({
      where: { workspaceId, contactId: row.contactId, id: { not: conversationId } },
      include: conversationInclude,
      orderBy: [{ lastMessageAt: "desc" }, { id: "desc" }],
      take: 10,
    });
    return rows.map((r) => toListItem(r as ConversationRow));
  },

  /**
   * Delete an agent-authored message (own replies and notes) from the
   * thread. This removes it from OUR records only — a message already
   * delivered to the customer's app cannot be unsent by this.
   */
  async deleteMessage(
    actorUserId: string,
    workspaceId: string,
    conversationId: string,
    messageId: string,
  ): Promise<{ id: string }> {
    await requireWorkspacePermission(actorUserId, workspaceId, "conversations.reply");
    await loadConversationOrThrow(workspaceId, conversationId);
    const message = await prisma.message.findFirst({
      where: { id: messageId, conversationId },
      select: { id: true, senderType: true },
    });
    if (!message) throw AppError.notFound("Message not found");
    if (message.senderType !== "AGENT") {
      throw AppError.badRequest("Only your team's messages can be deleted");
    }
    await prisma.message.delete({ where: { id: messageId } });
    await emitToWorkspaceAndConversation(workspaceId, conversationId, "message.deleted", {
      workspaceId,
      conversationId,
      messageId,
    });
    return { id: messageId };
  },
};
