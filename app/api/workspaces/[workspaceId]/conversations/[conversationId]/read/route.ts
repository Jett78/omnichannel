import { NextResponse } from "next/server";

import { apiError, requireApiUser } from "@/lib/api";
import { conversationService } from "@/services/conversation.service";

interface RouteContext {
  params: Promise<{ workspaceId: string; conversationId: string }>;
}

/** POST …/read — mark the conversation read (unreadCount → 0). */
export async function POST(request: Request, context: RouteContext) {
  try {
    const user = await requireApiUser(request);
    const { workspaceId, conversationId } = await context.params;
    const result = await conversationService.markAsRead(user.id, workspaceId, conversationId);
    return NextResponse.json(result);
  } catch (error) {
    return apiError(error);
  }
}
