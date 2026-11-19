import { randomBytes } from "node:crypto";

import { AppError } from "@/lib/errors";
import { prisma } from "@/lib/prisma";
import { requireWorkspacePermission } from "@/lib/workspace-auth";
import type { Channel, Prisma } from "@/generated/prisma/client";

/**
 * Website live-chat channel management (Phase 11) — the authed
 * (dashboard) side. Creating a channel generates its public website
 * token (stored as the channel's externalAccountId and embedded in
 * the site's widget snippet — it identifies the site, it is not a
 * secret) plus the widget's appearance settings in channel config.
 * A workspace may run several website channels (one per site).
 */

export interface WebsiteChannelInput {
  name: string;
  websiteUrl?: string;
  widgetColor?: string;
  welcomeTitle?: string;
  welcomeTagline?: string;
  preChatForm?: boolean;
}

export const DEFAULT_WIDGET_COLOR = "#4f46e5";

function settingsFrom(input: WebsiteChannelInput, existing?: Record<string, unknown>) {
  return {
    connectionMethod: "widget",
    websiteUrl: input.websiteUrl ?? (existing?.websiteUrl as string | undefined) ?? null,
    widgetColor: input.widgetColor ?? (existing?.widgetColor as string | undefined) ?? DEFAULT_WIDGET_COLOR,
    welcomeTitle: input.welcomeTitle ?? (existing?.welcomeTitle as string | undefined) ?? "Chat with us",
    welcomeTagline:
      input.welcomeTagline ??
      (existing?.welcomeTagline as string | undefined) ??
      "We usually reply within a few minutes.",
    preChatForm: input.preChatForm ?? (existing?.preChatForm as boolean | undefined) ?? true,
  };
}

export const websiteChannelService = {
  async createWebsiteChannel(
    actorUserId: string,
    workspaceId: string,
    input: WebsiteChannelInput,
  ): Promise<Channel> {
    await requireWorkspacePermission(actorUserId, workspaceId, "channels.manage");
    const websiteToken = `wt_${randomBytes(24).toString("hex")}`;
    const channel = await prisma.channel.create({
      data: {
        workspaceId,
        provider: "WEBSITE",
        externalAccountId: websiteToken,
        displayName: input.name,
        status: "CONNECTED",
        config: settingsFrom(input) as Prisma.InputJsonValue,
      },
    });
    await prisma.auditLog.create({
      data: {
        workspaceId,
        actorId: actorUserId,
        action: "channel.connected",
        entity: "Channel",
        entityId: channel.id,
        meta: { provider: "WEBSITE", externalAccountId: websiteToken } as Prisma.InputJsonValue,
      },
    });
    return channel;
  },

  async updateWebsiteChannel(
    actorUserId: string,
    workspaceId: string,
    channelId: string,
    input: Partial<WebsiteChannelInput>,
  ): Promise<Channel> {
    await requireWorkspacePermission(actorUserId, workspaceId, "channels.manage");
    const channel = await prisma.channel.findFirst({
      where: { id: channelId, workspaceId, provider: "WEBSITE" },
    });
    if (!channel) throw AppError.notFound("Website channel not found");
    const existing =
      channel.config && typeof channel.config === "object" && !Array.isArray(channel.config)
        ? (channel.config as Record<string, unknown>)
        : {};
    const updated = await prisma.channel.update({
      where: { id: channel.id },
      data: {
        ...(input.name ? { displayName: input.name } : {}),
        config: settingsFrom(input as WebsiteChannelInput, existing) as Prisma.InputJsonValue,
      },
    });
    return updated;
  },
};
