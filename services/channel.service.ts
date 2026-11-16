import { AppError } from "@/lib/errors";
import { prisma } from "@/lib/prisma";
import { requireWorkspaceMembership, requireWorkspacePermission } from "@/lib/workspace-auth";
import { getProvider, isMockProviderEnabled } from "@/integrations/registry";
import { channelCredentialService } from "@/services/channel-credential.service";
import type { Channel, Prisma } from "@/generated/prisma/client";

/**
 * Channel service (Phase 4) — workspace-scoped channel management.
 * Today the only connectable provider is the dev/test MOCK provider;
 * real adapters plug into the same shape as they land.
 */
export const channelService = {
  async listChannels(actorUserId: string, workspaceId: string): Promise<Channel[]> {
    await requireWorkspaceMembership(actorUserId, workspaceId);
    return prisma.channel.findMany({ where: { workspaceId }, orderBy: { createdAt: "asc" } });
  },

  /**
   * Connect the MOCK channel for a workspace (dev/test only). Creates
   * the Channel row and stores the mock credential encrypted via the
   * existing credential service. Idempotent: reconnecting returns the
   * existing channel.
   */
  async connectMockChannel(actorUserId: string, workspaceId: string): Promise<Channel> {
    await requireWorkspacePermission(actorUserId, workspaceId, "channels.manage");
    if (!isMockProviderEnabled()) {
      throw AppError.notImplemented("Mock provider (disabled in production)");
    }
    const provider = getProvider("mock");
    const result = await provider.connectAccount({ workspaceId });

    const existing = await prisma.channel.findUnique({
      where: {
        workspaceId_provider_externalAccountId: {
          workspaceId,
          provider: "MOCK",
          externalAccountId: result.externalAccountId,
        },
      },
    });
    const channel =
      existing ??
      (await prisma.channel.create({
        data: {
          workspaceId,
          provider: "MOCK",
          externalAccountId: result.externalAccountId,
          displayName: result.displayName,
          status: "CONNECTED",
          config: (result.config ?? { mock: true }) as Prisma.InputJsonValue,
        },
      }));

    await channelCredentialService.setChannelCredential(actorUserId, workspaceId, channel.id, {
      accessToken: result.credentials.accessToken,
      scopes: result.credentials.scopes,
    });
    return channel;
  },
};
