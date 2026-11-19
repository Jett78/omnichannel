import type { Job } from "bullmq";

import { encryptText } from "@/lib/encryption";
import { prisma } from "@/lib/prisma";
import { scheduleTokenRefreshJob } from "@/lib/token-refresh";
import { GmailApiError } from "@/integrations/gmail/gmail-client";
import {
  GmailProvider,
  gmailProvider,
  normalizeGmailMessage,
} from "@/integrations/gmail/gmail-provider";
import { channelCredentialService } from "@/services/channel-credential.service";
import { messagingService } from "@/services/messaging.service";
import type { Channel, Prisma } from "@/generated/prisma/client";
import type { GmailPollJobData } from "@/types/queue";

/**
 * Gmail poll processor (Phase 9).
 *
 * Gmail v1 is polling-based: a BullMQ job scheduler sweeps every
 * CONNECTED Gmail channel about once a minute. Each poll reads the
 * mailbox's history feed from the cursor stored in
 * `channel.config.gmailHistoryId` (set to the connect-time baseline
 * by the Gmail connection service), fetches the new messages, and
 * feeds them into the engine's idempotent ingest — duplicates are
 * dropped by the [conversationId, externalMessageId] unique key, so
 * overlapping sweeps are safe.
 *
 * Failure handling:
 *  - Access token expired → refreshed lazily here (and persisted +
 *    the refresh chain re-armed); a 401 from the API triggers one
 *    refresh + one retry.
 *  - Refresh token rejected (400/401) → the channel is marked
 *    EXPIRED (a human must reconnect), mirroring the token-refresh
 *    processor.
 *  - History cursor too old (Gmail returns 404) → the cursor resets
 *    to the mailbox's current historyId; mail from the gap is NOT
 *    backfilled silently — "Import recent chats" is the explicit
 *    recovery, and the reset is logged.
 *  - Any other error is logged and left for the next sweep.
 */

export interface GmailPollDeps {
  gmail?: GmailProvider;
}

function configObject(config: unknown): Record<string, unknown> {
  return config && typeof config === "object" && !Array.isArray(config)
    ? (config as Record<string, unknown>)
    : {};
}

async function saveHistoryCursor(channelId: string, config: Record<string, unknown>, historyId: string): Promise<void> {
  await prisma.channel.update({
    where: { id: channelId },
    data: { config: { ...config, gmailHistoryId: historyId } as Prisma.InputJsonValue },
  });
}

export async function pollGmailChannel(
  channel: Channel,
  deps: GmailPollDeps = {},
): Promise<{ ingested: number }> {
  const provider = deps.gmail ?? gmailProvider;
  const credential =
    await channelCredentialService.getDecryptedChannelCredentialForServer(channel.id);
  if (!credential?.accessToken) {
    console.log(`[worker:gmail-poll] channel ${channel.id} has no credential — skipping`);
    return { ingested: 0 };
  }

  let accessToken = credential.accessToken;
  let refreshToken = credential.refreshToken;

  const refreshAccessToken = async (): Promise<boolean> => {
    const currentRefreshToken = refreshToken;
    if (!currentRefreshToken) return false;
    try {
      const next = await provider.refreshToken({
        accessToken,
        refreshToken: currentRefreshToken,
        ...(credential.tokenExpiresAt ? { expiresAt: credential.tokenExpiresAt } : {}),
        scopes: credential.scopes,
      });
      accessToken = next.accessToken;
      refreshToken = next.refreshToken ?? refreshToken;
      await prisma.channelCredential.update({
        where: { channelId: channel.id },
        data: {
          encryptedAccessToken: encryptText(next.accessToken),
          encryptedRefreshToken: refreshToken ? encryptText(refreshToken) : null,
          tokenExpiresAt: next.expiresAt ?? null,
          scopes: next.scopes,
        },
      });
      if (next.expiresAt) {
        try {
          await scheduleTokenRefreshJob(channel.id, channel.workspaceId, next.expiresAt);
        } catch {
          // Best-effort — the next poll refreshes lazily anyway.
        }
      }
      return true;
    } catch (error) {
      if (error instanceof GmailApiError && (error.status === 400 || error.status === 401)) {
        await prisma.channel.update({
          where: { id: channel.id },
          data: { status: "EXPIRED" },
        });
        console.warn(
          `[worker:gmail-poll] channel ${channel.id} refresh token rejected — marked EXPIRED, reconnect required`,
        );
      }
      throw error;
    }
  };

  // Proactive refresh when the stored access token is at/past expiry.
  if (credential.tokenExpiresAt && credential.tokenExpiresAt.getTime() <= Date.now() + 30_000) {
    await refreshAccessToken();
  }

  const config = configObject(channel.config);
  const cursor = typeof config.gmailHistoryId === "string" ? config.gmailHistoryId : undefined;
  if (!cursor) {
    const profile = await provider.getOwnProfile(accessToken);
    if (profile.historyId) await saveHistoryCursor(channel.id, config, profile.historyId);
    console.log(`[worker:gmail-poll] channel ${channel.id} baseline cursor set — polling from now`);
    return { ingested: 0 };
  }

  let listing: { messageIds: string[]; historyId?: string };
  try {
    listing = await provider.listNewMessageIds(accessToken, cursor);
  } catch (error) {
    if (error instanceof GmailApiError && error.status === 401 && (await refreshAccessToken())) {
      listing = await provider.listNewMessageIds(accessToken, cursor);
    } else if (error instanceof GmailApiError && error.status === 404) {
      const profile = await provider.getOwnProfile(accessToken);
      if (profile.historyId) await saveHistoryCursor(channel.id, config, profile.historyId);
      console.warn(
        `[worker:gmail-poll] channel ${channel.id} history cursor expired — reset to current (gap mail needs Import recent chats)`,
      );
      return { ingested: 0 };
    } else {
      throw error;
    }
  }

  let ingested = 0;
  for (const messageId of listing.messageIds) {
    const raw = await provider.getMessage(accessToken, messageId);
    const normalized = normalizeGmailMessage(raw, channel.externalAccountId);
    if (!normalized) continue;
    const result = await messagingService.ingestInboundMessage(
      channel.workspaceId,
      channel.id,
      normalized,
    );
    if (!result.deduplicated) ingested += 1;
  }

  const nextCursor = listing.historyId ?? (await provider.getOwnProfile(accessToken)).historyId;
  if (nextCursor && nextCursor !== cursor) {
    await saveHistoryCursor(channel.id, config, nextCursor);
  }
  if (ingested > 0) {
    console.log(`[worker:gmail-poll] channel ${channel.id}: ${ingested} new message(s) ingested`);
  }
  return { ingested };
}

export async function processGmailPollJob(
  job: Job<GmailPollJobData>,
  deps: GmailPollDeps = {},
): Promise<void> {
  const channels = job.data.channelId
    ? await prisma.channel.findMany({
        where: { id: job.data.channelId, provider: "GMAIL", status: "CONNECTED" },
      })
    : await prisma.channel.findMany({ where: { provider: "GMAIL", status: "CONNECTED" } });

  for (const channel of channels) {
    try {
      await pollGmailChannel(channel, deps);
    } catch (error) {
      // One bad mailbox must not block the sweep for the others; the
      // next tick retries it.
      console.error(
        `[worker:gmail-poll] channel ${channel.id} poll failed: ${
          error instanceof Error ? error.message : "unknown error"
        }`,
      );
    }
  }
}
