import { NextResponse } from "next/server";

import { apiError, requireApiUser } from "@/lib/api";
import { conversationService } from "@/services/conversation.service";

interface RouteContext {
  params: Promise<{ workspaceId: string; conversationId: string }>;
}

/** GET /api/workspaces/[workspaceId]/conversations/[conversationId] */
export async function GET(request: Request, context: RouteContext) {
  try {
    const user = await requireApiUser(request);
    const { workspaceId, conversationId } = await context.params;
    const conversation = await conversationService.getConversation(
      user.id,
      workspaceId,
      conversationId,
    );
    return NextResponse.json({ conversation });
  } catch (error) {
    return apiError(error);
  }
}
