import { NextResponse } from "next/server";

import { apiError, requireApiUser } from "@/lib/api";
import { conversationService } from "@/services/conversation.service";

interface RouteContext {
  params: Promise<{ workspaceId: string; conversationId: string }>;
}

/** POST …/resolve — OPEN/PENDING → RESOLVED. */
export async function POST(request: Request, context: RouteContext) {
  try {
    const user = await requireApiUser(request);
    const { workspaceId, conversationId } = await context.params;
    const conversation = await conversationService.resolveConversation(
      user.id,
      workspaceId,
      conversationId,
    );
    return NextResponse.json({ conversation });
  } catch (error) {
    return apiError(error);
  }
}
