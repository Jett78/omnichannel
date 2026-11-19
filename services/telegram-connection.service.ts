import { randomBytes } from "node:crypto";

import { AppError } from "@/lib/errors";
import { getEnv } from "@/lib/env";
import { prisma } from "@/lib/prisma";
import { requireWorkspacePermission } from "@/lib/workspace-auth";
import { TelegramApiError, type TelegramUser } from "@/integrations/telegram/telegram-client";
import { TelegramProvider, telegramProvider } from "@/integrations/telegram/telegram-provider";
import { channelCredentialService } from "@/services/channel-credential.service";
import type { Channel, Prisma } from "@/generated/prisma/client";

/**
 * Telegram connection service (Phase 10).
 *
 * Connect = paste a BotFather bot token. The token is validated
 * against the real Telegram Bot API (getMe) BEFORE anything is
 * stored; the channel is keyed by the bot's Telegram user id, the
 * token is stored encrypted via the channel-credential service, and
 * the deployment's per-channel webhook is registered with Telegram
 * carrying a freshly generated secret token (verified on every
 * inbound call by the webhook route). Reconnecting with a fresh
 * token for the same bot replaces the credential and re-registers
 * the webhook with a new secret. A workspace may connect several
 * bots (one channel each).
 */

export interface TelegramConnectionDeps {
  telegram?: TelegramProvider;
}

export interface TelegramConnectResult {
  channel: Channel;
  bot: TelegramUser;
  subscriptionWarning?: string;
}

export const telegramConnectionService = {
  async connectWithToken(
    actorUserId: string,
    workspaceId: string,
    input: { botToken: string },
    deps: TelegramConnectionDeps = {},
  ): Promise<TelegramConnectResult> {
    await requireWorkspacePermission(actorUserId, workspaceId, "channels.manage");
    const provider = deps.telegram ?? telegramProvider;
    const botToken = input.botToken.trim();

    let bot: TelegramUser;
    try {
      bot = await provider.getBotInfo(botToken);
    } catch (error) {
      if (error instanceof TelegramApiError && error.status === 401) {
        throw AppError.badRequest(
          "Telegram rejected this bot token. Copy the exact token BotFather gave you (it looks like 123456789:AA…) and try again.",
        );
      }
      throw error;
    }

    const externalAccountId = String(bot.id);
    const displayName = bot.username ? `${bot.first_name} (@${bot.username})` : bot.first_name;
    const webhookSecret = randomBytes(32).toString("hex");
    const baseConfig: Record<string, unknown> = {
      connectionMethod: "bot-token",
      username: bot.username ?? null,
      webhookSecret,
    };

    const channel = await prisma.channel.upsert({
      where: {
        workspaceId_provider_externalAccountId: {
          workspaceId,
          provider: "TELEGRAM",
          externalAccountId,
        },
      },
      create: {
        workspaceId,
        provider: "TELEGRAM",
        externalAccountId,
        displayName,
        status: "CONNECTED",
        config: baseConfig as Prisma.InputJsonValue,
      },
      update: {
        displayName,
        status: "CONNECTED",
        config: baseConfig as Prisma.InputJsonValue,
      },
    });

    await channelCredentialService.setChannelCredential(actorUserId, workspaceId, channel.id, {
      accessToken: botToken,
      scopes: [],
    });

    const webhookUrl = `${getEnv().APP_URL.replace(/\/$/, "")}/api/webhooks/telegram/${channel.id}`;
    let subscriptionWarning: string | undefined;
    let webhookSubscription: Record<string, unknown>;
    try {
      await provider.registerWebhook(botToken, webhookUrl, webhookSecret);
      webhookSubscription = { status: "subscribed", at: new Date().toISOString(), url: webhookUrl };
    } catch (error) {
      subscriptionWarning =
        error instanceof Error ? error.message : "Telegram webhook registration failed";
      webhookSubscription = { status: "failed", error: subscriptionWarning };
    }
    const saved = await prisma.channel.update({
      where: { id: channel.id },
      data: {
        config: { ...baseConfig, webhookSubscription } as Prisma.InputJsonValue,
      },
    });

    await prisma.auditLog.create({
      data: {
        workspaceId,
        actorId: actorUserId,
        action: "channel.connected",
        entity: "Channel",
        entityId: channel.id,
        meta: { provider: "TELEGRAM", externalAccountId } as Prisma.InputJsonValue,
      },
    });

    return {
      channel: saved,
      bot,
      ...(subscriptionWarning ? { subscriptionWarning } : {}),
    };
  },
};
