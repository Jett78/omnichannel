import { AppError } from "@/lib/errors";
import { decryptText, encryptText } from "@/lib/encryption";
import { prisma } from "@/lib/prisma";
import { requireWorkspacePermission } from "@/lib/workspace-auth";

/**
 * Channel credentials — OAuth tokens are encrypted at rest
 * (AES-256-GCM, lib/encryption.ts) and NEVER returned to the browser.
 * API routes may only expose metadata (hasToken / expiry / scopes).
 */
export interface ChannelCredentialMeta {
  hasToken: boolean;
  hasRefreshToken: boolean;
  tokenExpiresAt: Date | null;
  scopes: string[];
}

export const channelCredentialService = {
  /** Store (encrypt) tokens for a channel that belongs to the workspace. */
  async setChannelCredential(
    userId: string,
    workspaceId: string,
    channelId: string,
    input: {
      accessToken: string;
      refreshToken?: string;
      tokenExpiresAt?: Date;
      scopes?: string[];
    },
  ): Promise<ChannelCredentialMeta> {
    await requireWorkspacePermission(userId, workspaceId, "channels.manage");
    const channel = await prisma.channel.findFirst({ where: { id: channelId, workspaceId } });
    if (!channel) throw AppError.notFound("Channel not found");

    const data = {
      encryptedAccessToken: encryptText(input.accessToken),
      encryptedRefreshToken: input.refreshToken ? encryptText(input.refreshToken) : null,
      tokenExpiresAt: input.tokenExpiresAt ?? null,
      scopes: input.scopes ?? [],
    };
    const saved = await prisma.channelCredential.upsert({
      where: { channelId },
      create: { channelId, ...data },
      update: data,
    });
    return {
      hasToken: true,
      hasRefreshToken: saved.encryptedRefreshToken !== null,
      tokenExpiresAt: saved.tokenExpiresAt,
      scopes: saved.scopes,
    };
  },

  /** Metadata only — safe for API responses. Never includes token material. */
  async getChannelCredentialMeta(
    userId: string,
    workspaceId: string,
    channelId: string,
  ): Promise<ChannelCredentialMeta> {
    await requireWorkspacePermission(userId, workspaceId, "channels.manage");
    const channel = await prisma.channel.findFirst({ where: { id: channelId, workspaceId } });
    if (!channel) throw AppError.notFound("Channel not found");
    const credential = await prisma.channelCredential.findUnique({ where: { channelId } });
    if (!credential) {
      return { hasToken: false, hasRefreshToken: false, tokenExpiresAt: null, scopes: [] };
    }
    return {
      hasToken: true,
      hasRefreshToken: credential.encryptedRefreshToken !== null,
      tokenExpiresAt: credential.tokenExpiresAt,
      scopes: credential.scopes,
    };
  },

  /**
   * SERVER/WORKER INTERNAL USE ONLY. Returns decrypted tokens for making
   * provider API calls. Must never be called from a route handler
   * response path.
   */
  async getDecryptedChannelCredentialForServer(channelId: string): Promise<{
    accessToken: string;
    refreshToken: string | null;
    tokenExpiresAt: Date | null;
    scopes: string[];
  } | null> {
    const credential = await prisma.channelCredential.findUnique({ where: { channelId } });
    if (!credential) return null;
    return {
      accessToken: decryptText(credential.encryptedAccessToken),
      refreshToken: credential.encryptedRefreshToken
        ? decryptText(credential.encryptedRefreshToken)
        : null,
      tokenExpiresAt: credential.tokenExpiresAt,
      scopes: credential.scopes,
    };
  },
};
