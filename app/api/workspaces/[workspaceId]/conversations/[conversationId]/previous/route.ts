import { NextResponse } from "next/server";

import { apiError, requireApiUser } from "@/lib/api";
import { conversationService } from "@/services/conversation.service";

interface RouteContext {
  params: Promise<{ workspaceId: string; conversationId: string }>;
}

/** GET …/previous — other conversations with the same contact. */
export async function GET(request: Request, context: RouteContext) {
  try {
    const user = await requireApiUser(request);
    const { workspaceId, conversationId } = await context.params;
    const items = await conversationService.listContactConversations(
      user.id,
      workspaceId,
      conversationId,
    );
    return NextResponse.json({ items });
  } catch (error) {
    return apiError(error);
  }
}
