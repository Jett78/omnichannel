import { NextResponse } from "next/server";

import { apiError, parseJsonBody, requireApiUser } from "@/lib/api";
import { telegramConnectSchema } from "@/lib/validations";
import { telegramConnectionService } from "@/services/telegram-connection.service";

interface RouteContext {
  params: Promise<{ workspaceId: string }>;
}

/**
 * POST /api/workspaces/[workspaceId]/channels/telegram/connect
 * Connect (or reconnect) a Telegram bot with its BotFather token.
 * The token is validated against the real Bot API before it is
 * stored (encrypted); it is never returned in any response.
 */
export async function POST(request: Request, context: RouteContext) {
  try {
    const user = await requireApiUser(request);
    const { workspaceId } = await context.params;
    const input = telegramConnectSchema.parse(await parseJsonBody(request));
    const result = await telegramConnectionService.connectWithToken(user.id, workspaceId, input);
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
