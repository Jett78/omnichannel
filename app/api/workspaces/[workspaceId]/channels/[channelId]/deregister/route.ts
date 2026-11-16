import { NextResponse } from "next/server";

import { apiError, requireApiUser } from "@/lib/api";
import { whatsappConnectionService } from "@/services/whatsapp-connection.service";

interface RouteContext {
  params: Promise<{ workspaceId: string; channelId: string }>;
}

/**
 * POST /api/workspaces/[workspaceId]/channels/[channelId]/deregister
 * Deregisters a WhatsApp phone number from the Cloud API.
 */
export async function POST(request: Request, context: RouteContext) {
  try {
    const user = await requireApiUser(request);
    const { workspaceId, channelId } = await context.params;
    const channel = await whatsappConnectionService.deregisterPhoneNumber(
      user.id,
      workspaceId,
      channelId,
    );
    return NextResponse.json({
      channel: {
        id: channel.id,
        provider: channel.provider,
        externalAccountId: channel.externalAccountId,
        displayName: channel.displayName,
        status: channel.status,
      },
      deregistered: true,
    });
  } catch (error) {
    return apiError(error);
  }
}
