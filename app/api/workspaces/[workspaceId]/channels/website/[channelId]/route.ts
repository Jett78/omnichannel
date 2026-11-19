import { NextResponse } from "next/server";

import { apiError, parseJsonBody, requireApiUser } from "@/lib/api";
import { websiteChannelUpdateSchema } from "@/lib/validations";
import { websiteChannelService } from "@/services/website-channel.service";

interface RouteContext {
  params: Promise<{ workspaceId: string; channelId: string }>;
}

/**
 * PATCH /api/workspaces/[workspaceId]/channels/website/[channelId]
 * Update a website channel's name and widget appearance settings.
 */
export async function PATCH(request: Request, context: RouteContext) {
  try {
    const user = await requireApiUser(request);
    const { workspaceId, channelId } = await context.params;
    const input = websiteChannelUpdateSchema.parse(await parseJsonBody(request));
    const channel = await websiteChannelService.updateWebsiteChannel(
      user.id,
      workspaceId,
      channelId,
      input,
    );
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
