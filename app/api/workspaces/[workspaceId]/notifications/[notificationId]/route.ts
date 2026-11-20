import { NextResponse } from "next/server";

import { apiError, requireApiUser } from "@/lib/api";
import { notificationService } from "@/services/notification.service";

interface RouteContext {
  params: Promise<{ workspaceId: string; notificationId: string }>;
}

/** PATCH /api/workspaces/[workspaceId]/notifications/[notificationId] — mark read (Phase 13E). */
export async function PATCH(request: Request, context: RouteContext) {
  try {
    const user = await requireApiUser(request);
    const { workspaceId, notificationId } = await context.params;
    await notificationService.markRead(user.id, workspaceId, notificationId);
    return NextResponse.json({ ok: true });
  } catch (error) {
    return apiError(error);
  }
}
