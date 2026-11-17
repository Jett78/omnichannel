import { NextResponse } from "next/server";

import { apiError, parseJsonBody, requireApiUser } from "@/lib/api";
import { snoozeConversationSchema } from "@/lib/validations";
import { conversationService } from "@/services/conversation.service";

interface RouteContext {
  params: Promise<{ workspaceId: string; conversationId: string }>;
}

/** POST …/snooze — snooze until an ISO time, or until the next reply (null). */
export async function POST(request: Request, context: RouteContext) {
  try {
    const user = await requireApiUser(request);
    const { workspaceId, conversationId } = await context.params;
    const input = snoozeConversationSchema.parse(await parseJsonBody(request));
    const conversation = await conversationService.snoozeConversation(
      user.id,
      workspaceId,
      conversationId,
      input.until ? new Date(input.until) : null,
    );
    return NextResponse.json({ conversation });
  } catch (error) {
    return apiError(error);
  }
}
