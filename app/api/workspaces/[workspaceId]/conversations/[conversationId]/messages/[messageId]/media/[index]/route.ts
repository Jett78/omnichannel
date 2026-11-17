import { NextResponse } from "next/server";

import { apiError, requireApiUser } from "@/lib/api";
import { AppError } from "@/lib/errors";
import { prisma } from "@/lib/prisma";
import { requireWorkspacePermission } from "@/lib/workspace-auth";
import { getProvider } from "@/integrations/registry";
import { providerEnumToId } from "@/types/messaging";
import type { ChannelContext } from "@/integrations/types";
import { channelCredentialService } from "@/services/channel-credential.service";

interface RouteContext {
  params: Promise<{
    workspaceId: string;
    conversationId: string;
    messageId: string;
    index: string;
  }>;
}

/**
 * GET …/messages/{messageId}/media/{index} — stream one attachment's
 * bytes for the inbox thread preview. Platform references that resolve
 * to bytes (WhatsApp "whatsapp-media:{id}") are downloaded live with
 * the channel's credential; references that cannot be fetched back
 * (Meta "meta-attachment:{id}") return 404 and the UI shows a file chip
 * instead of a preview.
 */
export async function GET(request: Request, context: RouteContext) {
  try {
    const user = await requireApiUser(request);
    const { workspaceId, conversationId, messageId, index } = await context.params;
    await requireWorkspacePermission(user.id, workspaceId, "conversations.view");

    const message = await prisma.message.findFirst({
      where: { id: messageId, conversationId },
      include: {
        attachments: { orderBy: { createdAt: "asc" } },
        conversation: { include: { channel: true } },
      },
    });
    if (!message || message.conversation.workspaceId !== workspaceId) {
      throw AppError.notFound("Message not found");
    }
    const attachment = message.attachments[Number(index)];
    if (!attachment?.originalUrl) throw AppError.notFound("Attachment not found");
    const ref = attachment.originalUrl;
    if (ref.startsWith("meta-attachment:") || ref.startsWith("mock-media:")) {
      throw AppError.notFound("A preview is not available for this attachment");
    }

    const channel = message.conversation.channel;
    const provider = getProvider(providerEnumToId(channel.provider));
    if (!provider.downloadMedia) throw AppError.notFound("Media download is not supported");
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
    const bytes = await provider.downloadMedia(ref, channelContext);
    return new NextResponse(new Uint8Array(bytes), {
      headers: {
        "Content-Type": attachment.mimeType ?? "application/octet-stream",
        "Cache-Control": "private, max-age=300",
        ...(attachment.fileName
          ? { "Content-Disposition": `inline; filename="${attachment.fileName.replace(/"/g, "")}"` }
          : {}),
      },
    });
  } catch (error) {
    return apiError(error);
  }
}
