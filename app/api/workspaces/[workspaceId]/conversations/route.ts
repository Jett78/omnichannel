import { NextResponse } from "next/server";

import { apiError, requireApiUser } from "@/lib/api";
import { conversationService } from "@/services/conversation.service";
import type { ConversationStatus } from "@/generated/prisma/client";

interface RouteContext {
  params: Promise<{ workspaceId: string }>;
}

const STATUSES: readonly string[] = ["OPEN", "PENDING", "RESOLVED", "SNOOZED"];

/** GET /api/workspaces/[workspaceId]/conversations — list + search + filters. */
export async function GET(request: Request, context: RouteContext) {
  try {
    const user = await requireApiUser(request);
    const { workspaceId } = await context.params;
    const params = new URL(request.url).searchParams;

    const statusParam = params.get("status");
    const limitParam = params.get("limit");
    const sortParam = params.get("sort");
    const result = await conversationService.listConversations(user.id, workspaceId, {
      ...(statusParam && STATUSES.includes(statusParam)
        ? { status: statusParam as ConversationStatus }
        : {}),
      ...(params.get("assigneeId") ? { assigneeId: params.get("assigneeId") as string } : {}),
      ...(params.get("unassigned") === "true" ? { unassigned: true } : {}),
      ...(params.get("channelId") ? { channelId: params.get("channelId") as string } : {}),
      ...(params.get("search") ? { search: params.get("search") as string } : {}),
      ...(params.get("mentions") === "me" ? { mentionedUserId: user.id } : {}),
      ...(sortParam === "waiting" || sortParam === "priority" || sortParam === "latest"
        ? { sort: sortParam }
        : {}),
      ...(params.get("cursor") ? { cursor: params.get("cursor") as string } : {}),
      ...(limitParam ? { limit: Number(limitParam) } : {}),
    });
    return NextResponse.json(result);
  } catch (error) {
    return apiError(error);
  }
}
