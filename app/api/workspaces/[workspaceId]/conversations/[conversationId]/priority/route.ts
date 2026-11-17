import { NextResponse } from "next/server";

import { apiError, parseJsonBody, requireApiUser } from "@/lib/api";
import { setPrioritySchema } from "@/lib/validations";
import { conversationService } from "@/services/conversation.service";

interface RouteContext {
  params: Promise<{ workspaceId: string; conversationId: string }>;
}

/** POST …/priority — set or clear (null) the conversation priority. */
export async function POST(request: Request, context: RouteContext) {
  try {
    const user = await requireApiUser(request);
    const { workspaceId, conversationId } = await context.params;
    const input = setPrioritySchema.parse(await parseJsonBody(request));
    const conversation = await conversationService.setPriority(
      user.id,
      workspaceId,
      conversationId,
      input.priority,
    );
    return NextResponse.json({ conversation });
  } catch (error) {
    return apiError(error);
  }
}
