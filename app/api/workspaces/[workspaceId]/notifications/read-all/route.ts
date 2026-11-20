import { NextResponse } from "next/server";

import { apiError, requireApiUser } from "@/lib/api";
import { notificationService } from "@/services/notification.service";

interface RouteContext {
  params: Promise<{ workspaceId: string }>;
}

/** POST /api/workspaces/[workspaceId]/notifications/read-all — mark everything read (Phase 13E). */
export async function POST(request: Request, context: RouteContext) {
  try {
    const user = await requireApiUser(request);
    const { workspaceId } = await context.params;
    const result = await notificationService.markAllRead(user.id, workspaceId);
    return NextResponse.json(result);
  } catch (error) {
    return apiError(error);
  }
}
