import type { Job } from "bullmq";

import { encryptText } from "@/lib/encryption";
import { prisma } from "@/lib/prisma";
import { TOKEN_REFRESH_LEAD_MS, scheduleTokenRefreshJob } from "@/lib/token-refresh";
import { getProvider } from "@/integrations/registry";
import type { IMessagingProvider } from "@/integrations/types";
import { channelCredentialService } from "@/services/channel-credential.service";
import { providerEnumToId } from "@/types/messaging";
import type { TokenRefreshJobData } from "@/types/queue";

/**
 * Token-refresh processor (implemented in Phase 8; the queue and job
 * contract date from Phase 4).
 *
 * Behaviour:
 *  - Channel gone or no longer CONNECTED → nothing to do.
 *  - No stored refresh token / expiry → nothing to refresh (e.g.
 *    WhatsApp system-user tokens, Meta Page tokens — long-lived or
 *    manually rotated).
 *  - Fired early (expiry still beyond the lead window) → re-arm for
 *    the right time and return.
 *  - Provider does not implement refreshToken → nothing to do.
 *  - Success → persist the ROTATED credential (encrypted, the same
 *    fields channelCredentialService writes — the worker has no
 *    acting user, so it updates the row directly) and re-arm for the
 *    new expiry.
 *  - The provider rejects the refresh token (HTTP 400/401 — revoked
 *    or expired refresh token) → mark the channel EXPIRED so the
 *    dashboard shows it needs a human reconnect; do not retry.
 *  - Any other failure → throw, BullMQ retries (attempts: 3).
 *
 * The provider is injectable for tests; production resolves it from
 * the registry by the channel's provider.
 */
export interface TokenRefreshDeps {
  provider?: IMessagingProvider;
}

export async function processTokenRefreshJob(
  job: Job<TokenRefreshJobData>,
  deps: TokenRefreshDeps = {},
): Promise<void> {
  const { channelId, workspaceId } = job.data;
  const channel = await prisma.channel.findFirst({ where: { id: channelId, workspaceId } });
  if (!channel) {
    console.log(`[worker:token-refresh] channel ${channelId} not found — skipping`);
    return;
  }
  if (channel.status !== "CONNECTED") {
    console.log(
      `[worker:token-refresh] channel ${channelId} is ${channel.status} — skipping refresh`,
    );
    return;
  }

  const credential =
    await channelCredentialService.getDecryptedChannelCredentialForServer(channelId);
  if (!credential?.refreshToken || !credential.tokenExpiresAt) {
    console.log(`[worker:token-refresh] channel ${channelId} has nothing refreshable — skipping`);
    return;
  }

  if (credential.tokenExpiresAt.getTime() - Date.now() > TOKEN_REFRESH_LEAD_MS) {
    await scheduleTokenRefreshJob(channelId, workspaceId, credential.tokenExpiresAt);
    console.log(`[worker:token-refresh] channel ${channelId} fired early — re-armed`);
    return;
  }

  // Note: BullMQ invokes processors as (job, token) — the deps
  // parameter only counts when a test passes a real object.
  const injectedProvider =
    typeof deps === "object" && deps !== null ? deps.provider : undefined;
  let provider: IMessagingProvider;
  try {
    provider = injectedProvider ?? getProvider(providerEnumToId(channel.provider));
  } catch {
    console.warn(
      `[worker:token-refresh] no provider registered for channel ${channelId} — skipping`,
    );
    return;
  }
  if (!provider.refreshToken) {
    console.log(
      `[worker:token-refresh] provider ${provider.id} does not support token refresh — skipping`,
    );
    return;
  }

  try {
    const next = await provider.refreshToken({
      accessToken: credential.accessToken,
      refreshToken: credential.refreshToken,
      expiresAt: credential.tokenExpiresAt,
      scopes: credential.scopes,
    });
    await prisma.channelCredential.update({
      where: { channelId },
      data: {
        encryptedAccessToken: encryptText(next.accessToken),
        encryptedRefreshToken: next.refreshToken ? encryptText(next.refreshToken) : null,
        tokenExpiresAt: next.expiresAt ?? null,
        scopes: next.scopes,
      },
    });
    if (next.expiresAt) {
      await scheduleTokenRefreshJob(channelId, workspaceId, next.expiresAt);
    }
    console.log(`[worker:token-refresh] channel ${channelId} token refreshed`);
  } catch (error) {
    const status = (error as { status?: unknown }).status;
    if (status === 400 || status === 401) {
      await prisma.channel.update({
        where: { id: channelId },
        data: { status: "EXPIRED" },
      });
      console.warn(
        `[worker:token-refresh] channel ${channelId} refresh token rejected (HTTP ${String(status)}) — channel marked EXPIRED, reconnect required`,
      );
      return;
    }
    throw error;
  }
}
