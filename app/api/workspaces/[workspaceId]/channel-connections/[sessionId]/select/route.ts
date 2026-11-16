import { NextResponse } from "next/server";

import { apiError, parseJsonBody, requireApiUser } from "@/lib/api";
import { selectConnectionAccountSchema } from "@/lib/validations";
import { metaConnectionService } from "@/services/meta-connection.service";

interface RouteContext {
  params: Promise<{ workspaceId: string; sessionId: string }>;
}

/**
 * POST /api/workspaces/[workspaceId]/channel-connections/[sessionId]/select
 * Connects the chosen Page / Instagram account from a completed OAuth
 * session: creates the channel, stores its token encrypted, and
 * subscribes it to webhooks. A failed webhook subscription is
 * reported as `subscriptionWarning` (the channel itself is valid).
 */
export async function POST(request: Request, context: RouteContext) {
  try {
    const user = await requireApiUser(request);
    const { workspaceId, sessionId } = await context.params;
    const input = selectConnectionAccountSchema.parse(await parseJsonBody(request));
    const result = await metaConnectionService.selectConnectionAccount(
      user.id,
      workspaceId,
      sessionId,
      input.externalAccountId,
    );
    return NextResponse.json(
      {
        channel: {
          id: result.channel.id,
          provider: result.channel.provider,
          externalAccountId: result.channel.externalAccountId,
          displayName: result.channel.displayName,
          status: result.channel.status,
        },
        ...(result.subscriptionWarning ? { subscriptionWarning: result.subscriptionWarning } : {}),
      },
      { status: 201 },
    );
  } catch (error) {
    return apiError(error);
  }
}
