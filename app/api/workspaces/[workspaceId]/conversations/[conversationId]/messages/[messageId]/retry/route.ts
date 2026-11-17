import { NextResponse } from "next/server";

import { apiError, requireApiUser } from "@/lib/api";
import { messagingService } from "@/services/messaging.service";

interface RouteContext {
  params: Promise<{ workspaceId: string; conversationId: string; messageId: string }>;
}

/** POST …/messages/[messageId]/retry — re-queue a FAILED outbound message. */
export async function POST(request: Request, context: RouteContext) {
  try {
    const user = await requireApiUser(request);
    const { workspaceId, conversationId, messageId } = await context.params;
    const message = await messagingService.retryOutboundMessage(
      user.id,
      workspaceId,
      conversationId,
      messageId,
    );
    return NextResponse.json({
      message: { ...message, createdAt: message.createdAt.toISOString() },
    });
  } catch (error) {
    return apiError(error);
  }
}
