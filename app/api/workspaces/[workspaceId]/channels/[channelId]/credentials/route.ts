import { NextResponse } from "next/server";

import { apiError, parseJsonBody, requireApiUser } from "@/lib/api";
import { whatsappCredentialsUpdateSchema } from "@/lib/validations";
import { whatsappConnectionService } from "@/services/whatsapp-connection.service";

interface RouteContext {
  params: Promise<{ workspaceId: string; channelId: string }>;
}

/**
 * PATCH /api/workspaces/[workspaceId]/channels/[channelId]/credentials
 * Replaces a WhatsApp channel's stored system-user token (Edit in
 * Channels). The new token is verified against the channel's WABA and
 * phone number before it is stored; the response never contains token
 * material.
 */
export async function PATCH(request: Request, context: RouteContext) {
  try {
    const user = await requireApiUser(request);
    const { workspaceId, channelId } = await context.params;
    const input = whatsappCredentialsUpdateSchema.parse(await parseJsonBody(request));
    const result = await whatsappConnectionService.updateManualCredentials(
      user.id,
      workspaceId,
      channelId,
      { accessToken: input.accessToken },
    );
    return NextResponse.json({
      channel: {
        id: result.channel.id,
        provider: result.channel.provider,
        externalAccountId: result.channel.externalAccountId,
        displayName: result.channel.displayName,
        status: result.channel.status,
      },
      updated: true,
      ...(result.subscriptionWarning
        ? { subscriptionWarning: result.subscriptionWarning }
        : {}),
    });
  } catch (error) {
    return apiError(error);
  }
}
