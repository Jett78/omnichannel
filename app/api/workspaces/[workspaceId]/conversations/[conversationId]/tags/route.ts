import { NextResponse } from "next/server";

import { apiError, parseJsonBody, requireApiUser } from "@/lib/api";
import { conversationTagSchema } from "@/lib/validations";
import { conversationService } from "@/services/conversation.service";

interface RouteContext {
  params: Promise<{ workspaceId: string; conversationId: string }>;
}

/** POST …/tags — add a tag (find-or-create by name in the workspace). */
export async function POST(request: Request, context: RouteContext) {
  try {
    const user = await requireApiUser(request);
    const { workspaceId, conversationId } = await context.params;
    const input = conversationTagSchema.parse(await parseJsonBody(request));
    const tags = await conversationService.addTag(user.id, workspaceId, conversationId, input.name);
    return NextResponse.json({ tags }, { status: 201 });
  } catch (error) {
    return apiError(error);
  }
}

/** DELETE …/tags — remove a tag by name. */
export async function DELETE(request: Request, context: RouteContext) {
  try {
    const user = await requireApiUser(request);
    const { workspaceId, conversationId } = await context.params;
    const input = conversationTagSchema.parse(await parseJsonBody(request));
    const tags = await conversationService.removeTag(
      user.id,
      workspaceId,
      conversationId,
      input.name,
    );
    return NextResponse.json({ tags });
  } catch (error) {
    return apiError(error);
  }
}
