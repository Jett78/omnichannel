import { NextResponse } from "next/server";

import { apiError, parseJsonBody, requireApiUser } from "@/lib/api";
import { sendMessageSchema } from "@/lib/validations";
import { conversationService } from "@/services/conversation.service";
import { messagingService } from "@/services/messaging.service";

interface RouteContext {
  params: Promise<{ workspaceId: string; conversationId: string }>;
}

/** GET …/messages — thread history (unified message shape). */
export async function GET(request: Request, context: RouteContext) {
  try {
    const user = await requireApiUser(request);
    const { workspaceId, conversationId } = await context.params;
    const params = new URL(request.url).searchParams;
    const limitParam = params.get("limit");
    const result = await conversationService.listMessages(user.id, workspaceId, conversationId, {
      ...(params.get("cursor") ? { cursor: params.get("cursor") as string } : {}),
      ...(limitParam ? { limit: Number(limitParam) } : {}),
    });
    return NextResponse.json(result);
  } catch (error) {
    return apiError(error);
  }
}

/** POST …/messages — queue an agent reply (delivered by the worker). */
export async function POST(request: Request, context: RouteContext) {
  try {
    const user = await requireApiUser(request);
    const { workspaceId, conversationId } = await context.params;
    const input = sendMessageSchema.parse(await parseJsonBody(request));
    const message = await messagingService.sendOutboundMessage(
      user.id,
      workspaceId,
      conversationId,
      input,
    );
    return NextResponse.json({ message }, { status: 201 });
  } catch (error) {
    return apiError(error);
  }
}
