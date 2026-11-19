import { NextResponse } from "next/server";

import { apiError, parseJsonBody, requireApiUser } from "@/lib/api";
import { websiteChannelCreateSchema } from "@/lib/validations";
import { websiteChannelService } from "@/services/website-channel.service";

interface RouteContext {
  params: Promise<{ workspaceId: string }>;
}

/**
 * POST /api/workspaces/[workspaceId]/channels/website
 * Create a website live-chat channel: generates the public website
 * token used by the widget snippet and stores the widget settings.
 */
export async function POST(request: Request, context: RouteContext) {
  try {
    const user = await requireApiUser(request);
    const { workspaceId } = await context.params;
    const input = websiteChannelCreateSchema.parse(await parseJsonBody(request));
    const channel = await websiteChannelService.createWebsiteChannel(user.id, workspaceId, input);
    return NextResponse.json(
      {
        channel: {
          id: channel.id,
          provider: channel.provider,
          externalAccountId: channel.externalAccountId,
          displayName: channel.displayName,
          status: channel.status,
        },
      },
      { status: 201 },
    );
  } catch (error) {
    return apiError(error);
  }
}
