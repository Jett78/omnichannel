import { NextResponse } from "next/server";

import { apiError, requireApiUser } from "@/lib/api";
import { messagingService } from "@/services/messaging.service";

interface RouteContext {
  params: Promise<{ workspaceId: string; channelId: string }>;
}

/**
 * POST …/channels/{channelId}/import-history — one-time backfill of the
 * channel's recent conversations from the platform (Messenger /
 * Instagram). Messages that are already stored are skipped.
 */
export async function POST(request: Request, context: RouteContext) {
  try {
    const user = await requireApiUser(request);
    const { workspaceId, channelId } = await context.params;
    const result = await messagingService.importRecentConversations(
      user.id,
      workspaceId,
      channelId,
    );
    return NextResponse.json({ result });
  } catch (error) {
    return apiError(error);
  }
}
