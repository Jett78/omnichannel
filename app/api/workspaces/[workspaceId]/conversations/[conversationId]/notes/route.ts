import { NextResponse } from "next/server";

import { apiError, parseJsonBody, requireApiUser } from "@/lib/api";
import { internalNoteSchema } from "@/lib/validations";
import { conversationService } from "@/services/conversation.service";

interface RouteContext {
  params: Promise<{ workspaceId: string; conversationId: string }>;
}

/** POST …/notes — add an internal note (PRIVATE_NOTE, never sent to the customer). */
export async function POST(request: Request, context: RouteContext) {
  try {
    const user = await requireApiUser(request);
    const { workspaceId, conversationId } = await context.params;
    const input = internalNoteSchema.parse(await parseJsonBody(request));
    const message = await conversationService.addInternalNote(
      user.id,
      workspaceId,
      conversationId,
      input.content,
    );
    return NextResponse.json({ message }, { status: 201 });
  } catch (error) {
    return apiError(error);
  }
}
