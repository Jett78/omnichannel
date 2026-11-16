import { NextResponse } from "next/server";

import { apiError, requireApiUser } from "@/lib/api";
import { channelService } from "@/services/channel.service";

interface RouteContext {
  params: Promise<{ workspaceId: string }>;
}

/**
 * POST /api/workspaces/[workspaceId]/channels/mock-connect
 * DEV/TEST ONLY — connects the mock provider channel for this workspace.
 * The mock is not a real platform; no external account is involved.
 */
export async function POST(request: Request, context: RouteContext) {
  try {
    const user = await requireApiUser(request);
    const { workspaceId } = await context.params;
    const channel = await channelService.connectMockChannel(user.id, workspaceId);
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
