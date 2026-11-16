import { AppError } from "@/lib/errors";
import { getQueues } from "@/lib/queue";
import { emitToWorkspace, emitToWorkspaceAndConversation } from "@/lib/realtime";
import { prisma } from "@/lib/prisma";
import { requireWorkspacePermission } from "@/lib/workspace-auth";
import { getProvider } from "@/integrations/registry";
import type { ChannelContext } from "@/integrations/types";
import { channelCredentialService } from "@/services/channel-credential.service";
import type { Message, MessageAttachment, Prisma } from "@/generated/prisma/client";
import {
  providerEnumToId,
  type DeliveryStatusUpdate,
  type MessageType,
  type NormalizedInboundMessage,
  type UnifiedMessage,
} from "@/types/messaging";

/**
 * Messaging engine (Phase 4) — the single path every message takes,
 * inbound and outbound, regardless of platform.
 *
 * Inbound:  provider webhook → worker → ingestInboundMessage()
 * Outbound: agent → sendOutboundMessage() (QUEUED + BullMQ job)
 *           → worker → deliverOutboundMessage() → provider.sendMessage()
 *
 * Platform specifics live behind IMessagingProvider; everything here
 * works on the unified message shape (types/messaging.ts).
 */

// ─── The single Prisma → Unified mapper ───────────────────────────────────────

export interface MessageRowForMapping extends Message {
  attachments: MessageAttachment[];
  conversation: { workspaceId: string; channelId: string; contactId: string };
}

function toMetadata(value: Prisma.JsonValue | null): Record<string, unknown> | null {
  if (value && typeof value === "object" && !Array.isArray(value)) {
    return value as Record<string, unknown>;
  }
  return null;
}

export function toUnifiedMessage(
  row: MessageRowForMapping,
  senderExternalId?: string | null,
): UnifiedMessage {
  // Agent-authored rows report the agent's user id; contact-authored
  // rows report the contact's channel-scoped external id.
  const senderId =
    row.senderType === "AGENT"
      ? (row.senderUserId ?? "system")
      : (senderExternalId ?? row.conversation.contactId);
  return {
    id: row.id,
    workspaceId: row.conversation.workspaceId,
    channelId: row.conversation.channelId,
    conversationId: row.conversationId,
    externalMessageId: row.externalMessageId,
    senderId,
    senderType: row.senderType,
    content: row.body,
    messageType: row.type,
    attachments: row.attachments.map((a) => ({
      id: a.id,
      url: a.originalUrl,
      storageKey: a.storageKey,
      mimeType: a.mimeType,
      fileName: a.fileName,
      size: a.size,
    })),
    direction: row.direction,
    status: row.status,
    metadata: toMetadata(row.metadata),
    isPrivateNote: row.type === "PRIVATE_NOTE",
    createdAt: row.createdAt,
  };
}

function isUniqueViolation(error: unknown): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    (error as { code: unknown }).code === "P2002"
  );
}

// ─── Service ──────────────────────────────────────────────────────────────────

export interface IngestResult {
  message: UnifiedMessage;
  conversationId: string;
  deduplicated: boolean;
}

