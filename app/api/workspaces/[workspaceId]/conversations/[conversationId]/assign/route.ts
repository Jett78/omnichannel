import { NextResponse } from "next/server";

import { apiError, parseJsonBody, requireApiUser } from "@/lib/api";
import { assignConversationSchema } from "@/lib/validations";
import { conversationService } from "@/services/conversation.service";

interface RouteContext {
  params: Promise<{ workspaceId: string; conversationId: string }>;
}

/** POST …/assign — assign (or unassign with assigneeId: null). */
export async function POST(request: Request, context: RouteContext) {
  try {
    const user = await requireApiUser(request);
    const { workspaceId, conversationId } = await context.params;
    const input = assignConversationSchema.parse(await parseJsonBody(request));
    const conversation = await conversationService.assignConversation(
      user.id,
      workspaceId,
      conversationId,
      input.assigneeId,
    );
    return NextResponse.json({ conversation });
  } catch (error) {
    return apiError(error);
  }
}
