import { randomUUID } from "node:crypto";

import { fireAutomationEvent } from "@/lib/automation-hook";
import { notificationService } from "@/services/notification.service";
import { AppError } from "@/lib/errors";
import { getQueues } from "@/lib/queue";
import { emitToWorkspace, emitToWorkspaceAndConversation } from "@/lib/realtime";
import { prisma } from "@/lib/prisma";
import { requireWorkspacePermission } from "@/lib/workspace-auth";
import { MetaGraphError } from "@/integrations/meta/meta-graph-client";
import { getProvider } from "@/integrations/registry";
import type { ChannelContext } from "@/integrations/types";
import { TelegramApiError } from "@/integrations/telegram/telegram-client";
import { XApiError } from "@/integrations/x/x-api-client";
import { channelCredentialService } from "@/services/channel-credential.service";
import { outgoingWebhookDispatch } from "@/services/outgoing-webhook.service";
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

/**
 * True when a provider send failure means the stored credential is
 * dead (revoked/expired token), as opposed to a transient or
 * content error: Meta Graph error 190 (invalid/expired access
 * token — WhatsApp Cloud API surfaces through the same client) or
 * an X API 401. Such failures put the channel into ERROR status so
 * the dashboard can prompt a reconnect; retrying cannot fix them.
 */
function isProviderAuthError(error: unknown): boolean {
  if (error instanceof MetaGraphError) return error.code === 190;
  if (error instanceof XApiError) return error.status === 401;
  if (error instanceof TelegramApiError) return error.status === 401;
  return false;
}

/** Largest attachment the inbox sends — WhatsApp's media cap (16 MB). */
export const MAX_MEDIA_BYTES = 16 * 1024 * 1024;

const MEDIA_MIME_PATTERNS: readonly RegExp[] = [
  /^image\//,
  /^video\/(mp4|3gpp)$/,
  /^audio\//,
  /^application\/pdf$/,
  /^text\/plain$/,
  /^application\/msword$/,
  /^application\/vnd\.ms-/,
  /^application\/vnd\.openxmlformats-officedocument\./,
  /^application\/zip$/,
];

/** Map an upload's MIME type to a message kind, rejecting unsupported types. */
function mediaKindForMime(mimeType: string): "image" | "video" | "audio" | "file" {
  if (!MEDIA_MIME_PATTERNS.some((pattern) => pattern.test(mimeType))) {
    throw AppError.badRequest(
      `File type ${mimeType || "(unknown)"} is not supported. Send an image, video (MP4), audio file, PDF, text file, Office document or ZIP.`,
    );
  }
  if (mimeType.startsWith("image/")) return "image";
  if (mimeType.startsWith("video/")) return "video";
  if (mimeType.startsWith("audio/")) return "audio";
  return "file";
}

function channelConfigObject(config: unknown): Record<string, unknown> {
  return config && typeof config === "object" && !Array.isArray(config)
    ? { ...(config as Record<string, unknown>) }
    : {};
}

/**
 * Best-effort contact profile enrichment. Some providers' webhooks
 * carry only a channel-scoped user id and no name (Messenger sends a
 * PSID; the name lives behind the provider's profile API). When the
 * stored display name is still just that raw id, ask the provider for
 * the profile once and store the real name/avatar. Any failure —
 * provider without a profile API, platform privacy rules, network —
 * leaves the id in place and never blocks message ingest.
 */
