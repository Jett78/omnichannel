import { randomBytes, randomUUID } from "node:crypto";

import { AppError } from "@/lib/errors";
import { prisma } from "@/lib/prisma";
import { getQueues } from "@/lib/queue";
import { providerEnumToId } from "@/types/messaging";
import type { UnifiedMessage } from "@/types/messaging";
import type { OutgoingWebhookEvent } from "@/lib/webhook-events";
import { validateOutgoingWebhookUrl } from "@/lib/webhook-url";
import { requireWorkspacePermission } from "@/lib/workspace-auth";
import type { OutgoingWebhook, Prisma } from "@/generated/prisma/client";

/**
 * Outgoing webhooks (Phase 12) — Chatwoot-style automation
 * webhooks. Workspace admins register HTTP endpoints in Settings;
 * product events are delivered to them as signed JSON POSTs by the
 * worker (workers/processors/outgoing-webhook.processor.ts).
 *
 * Management is gated on `workspace.update` (OWNER/ADMIN). Dispatch
 * is internal and fire-and-forget: it NEVER throws into the message
 * or conversation flow — a broken webhook setup must not break
 * messaging. Private notes and system/activity messages are never
 * dispatched (they have no path to the dispatch helpers).
 */

export interface OutgoingWebhookView {
  id: string;
  name: string;
  url: string;
  secret: string;
  events: string[];
  enabled: boolean;
  createdAt: string;
  lastDelivery: {
    event: string;
    success: boolean;
    statusCode: number | null;
    error: string | null;
    createdAt: string;
  } | null;
}

function toView(
  webhook: OutgoingWebhook & {
    deliveries?: Array<{
      event: string;
      success: boolean;
      statusCode: number | null;
      error: string | null;
      createdAt: Date;
    }>;
  },
): OutgoingWebhookView {
  const last = webhook.deliveries?.[0];
  return {
    id: webhook.id,
    name: webhook.name,
    url: webhook.url,
    secret: webhook.secret,
    events: webhook.events,
    enabled: webhook.enabled,
    createdAt: webhook.createdAt.toISOString(),
    lastDelivery: last
      ? {
          event: last.event,
          success: last.success,
          statusCode: last.statusCode,
          error: last.error,
          createdAt: last.createdAt.toISOString(),
        }
      : null,
  };
}

export const outgoingWebhookService = {
  async listWebhooks(actorUserId: string, workspaceId: string): Promise<OutgoingWebhookView[]> {
    await requireWorkspacePermission(actorUserId, workspaceId, "workspace.update");
    const webhooks = await prisma.outgoingWebhook.findMany({
      where: { workspaceId },
      include: { deliveries: { orderBy: { createdAt: "desc" }, take: 1 } },
      orderBy: { createdAt: "asc" },
    });
    return webhooks.map(toView);
  },

  async createWebhook(
    actorUserId: string,
    workspaceId: string,
    input: { name: string; url: string; events: string[] },
  ): Promise<OutgoingWebhookView> {
    await requireWorkspacePermission(actorUserId, workspaceId, "workspace.update");
    const url = await validateOutgoingWebhookUrl(input.url.trim());
    const webhook = await prisma.outgoingWebhook.create({
      data: {
        workspaceId,
        name: input.name,
        url: url.toString(),
        secret: randomBytes(24).toString("hex"),
        events: input.events,
      },
    });
    await prisma.auditLog.create({
      data: {
        workspaceId,
        actorId: actorUserId,
        action: "webhook.created",
        entity: "OutgoingWebhook",
        entityId: webhook.id,
        meta: { name: webhook.name, url: webhook.url, events: webhook.events } as Prisma.InputJsonValue,
      },
    });
    return toView(webhook);
  },

  async updateWebhook(
    actorUserId: string,
    workspaceId: string,
    webhookId: string,
    input: { name?: string; url?: string; events?: string[]; enabled?: boolean },
  ): Promise<OutgoingWebhookView> {
    await requireWorkspacePermission(actorUserId, workspaceId, "workspace.update");
    const webhook = await prisma.outgoingWebhook.findFirst({
      where: { id: webhookId, workspaceId },
    });
    if (!webhook) throw AppError.notFound("Webhook not found");
    const url = input.url !== undefined ? (await validateOutgoingWebhookUrl(input.url.trim())).toString() : undefined;
    const updated = await prisma.outgoingWebhook.update({
      where: { id: webhook.id },
      data: {
        ...(input.name !== undefined ? { name: input.name } : {}),
        ...(url !== undefined ? { url } : {}),
        ...(input.events !== undefined ? { events: input.events } : {}),
        ...(input.enabled !== undefined ? { enabled: input.enabled } : {}),
      },
      include: { deliveries: { orderBy: { createdAt: "desc" }, take: 1 } },
    });
    return toView(updated);
  },

  async deleteWebhook(actorUserId: string, workspaceId: string, webhookId: string): Promise<void> {
    await requireWorkspacePermission(actorUserId, workspaceId, "workspace.update");
    const webhook = await prisma.outgoingWebhook.findFirst({
      where: { id: webhookId, workspaceId },
    });
    if (!webhook) throw AppError.notFound("Webhook not found");
    await prisma.outgoingWebhook.delete({ where: { id: webhook.id } });
    await prisma.auditLog.create({
      data: {
        workspaceId,
        actorId: actorUserId,
        action: "webhook.deleted",
        entity: "OutgoingWebhook",
        entityId: webhook.id,
        meta: { name: webhook.name } as Prisma.InputJsonValue,
      },
    });
  },

  /** Enqueue a `webhook.test` ping so an admin can verify a receiver. */
  async sendTestPing(actorUserId: string, workspaceId: string, webhookId: string): Promise<void> {
    await requireWorkspacePermission(actorUserId, workspaceId, "workspace.update");
    const webhook = await prisma.outgoingWebhook.findFirst({
      where: { id: webhookId, workspaceId },
    });
    if (!webhook) throw AppError.notFound("Webhook not found");
    const workspace = await prisma.workspace.findUnique({
      where: { id: workspaceId },
      select: { name: true },
    });
    await getQueues().outgoingWebhook.add("outgoing-webhook", {
      webhookId: webhook.id,
      workspaceId,
      event: "webhook.test",
      deliveryId: randomUUID(),
      payload: {
        workspace: { id: workspaceId, name: workspace?.name ?? null },
        test: true,
        message: "This is a test delivery from Unified Omnichannel Inbox.",
      },
    });
  },
};

