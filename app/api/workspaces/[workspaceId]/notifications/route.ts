import { NextResponse } from "next/server";

import { apiError, requireApiUser } from "@/lib/api";
import { notificationService } from "@/services/notification.service";

interface RouteContext {
  params: Promise<{ workspaceId: string }>;
}

/** GET /api/workspaces/[workspaceId]/notifications — my notifications in this workspace (Phase 13E). */
export async function GET(request: Request, context: RouteContext) {
  try {
    const user = await requireApiUser(request);
    const { workspaceId } = await context.params;
    const limit = Number(new URL(request.url).searchParams.get("limit") ?? 100);
    const items = await notificationService.listForUser(user.id, workspaceId, limit);
    return NextResponse.json({ items });
  } catch (error) {
    return apiError(error);
  }
}
