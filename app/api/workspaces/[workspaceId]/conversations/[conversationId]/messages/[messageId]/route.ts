import { NextResponse } from "next/server";

import { apiError, requireApiUser } from "@/lib/api";
import { conversationService } from "@/services/conversation.service";

interface RouteContext {
  params: Promise<{ workspaceId: string; conversationId: string; messageId: string }>;
}

/** DELETE …/messages/[messageId] — delete an agent-authored message from our records. */
export async function DELETE(request: Request, context: RouteContext) {
  try {
    const user = await requireApiUser(request);
    const { workspaceId, conversationId, messageId } = await context.params;
    const result = await conversationService.deleteMessage(
      user.id,
      workspaceId,
      conversationId,
      messageId,
    );
    return NextResponse.json(result);
  } catch (error) {
    return apiError(error);
  }
}
