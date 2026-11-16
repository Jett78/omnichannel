import { NextResponse } from "next/server";

import { apiError, parseJsonBody, requireApiUser } from "@/lib/api";
import { whatsappManualConnectSchema } from "@/lib/validations";
import { whatsappConnectionService } from "@/services/whatsapp-connection.service";

interface RouteContext {
  params: Promise<{ workspaceId: string }>;
}

/**
 * POST /api/workspaces/[workspaceId]/channels/whatsapp/manual
 * Manual WhatsApp connect with a permanent system-user token. The
 * token is validated against the real WABA before it is stored
 * (encrypted); it is never returned in any response.
 */
export async function POST(request: Request, context: RouteContext) {
  try {
    const user = await requireApiUser(request);
    const { workspaceId } = await context.params;
    const input = whatsappManualConnectSchema.parse(await parseJsonBody(request));
    const result = await whatsappConnectionService.connectManually(user.id, workspaceId, input);
    return NextResponse.json(
      {
        channel: {
          id: result.channel.id,
          provider: result.channel.provider,
          externalAccountId: result.channel.externalAccountId,
          displayName: result.channel.displayName,
          status: result.channel.status,
        },
        ...(result.subscriptionWarning
          ? { subscriptionWarning: result.subscriptionWarning }
          : {}),
      },
      { status: 201 },
    );
  } catch (error) {
    return apiError(error);
  }
}
