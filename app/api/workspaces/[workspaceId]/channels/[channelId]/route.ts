import { NextResponse } from "next/server";

import { apiError, requireApiUser } from "@/lib/api";
import { metaConnectionService } from "@/services/meta-connection.service";

interface RouteContext {
  params: Promise<{ workspaceId: string; channelId: string }>;
}

/**
 * DELETE /api/workspaces/[workspaceId]/channels/[channelId]
 * Disconnects a channel: best-effort provider unsubscribe, stored
 * credential deleted, channel marked DISCONNECTED. Conversation
 * history is preserved.
 *
 * With ?permanent=true the channel is instead DELETED outright:
 * disconnected first if needed, then the row (and, by cascade, its
 * credential, contact identities, conversations and messages) is
 * removed. Irreversible.
 */
export async function DELETE(request: Request, context: RouteContext) {
  try {
    const user = await requireApiUser(request);
    const { workspaceId, channelId } = await context.params;
    if (new URL(request.url).searchParams.get("permanent") === "true") {
      await metaConnectionService.deleteChannelPermanently(user.id, workspaceId, channelId);
      return NextResponse.json({ ok: true, deleted: true });
    }
    const channel = await metaConnectionService.disconnectChannel(user.id, workspaceId, channelId);
    return NextResponse.json({
      channel: {
        id: channel.id,
        provider: channel.provider,
        externalAccountId: channel.externalAccountId,
        displayName: channel.displayName,
        status: channel.status,
      },
    });
  } catch (error) {
    return apiError(error);
  }
}