// ─── Dispatch (internal, fire-and-forget) ─────────────────────────

async function buildConversationData(
  workspaceId: string,
  conversationId: string,
): Promise<Record<string, unknown> | null> {
  const conversation = await prisma.conversation.findFirst({
    where: { id: conversationId, workspaceId },
    include: {
      channel: { select: { provider: true, displayName: true } },
      contact: { select: { id: true, displayName: true, email: true, phone: true } },
      workspace: { select: { id: true, name: true } },
    },
  });
  if (!conversation) return null;
  return {
    workspace: { id: conversation.workspace.id, name: conversation.workspace.name },
    conversation: {
      id: conversation.id,
      status: conversation.status,
      priority: conversation.priority,
      assigneeId: conversation.assigneeId,
      externalThreadId: conversation.externalThreadId,
      createdAt: conversation.createdAt.toISOString(),
      channel: {
        provider: providerEnumToId(conversation.channel.provider),
        displayName: conversation.channel.displayName,
      },
      contact: {
        id: conversation.contact.id,
        name: conversation.contact.displayName,
        email: conversation.contact.email,
        phone: conversation.contact.phone,
      },
    },
  };
}

async function dispatch(
  workspaceId: string,
  event: OutgoingWebhookEvent,
  payload: Record<string, unknown>,
): Promise<void> {
  try {
    const webhooks = await prisma.outgoingWebhook.findMany({
      where: { workspaceId, enabled: true },
      select: { id: true, events: true },
    });
    const targets = webhooks.filter((webhook) => webhook.events.includes(event));
    if (targets.length === 0) return;
    const queues = getQueues();
    for (const target of targets) {
      await queues.outgoingWebhook.add("outgoing-webhook", {
        webhookId: target.id,
        workspaceId,
        event,
        deliveryId: randomUUID(),
        payload,
      });
    }
  } catch (error) {
    // A webhook problem must never break messaging.
    console.error("[outgoing-webhooks] dispatch failed (ignored):", error);
  }
}

export const outgoingWebhookDispatch = {
  async conversationEvent(
    workspaceId: string,
    event: OutgoingWebhookEvent,
    conversationId: string,
  ): Promise<void> {
    try {
      const data = await buildConversationData(workspaceId, conversationId);
      if (data) await dispatch(workspaceId, event, data);
    } catch (error) {
      console.error("[outgoing-webhooks] conversation dispatch failed (ignored):", error);
    }
  },

  async messageCreated(workspaceId: string, message: UnifiedMessage): Promise<void> {
    try {
      const data = await buildConversationData(workspaceId, message.conversationId);
      if (!data) return;
      data.message = {
        id: message.id,
        direction: message.direction,
        type: message.messageType,
        body: message.content,
        senderType: message.senderType,
        status: message.status,
        externalMessageId: message.externalMessageId,
        createdAt: message.createdAt.toISOString(),
        attachments: message.attachments.map((attachment) => ({
          fileName: attachment.fileName ?? null,
          mimeType: attachment.mimeType ?? null,
          size: attachment.size ?? null,
        })),
      };
      await dispatch(workspaceId, "message.created", data);
    } catch (error) {
      console.error("[outgoing-webhooks] message dispatch failed (ignored):", error);
    }
  },
};