export const messagingService = {
  /**
   * Persist one normalized inbound message. System-level (called by the
   * webhook worker — there is no acting user), but the channel must
   * belong to the given workspace. Idempotent on
   * [conversationId, externalMessageId]: a duplicate delivery returns
   * the existing message with `deduplicated: true` and does NOT touch
   * unread counts.
   */
  async ingestInboundMessage(
    workspaceId: string,
    channelId: string,
    normalized: NormalizedInboundMessage,
  ): Promise<IngestResult> {
    const channel = await prisma.channel.findFirst({ where: { id: channelId, workspaceId } });
    if (!channel) throw AppError.notFound("Channel not found");

    // Resolve (or create) the contact + identity for this sender.
    let identity = await prisma.contactIdentity.findUnique({
      where: {
        channelId_externalUserId: { channelId, externalUserId: normalized.senderExternalId },
      },
    });
    if (!identity) {
      const contact = await prisma.contact.create({
        data: {
          workspaceId,
          displayName: normalized.senderName ?? normalized.senderExternalId,
          avatarUrl: normalized.senderAvatarUrl ?? null,
        },
      });
      identity = await prisma.contactIdentity.create({
        data: { contactId: contact.id, channelId, externalUserId: normalized.senderExternalId },
      });
    }
    const contactId = identity.contactId;

    // Find-or-create the conversation for this contact on this channel.
    // A RESOLVED conversation reopens when the customer writes again.
    let conversation = await prisma.conversation.findFirst({
      where: { channelId, contactId },
      orderBy: { createdAt: "desc" },
    });
    let conversationCreated = false;
    if (!conversation) {
      conversation = await prisma.conversation.create({
        data: {
          workspaceId,
          channelId,
          contactId,
          status: "OPEN",
          externalThreadId: normalized.externalThreadId ?? null,
        },
      });
      conversationCreated = true;
    } else if (conversation.status === "RESOLVED") {
      conversation = await prisma.conversation.update({
        where: { id: conversation.id },
        data: { status: "OPEN" },
      });
    }

    const conversationCtx = { workspaceId, channelId, contactId };

    // Idempotency: same external message id in this conversation → no-op.
    const existing = await prisma.message.findUnique({
      where: {
        conversationId_externalMessageId: {
          conversationId: conversation.id,
          externalMessageId: normalized.externalMessageId,
        },
      },
      include: { attachments: true },
    });
    if (existing) {
      return {
        message: toUnifiedMessage(
          { ...existing, conversation: conversationCtx },
          normalized.senderExternalId,
        ),
        conversationId: conversation.id,
        deduplicated: true,
      };
    }

    let created: Message & { attachments: MessageAttachment[] };
    try {
      created = await prisma.message.create({
        data: {
          conversationId: conversation.id,
          direction: "INBOUND",
          type: normalized.type,
          body: normalized.body ?? null,
          senderType: "CONTACT",
          externalMessageId: normalized.externalMessageId,
          status: "RECEIVED",
          sentAt: normalized.sentAt,
          metadata: { raw: normalized.raw } as Prisma.InputJsonValue,
          attachments: {
            create: (normalized.attachments ?? []).map((a) => ({
              originalUrl: a.url,
              mimeType: a.mimeType ?? null,
              fileName: a.fileName ?? null,
              size: a.size ?? null,
            })),
          },
        },
        include: { attachments: true },
      });
    } catch (error) {
      if (!isUniqueViolation(error)) throw error;
      // Lost a race with a concurrent delivery of the same webhook.
      const winner = await prisma.message.findUniqueOrThrow({
        where: {
          conversationId_externalMessageId: {
            conversationId: conversation.id,
            externalMessageId: normalized.externalMessageId,
          },
        },
        include: { attachments: true },
      });
      return {
        message: toUnifiedMessage(
          { ...winner, conversation: conversationCtx },
          normalized.senderExternalId,
        ),
        conversationId: conversation.id,
        deduplicated: true,
      };
    }

    const updated = await prisma.conversation.update({
      where: { id: conversation.id },
      data: { lastMessageAt: normalized.sentAt, unreadCount: { increment: 1 } },
    });

    // Attachment processing is queued (media worker downloads to storage
    // once real providers land; today it is an honest stub).
    if (created.attachments.length > 0) {
      try {
        const queues = getQueues();
        for (const attachment of created.attachments) {
          if (attachment.originalUrl) {
            await queues.media.add("media", {
              messageId: created.id,
              attachmentUrl: attachment.originalUrl,
              workspaceId,
            });
          }
        }
      } catch (error) {
        console.error("[messaging] media enqueue failed (ignored):", error);
      }
    }

    const unified = toUnifiedMessage(
      { ...created, conversation: conversationCtx },
      normalized.senderExternalId,
    );

    const conversationPayload = {
      workspaceId,
      conversation: {
        id: updated.id,
        status: updated.status,
        unreadCount: updated.unreadCount,
        assigneeId: updated.assigneeId,
        lastMessageAt: updated.lastMessageAt?.toISOString() ?? null,
      },
    };
    if (conversationCreated) {
      await emitToWorkspace(workspaceId, "conversation.created", conversationPayload);
    } else {
      await emitToWorkspaceAndConversation(
        workspaceId,
        conversation.id,
        "conversation.updated",
        conversationPayload,
      );
    }
    await emitToWorkspaceAndConversation(workspaceId, conversation.id, "message.created", {
      workspaceId,
      conversationId: conversation.id,
      message: { ...unified, createdAt: unified.createdAt.toISOString() },
    });

    return { message: unified, conversationId: conversation.id, deduplicated: false };
  },

  /**
   * Queue an agent reply. Creates the Message as QUEUED and enqueues the
   * outbound BullMQ job — the provider call happens in the worker, never
   * in the request path.
   */
  async sendOutboundMessage(
    actorUserId: string,
    workspaceId: string,
    conversationId: string,
    input: { content: string; type?: MessageType },
  ): Promise<UnifiedMessage> {
    await requireWorkspacePermission(actorUserId, workspaceId, "conversations.reply");
    const conversation = await prisma.conversation.findFirst({
      where: { id: conversationId, workspaceId },
    });
    if (!conversation) throw AppError.notFound("Conversation not found");

    const created = await prisma.message.create({
      data: {
        conversationId,
        direction: "OUTBOUND",
        type: input.type ?? "TEXT",
        body: input.content,
        senderType: "AGENT",
        senderUserId: actorUserId,
        status: "QUEUED",
      },
      include: { attachments: true },
    });
    await prisma.conversation.update({
      where: { id: conversationId },
      data: { lastMessageAt: new Date() },
    });

    await getQueues().outbound.add(
      "outbound",
      { messageId: created.id, workspaceId, channelId: conversation.channelId },
      { attempts: 3, backoff: { type: "exponential", delay: 1000 } },
    );

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
   * Worker-side delivery: call the channel's provider and settle the
   * message status. Throws on provider error when this is NOT the final
   * attempt (so BullMQ retries); on the final attempt the message is
   * marked FAILED with the error in metadata and the call resolves.
   */
  async deliverOutboundMessage(
    messageId: string,
    options: { isFinalAttempt: boolean },
  ): Promise<{ status: string }> {
    const message = await prisma.message.findUnique({
      where: { id: messageId },
      include: {
        attachments: true,
        conversation: {
          include: { channel: true },
        },
      },
    });
    if (!message) return { status: "MISSING" };
    if (message.status !== "QUEUED") return { status: message.status };

    const { conversation } = message;
    const channel = conversation.channel;
    const workspaceId = conversation.workspaceId;

    const markFailed = async (
      errorMessage: string,
      extraMetadata: Record<string, unknown> = {},
    ): Promise<{ status: string }> => {
      const previous = toMetadata(message.metadata) ?? {};
      await prisma.message.update({
        where: { id: messageId },
        data: {
          status: "FAILED",
          metadata: { ...previous, ...extraMetadata, error: errorMessage } as Prisma.InputJsonValue,
        },
      });
      await emitToWorkspaceAndConversation(workspaceId, conversation.id, "message.status_updated", {
        workspaceId,
        conversationId: conversation.id,
        messageId,
        status: "FAILED",
        error: errorMessage,
      });
      return { status: "FAILED" };
    };

    const identity = await prisma.contactIdentity.findFirst({
      where: { channelId: channel.id, contactId: conversation.contactId },
    });
    if (!identity) {
      return markFailed("No contact identity for this conversation's contact on its channel");
    }

    let provider;
    try {
      provider = getProvider(providerEnumToId(channel.provider));
    } catch (error) {
      if (options.isFinalAttempt) {
        return markFailed(error instanceof Error ? error.message : "Provider unavailable");
      }
      throw error;
    }

    const credential = await channelCredentialService.getDecryptedChannelCredentialForServer(
      channel.id,
    );
    const channelContext: ChannelContext = {
      channelId: channel.id,
      workspaceId,
      provider: providerEnumToId(channel.provider),
      externalAccountId: channel.externalAccountId,
      credentials: {
        accessToken: credential?.accessToken ?? "",
        ...(credential?.refreshToken ? { refreshToken: credential.refreshToken } : {}),
        ...(credential?.tokenExpiresAt ? { expiresAt: credential.tokenExpiresAt } : {}),
        scopes: credential?.scopes ?? [],
      },
    };

    // Meta 24h standard messaging window (Facebook Messenger +
    // Instagram): a standard reply is only permitted within 24 hours
    // of the customer's most recent inbound message. Outside the
    // window the send is settled FAILED immediately — retrying cannot
    // succeed until the customer writes again, and no provider API
    // call is made.
    if (channel.provider === "FACEBOOK" || channel.provider === "INSTAGRAM") {
      const latestInbound = await prisma.message.findFirst({
        where: { conversationId: conversation.id, direction: "INBOUND" },
        orderBy: { sentAt: "desc" },
        select: { sentAt: true },
      });
      const windowMs = 24 * 60 * 60 * 1000;
      if (!latestInbound || Date.now() - latestInbound.sentAt.getTime() > windowMs) {
        return markFailed(
          "Outside Meta's 24-hour messaging window: the customer must message again before a standard reply can be sent.",
          { windowViolation: true },
        );
      }
    }

    try {
      const result = await provider.sendMessage({
        channel: channelContext,
        toExternalId: identity.externalUserId,
        message: {
          type: message.type,
          ...(message.body !== null ? { body: message.body } : {}),
          attachments: message.attachments
            .filter((a) => a.originalUrl !== null)
            .map((a) => ({
              url: a.originalUrl as string,
              ...(a.mimeType ? { mimeType: a.mimeType } : {}),
              ...(a.fileName ? { fileName: a.fileName } : {}),
              ...(a.size !== null ? { size: a.size } : {}),
            })),
        },
      });
      await prisma.message.update({
        where: { id: messageId },
        data: { status: "SENT", externalMessageId: result.externalMessageId, sentAt: new Date() },
      });
      await emitToWorkspaceAndConversation(workspaceId, conversation.id, "message.status_updated", {
        workspaceId,
        conversationId: conversation.id,
        messageId,
        status: "SENT",
        externalMessageId: result.externalMessageId,
      });
      return { status: "SENT" };
    } catch (error) {
      if (options.isFinalAttempt) {
        return markFailed(error instanceof Error ? error.message : "Provider send failed");
      }
      throw error;
    }
  },

  /**
   * Apply provider delivery/read receipts (Phase 5) to outbound
   * messages on one channel. System-level (called by the webhook
   * worker). Statuses only ever advance monotonically
   * SENT → DELIVERED → READ: a late DELIVERED receipt never downgrades
   * a READ message, and FAILED messages are never touched. Delivery /
   * read timestamps are merged into message metadata and a realtime
   * `message.status_updated` event is emitted per changed message.
   *
   * Two update shapes:
   *  - per-message: `externalMessageId` set → that message advances.
   *  - watermark: `externalMessageId` null + `watermark` +
   *    `contactExternalId` → every already-sent outbound message to
   *    that contact on this channel with sentAt <= watermark advances.
   * Returns the number of messages actually advanced.
   */
  async applyDeliveryStatusUpdates(
    channelId: string,
    updates: DeliveryStatusUpdate[],
  ): Promise<number> {
    if (updates.length === 0) return 0;
    const channel = await prisma.channel.findUnique({
      where: { id: channelId },
      select: { id: true, workspaceId: true },
    });
    if (!channel) return 0;
    const workspaceId = channel.workspaceId;

    const STATUS_RANK: Record<string, number> = { SENT: 1, DELIVERED: 2, READ: 3 };

    interface Candidate {
      id: string;
      status: Message["status"];
      metadata: Prisma.JsonValue | null;
      conversationId: string;
    }

    const advance = async (
      candidate: Candidate,
      update: DeliveryStatusUpdate,
    ): Promise<boolean> => {
      if (candidate.status === "FAILED") return false;
      const currentRank = STATUS_RANK[candidate.status] ?? 0;
      const nextRank = STATUS_RANK[update.status] ?? 0;
      if (nextRank <= currentRank) return false;
      const metadata: Record<string, unknown> = { ...(toMetadata(candidate.metadata) ?? {}) };
      if (update.status === "DELIVERED") metadata.deliveredAt = update.at.toISOString();
      if (update.status === "READ") metadata.readAt = update.at.toISOString();
      await prisma.message.update({
        where: { id: candidate.id },
        data: {
          status: update.status as Message["status"],
          metadata: metadata as Prisma.InputJsonValue,
        },
      });
      await emitToWorkspaceAndConversation(
        workspaceId,
        candidate.conversationId,
        "message.status_updated",
        {
          workspaceId,
          conversationId: candidate.conversationId,
          messageId: candidate.id,
          status: update.status,
        },
      );
      return true;
    };

    let updatedCount = 0;
    for (const update of updates) {
      if (update.externalMessageId) {
        const candidates = await prisma.message.findMany({
          where: {
            externalMessageId: update.externalMessageId,
            direction: "OUTBOUND",
            conversation: { channelId },
          },
          select: { id: true, status: true, metadata: true, conversationId: true },
        });
        for (const candidate of candidates) {
          if (await advance(candidate, update)) updatedCount += 1;
        }
        continue;
      }

      if (update.watermark && update.contactExternalId) {
        const identity = await prisma.contactIdentity.findUnique({
          where: {
            channelId_externalUserId: {
              channelId,
              externalUserId: update.contactExternalId,
            },
          },
          select: { contactId: true },
        });
        if (!identity) continue;
        const candidates = await prisma.message.findMany({
          where: {
            direction: "OUTBOUND",
            status: { in: ["SENT", "DELIVERED"] },
            sentAt: { lte: update.watermark },
            conversation: { channelId, contactId: identity.contactId },
          },
          select: { id: true, status: true, metadata: true, conversationId: true },
        });
        for (const candidate of candidates) {
          if (await advance(candidate, update)) updatedCount += 1;
        }
      }
    }
    return updatedCount;
  },
};