async function enrichContactProfileIfNeeded(
  workspaceId: string,
  channel: {
    id: string;
    provider: import("@/generated/prisma/client").Provider;
    externalAccountId: string;
    config: unknown;
  },
  contactId: string,
  externalUserId: string,
): Promise<void> {
  try {
    const contact = await prisma.contact.findFirst({
      where: { id: contactId, workspaceId },
      select: { displayName: true, avatarUrl: true },
    });
    if (!contact || contact.displayName !== externalUserId) return;

    const provider = getProvider(providerEnumToId(channel.provider));
    const credential = await channelCredentialService.getDecryptedChannelCredentialForServer(
      channel.id,
    );
    if (!credential?.accessToken) return;
    const channelContext: ChannelContext = {
      channelId: channel.id,
      workspaceId,
      provider: providerEnumToId(channel.provider),
      externalAccountId: channel.externalAccountId,
      credentials: {
        accessToken: credential.accessToken,
        ...(credential.refreshToken ? { refreshToken: credential.refreshToken } : {}),
        ...(credential.tokenExpiresAt ? { expiresAt: credential.tokenExpiresAt } : {}),
        scopes: credential.scopes ?? [],
      },
      ...(channel.config &&
      typeof channel.config === "object" &&
      !Array.isArray(channel.config)
        ? { config: channel.config as Record<string, unknown> }
        : {}),
    };
    const profile = await provider.getContactProfile(channelContext, externalUserId);
    if (!profile.name && !profile.avatarUrl) return;
    await prisma.contact.update({
      where: { id: contactId },
      data: {
        ...(profile.name ? { displayName: profile.name } : {}),
        ...(profile.avatarUrl && !contact.avatarUrl ? { avatarUrl: profile.avatarUrl } : {}),
      },
    });
  } catch {
    // Enrichment is opportunistic — ingest must not fail because a
    // profile lookup did.
  }
}

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
          // WhatsApp senders are identified by their phone number
          // (wa_id) — store it as the contact's phone at ingest.
          ...(channel.provider === "WHATSAPP" ? { phone: normalized.senderExternalId } : {}),
          // Gmail senders are identified by their email address —
          // store it as the contact's email at ingest.
          ...(channel.provider === "GMAIL" ? { email: normalized.senderExternalId } : {}),
        },
      });
      identity = await prisma.contactIdentity.create({
        data: { contactId: contact.id, channelId, externalUserId: normalized.senderExternalId },
      });
    } else if (channel.provider === "WHATSAPP") {
      // Backfill the phone on contacts created before Phase 6 (or by
      // other flows) when it is still unknown.
      await prisma.contact.updateMany({
        where: { id: identity.contactId, workspaceId, phone: null },
        data: { phone: normalized.senderExternalId },
      });
    } else if (channel.provider === "GMAIL") {
      // Backfill the email (and the best-effort Gravatar avatar) on
      // Gmail contacts created before they were recorded at ingest.
      await prisma.contact.updateMany({
        where: { id: identity.contactId, workspaceId, email: null },
        data: { email: normalized.senderExternalId },
      });
      if (normalized.senderAvatarUrl) {
        await prisma.contact.updateMany({
          where: { id: identity.contactId, workspaceId, avatarUrl: null },
          data: { avatarUrl: normalized.senderAvatarUrl },
        });
      }
    }
    const contactId = identity.contactId;

    // If all we have for this contact is the raw channel-scoped id,
    // try to replace it with the real profile name/avatar (Messenger
    // webhooks carry only a PSID). Best-effort; runs before the
    // conversation is assembled so the UI sees the enriched contact.
    await enrichContactProfileIfNeeded(workspaceId, channel, contactId, normalized.senderExternalId);

    // Find-or-create the conversation for this contact on this channel.
    // A RESOLVED conversation reopens when the customer writes again.
    let conversation = await prisma.conversation.findFirst({
      where: { channelId, contactId },
      orderBy: { createdAt: "desc" },
    });
    let conversationCreated = false;
    let conversationReopened = false;
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
    } else if (conversation.status === "RESOLVED" || conversation.status === "SNOOZED") {
      // A customer reply also unsnoozes (Chatwoot behaviour).
      conversation = await prisma.conversation.update({
        where: { id: conversation.id },
        data: { status: "OPEN", snoozedUntil: null },
      });
      conversationReopened = true;
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
          metadata: { ...(normalized.metadata ?? {}), raw: normalized.raw } as Prisma.InputJsonValue,
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

    // Outgoing webhooks (Phase 12) — self-catching, never blocks or
    // breaks ingestion.
    if (conversationCreated) {
      await outgoingWebhookDispatch.conversationEvent(
        workspaceId,
        "conversation.created",
        conversation.id,
      );
    } else if (conversationReopened) {
      await outgoingWebhookDispatch.conversationEvent(
        workspaceId,
        "conversation.reopened",
        conversation.id,
      );
    }
    await outgoingWebhookDispatch.messageCreated(workspaceId, unified);

    // Automations (Phase 13B) — self-catching hook, runs after ingest.
    if (conversationCreated) {
      await fireAutomationEvent(workspaceId, "conversation.created", {
        conversationId: conversation.id,
        messageBody: unified.content,
      });
    }
    await fireAutomationEvent(workspaceId, "message.created", {
      conversationId: conversation.id,
      messageBody: unified.content,
    });

    // Notifications (Phase 13E) — self-catching producers.
    if (conversationCreated) {
      await notificationService.notifyNewConversation(workspaceId, conversation.id);
    } else {
      await notificationService.notifyNewInboundMessage(
        workspaceId,
        conversation.id,
        unified.content,
      );
    }

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
    input: {
      content?: string;
      type?: MessageType;
      /** WhatsApp template send (Phase 6) — see validations below. */
      templateName?: string;
      templateLanguage?: string;
      templateParams?: string[];
      previewText?: string;
      optInConfirmed?: boolean;
      /**
       * Extra message metadata (e.g. { viaAutomation } for automation
       * sends, so the AI auto-reply takeover guard can tell automation
       * output from a human agent's own typing).
       */
      metadata?: Record<string, unknown>;
    },
  ): Promise<UnifiedMessage> {
    await requireWorkspacePermission(actorUserId, workspaceId, "conversations.reply");
    const conversation = await prisma.conversation.findFirst({
      where: { id: conversationId, workspaceId },
    });
    if (!conversation) throw AppError.notFound("Conversation not found");
    const channel = await prisma.channel.findUnique({
      where: { id: conversation.channelId },
      select: { provider: true },
    });
    // Website live chat has no external transport: delivery IS the
    // persisted row, which the visitor's widget polls — so a website
    // message is SENT the moment it is created. Queueing it behind
    // the worker would show "queued" in the inbox while the visitor
    // is already reading it (seen live 2026-11-20).
    const isWebsiteChannel = channel?.provider === "WEBSITE";

    const isTemplateSend = Boolean(input.templateName) || input.type === "TEMPLATE";
    let messageType: MessageType = input.type ?? "TEXT";
    let body: string;
    let metadata: Prisma.InputJsonValue | undefined;
    if (isTemplateSend) {
      if (channel?.provider !== "WHATSAPP") {
        throw AppError.badRequest("Template messages are only supported on WhatsApp channels.");
      }
      if (!input.templateName) {
        throw AppError.badRequest("A template name is required for a template send.");
      }
      // Opt-in gate (Phase 6 v1): WhatsApp requires the customer to
      // have opted in before a business sends a template message. The
      // dashboard asks the agent to confirm this on every template
      // send; the confirmation + who confirmed are recorded on the
      // message. There is deliberately no CRM consent database yet.
      if (input.optInConfirmed !== true) {
        throw AppError.badRequest(
          "Template sends require confirmed customer opt-in (optInConfirmed). Confirm the customer has opted in to receive WhatsApp messages from this business.",
        );
      }
      messageType = "TEMPLATE";
      body = input.previewText ?? input.content ?? input.templateName;
      metadata = {
        whatsappTemplate: {
          name: input.templateName,
          language: input.templateLanguage ?? "en_US",
          params: input.templateParams ?? [],
        },
        optInConfirmed: true,
        optInConfirmedBy: actorUserId,
      } as Prisma.InputJsonValue;
    } else {
      if (!input.content) throw AppError.badRequest("Message content is required.");
      body = input.content;
      if (input.metadata) metadata = input.metadata as Prisma.InputJsonValue;
    }

    const created = await prisma.message.create({
      data: {
        conversationId,
        direction: "OUTBOUND",
        type: messageType,
        body,
        senderType: "AGENT",
        senderUserId: actorUserId,
        status: isWebsiteChannel ? "SENT" : "QUEUED",
        ...(isWebsiteChannel ? { externalMessageId: `website-${randomUUID()}` } : {}),
        ...(metadata !== undefined ? { metadata } : {}),
      },
      include: { attachments: true },
    });
    await prisma.conversation.update({
      where: { id: conversationId },
      data: { lastMessageAt: new Date() },
    });

    if (!isWebsiteChannel) {
      await getQueues().outbound.add(
        "outbound",
        { messageId: created.id, workspaceId, channelId: conversation.channelId },
        { attempts: 3, backoff: { type: "exponential", delay: 1000 } },
      );
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
    await outgoingWebhookDispatch.messageCreated(workspaceId, unified);
    return unified;
  },

  /**
   * Agent sends a file from the composer (image/video/audio/document).
   * The bytes are uploaded to the platform FIRST (provider.uploadMedia)
   * and the returned platform reference is stored as the attachment's
   * originalUrl; delivery then flows through the normal queued path —
   * deliverOutboundMessage calls provider.sendMessage with that
   * reference, so window checks, retries and channel ERROR marking all
   * apply exactly as for text. An upload failure throws before any
   * message row exists, so the composer can show the platform's error.
   */
  async sendOutboundMedia(
    actorUserId: string,
    workspaceId: string,
    conversationId: string,
    input: { bytes: Buffer; fileName: string; mimeType: string; caption?: string },
  ): Promise<UnifiedMessage> {
    await requireWorkspacePermission(actorUserId, workspaceId, "conversations.reply");
    const conversation = await prisma.conversation.findFirst({
      where: { id: conversationId, workspaceId },
    });
    if (!conversation) throw AppError.notFound("Conversation not found");
    const channel = await prisma.channel.findUnique({
      where: { id: conversation.channelId },
    });
    if (!channel) throw AppError.notFound("Channel not found");
    if (channel.status !== "CONNECTED") {
      throw AppError.badRequest("This channel is not connected, so files cannot be sent.");
    }
    if (input.bytes.length === 0) throw AppError.badRequest("The file is empty.");
    if (input.bytes.length > MAX_MEDIA_BYTES) {
      throw AppError.badRequest("File is too large — the limit is 16 MB.");
    }
    const kind = mediaKindForMime(input.mimeType);

    const provider = getProvider(providerEnumToId(channel.provider));
    if (!provider.uploadMedia) {
      throw AppError.badRequest(
        `Sending files is not supported on ${channel.provider} channels yet.`,
      );
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
      ...(channel.config &&
      typeof channel.config === "object" &&
      !Array.isArray(channel.config)
        ? { config: channel.config as Record<string, unknown> }
        : {}),
    };
    const { ref } = await provider.uploadMedia({
      channel: channelContext,
      media: { bytes: input.bytes, mimeType: input.mimeType, fileName: input.fileName },
    });

    const messageType: MessageType =
      kind === "image" ? "IMAGE" : kind === "video" ? "VIDEO" : kind === "audio" ? "AUDIO" : "FILE";
    const caption = input.caption?.trim();
    // Same website rule as text sends: no external transport, the
    // persisted row is the delivery — persist as SENT, never queue.
    const isWebsiteChannel = channel.provider === "WEBSITE";
    const created = await prisma.message.create({
      data: {
        conversationId,
        direction: "OUTBOUND",
        type: messageType,
        body: caption ? caption : null,
        senderType: "AGENT",
        senderUserId: actorUserId,
        status: isWebsiteChannel ? "SENT" : "QUEUED",
        ...(isWebsiteChannel ? { externalMessageId: `website-${randomUUID()}` } : {}),
        attachments: {
          create: {
            originalUrl: ref,
            mimeType: input.mimeType,
            fileName: input.fileName,
            size: input.bytes.length,
          },
        },
      },
      include: { attachments: true },
    });
    // Keep our own copy of the bytes: some platforms (Meta) return an
    // attachment id that can be re-sent but never downloaded again, so
    // without this the thread could only show a file chip for media the
    // agent sent. The media route serves these bytes for previews.
    const createdAttachment = created.attachments[0];
    if (createdAttachment) {
      await prisma.storedMedia.create({
        data: {
          attachmentId: createdAttachment.id,
          mimeType: input.mimeType,
          data: Uint8Array.from(input.bytes),
        },
      });
    }
    await prisma.conversation.update({
      where: { id: conversationId },
      data: { lastMessageAt: new Date() },
    });
    if (!isWebsiteChannel) {
      await getQueues().outbound.add(
        "outbound",
        { messageId: created.id, workspaceId, channelId: conversation.channelId },
        { attempts: 3, backoff: { type: "exponential", delay: 1000 } },
      );
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
    await outgoingWebhookDispatch.messageCreated(workspaceId, unified);
    return unified;
  },

  /**
   * Re-queue a FAILED outbound message for delivery (the composer's
   * Retry action). The message goes back to QUEUED and the normal
   * outbound worker path (window checks, retries, status events)
   * takes it from there.
   */
  async retryOutboundMessage(
    actorUserId: string,
    workspaceId: string,
    conversationId: string,
    messageId: string,
  ): Promise<UnifiedMessage> {
    await requireWorkspacePermission(actorUserId, workspaceId, "conversations.reply");
    const conversation = await prisma.conversation.findFirst({
      where: { id: conversationId, workspaceId },
      select: { id: true, channelId: true, contactId: true },
    });
    if (!conversation) throw AppError.notFound("Conversation not found");
    const message = await prisma.message.findFirst({
      where: { id: messageId, conversationId },
    });
    if (!message) throw AppError.notFound("Message not found");
    if (
      message.direction !== "OUTBOUND" ||
      message.type === "PRIVATE_NOTE" ||
      message.type === "SYSTEM"
    ) {
      throw AppError.badRequest("Only customer messages can be retried");
    }
    if (message.status !== "FAILED") {
      throw AppError.badRequest("Only failed messages can be retried");
    }
    const updated = await prisma.message.update({
      where: { id: messageId },
      data: { status: "QUEUED" },
      include: { attachments: true },
    });
    await getQueues().outbound.add(
      "outbound",
      { messageId, workspaceId, channelId: conversation.channelId },
      { attempts: 3, backoff: { type: "exponential", delay: 1000 } },
    );
    await emitToWorkspaceAndConversation(workspaceId, conversationId, "message.status_updated", {
      workspaceId,
      conversationId,
      messageId,
      status: "QUEUED",
      externalMessageId: updated.externalMessageId,
    });
    return toUnifiedMessage({
      ...updated,
      conversation: {
        workspaceId,
        channelId: conversation.channelId,
        contactId: conversation.contactId,
      },
    });
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
      ...(channel.config &&
      typeof channel.config === "object" &&
      !Array.isArray(channel.config)
        ? { config: channel.config as Record<string, unknown> }
        : {}),
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

    // WhatsApp 24-hour customer service window (Phase 6): free-form
    // messages are only permitted within 24h of the customer's most
    // recent inbound message. Approved TEMPLATE messages skip this
    // check — they are WhatsApp's sanctioned outside-window path.
    const messageMetadata = toMetadata(message.metadata);
    const waTemplate =
      messageMetadata?.whatsappTemplate &&
      typeof messageMetadata.whatsappTemplate === "object" &&
      !Array.isArray(messageMetadata.whatsappTemplate)
        ? (messageMetadata.whatsappTemplate as {
            name?: unknown;
            language?: unknown;
            params?: unknown;
          })
        : null;
    const isWhatsAppTemplate =
      channel.provider === "WHATSAPP" &&
      (message.type === "TEMPLATE" || typeof waTemplate?.name === "string");
    if (channel.provider === "WHATSAPP" && !isWhatsAppTemplate) {
      const latestInbound = await prisma.message.findFirst({
        where: { conversationId: conversation.id, direction: "INBOUND" },
        orderBy: { sentAt: "desc" },
        select: { sentAt: true },
      });
      const windowMs = 24 * 60 * 60 * 1000;
      if (!latestInbound || Date.now() - latestInbound.sentAt.getTime() > windowMs) {
        return markFailed(
          "Outside WhatsApp's 24-hour customer service window — free-form messages can't be sent. Send an approved template message instead.",
          { windowViolation: true },
        );
      }
    }

    // Email threading (Gmail, Phase 9): replies must carry the
    // thread id plus the subject / In-Reply-To / References of the
    // thread's latest inbound message (stored in its metadata at
    // ingest). Other providers ignore these fields.
    let emailThreading: { subject?: string; inReplyTo?: string; references?: string } = {};
    if (channel.provider === "GMAIL") {
      const latestInbound = await prisma.message.findFirst({
        where: { conversationId: conversation.id, direction: "INBOUND" },
        orderBy: { sentAt: "desc" },
        select: { metadata: true },
      });
      const meta = toMetadata(latestInbound?.metadata ?? null);
      emailThreading = {
        ...(typeof meta?.subject === "string" ? { subject: meta.subject } : {}),
        ...(typeof meta?.rfcMessageId === "string" ? { inReplyTo: meta.rfcMessageId } : {}),
        ...(typeof meta?.references === "string" ? { references: meta.references } : {}),
      };
    }

    try {
      const result = await provider.sendMessage({
        channel: channelContext,
        toExternalId: identity.externalUserId,
        message: {
          type: message.type,
          ...(message.body !== null ? { body: message.body } : {}),
          ...(conversation.externalThreadId
            ? { externalThreadId: conversation.externalThreadId }
            : {}),
          ...emailThreading,
          attachments: message.attachments
            .filter((a) => a.originalUrl !== null)
            .map((a) => ({
              url: a.originalUrl as string,
              ...(a.mimeType ? { mimeType: a.mimeType } : {}),
              ...(a.fileName ? { fileName: a.fileName } : {}),
              ...(a.size !== null ? { size: a.size } : {}),
            })),
          ...(isWhatsAppTemplate && typeof waTemplate?.name === "string"
            ? {
                templateName: waTemplate.name,
                templateLanguage:
                  typeof waTemplate.language === "string" ? waTemplate.language : "en_US",
                templateParams: Array.isArray(waTemplate.params)
                  ? waTemplate.params.filter(
                      (param): param is string => typeof param === "string",
                    )
                  : [],
              }
            : {}),
        },
      });
      await prisma.message.update({
        where: { id: messageId },
        data: { status: "SENT", externalMessageId: result.externalMessageId, sentAt: new Date() },
      });
      // A successful send proves the credential works again — clear
      // a previous ERROR state (e.g. after the user reconnected).
      if (channel.status === "ERROR") {
        const config = channelConfigObject(channel.config);
        delete config.lastError;
        delete config.lastErrorAt;
        await prisma.channel.update({
          where: { id: channel.id },
          data: { status: "CONNECTED", config: config as Prisma.InputJsonValue },
        });
      }
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
        // A dead credential is a channel-level problem, not just a
        // message failure: flag the channel ERROR with the reason so
        // the Channels page can show it and offer reconnect.
        if (isProviderAuthError(error) && channel.status !== "ERROR") {
          try {
            await prisma.channel.update({
              where: { id: channel.id },
              data: {
                status: "ERROR",
                config: {
                  ...channelConfigObject(channel.config),
                  lastError: error instanceof Error ? error.message : "Provider auth failed",
                  lastErrorAt: new Date().toISOString(),
                } as Prisma.InputJsonValue,
              },
            });
          } catch {
            // Channel flagging must never mask the message outcome.
          }
        }
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
      // FAILED receipts (WhatsApp Phase 6): a provider-reported failure
      // settles a not-yet-delivered outbound message as FAILED with the
      // provider's error text. It never overwrites DELIVERED/READ —
      // a message the customer already received did not fail.
      if (update.status === "FAILED") {
        if (candidate.status !== "QUEUED" && candidate.status !== "SENT") return false;
        const failedMetadata: Record<string, unknown> = {
          ...(toMetadata(candidate.metadata) ?? {}),
          error: update.error ?? "The provider reported a delivery failure.",
          deliveryFailedAt: update.at.toISOString(),
        };
        await prisma.message.update({
          where: { id: candidate.id },
          data: {
            status: "FAILED",
            metadata: failedMetadata as Prisma.InputJsonValue,
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
            status: "FAILED",
            error: failedMetadata.error,
          },
        );
        return true;
      }
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
