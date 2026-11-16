import { NextResponse } from "next/server";

import { apiError, parseJsonBody, requireApiUser } from "@/lib/api";
import { whatsappRegisterSchema } from "@/lib/validations";
import { whatsappConnectionService } from "@/services/whatsapp-connection.service";

interface RouteContext {
  params: Promise<{ workspaceId: string; channelId: string }>;
}

/**
 * POST /api/workspaces/[workspaceId]/channels/[channelId]/register
 * Registers a WhatsApp phone number with the Cloud API using its
 * 6-digit PIN. Meta errors (e.g. 133016 lockouts) surface verbatim.
 */
export async function POST(request: Request, context: RouteContext) {
  try {
    const user = await requireApiUser(request);
    const { workspaceId, channelId } = await context.params;
    const input = whatsappRegisterSchema.parse(await parseJsonBody(request));
    const channel = await whatsappConnectionService.registerPhoneNumber(
      user.id,
      workspaceId,
      channelId,
      input.pin,
    );
    return NextResponse.json({
      channel: {
        id: channel.id,
        provider: channel.provider,
        externalAccountId: channel.externalAccountId,
        displayName: channel.displayName,
        status: channel.status,
      },
      registered: true,
    });
  } catch (error) {
    return apiError(error);
  }
}
