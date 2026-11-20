import { NextResponse } from "next/server";

import { apiError, requireApiUser } from "@/lib/api";
import { automationService } from "@/services/automation.service";

interface RouteContext {
  params: Promise<{ workspaceId: string }>;
}

/** GET /api/workspaces/[workspaceId]/automations/runs — recent rule executions (Phase 13B). */
export async function GET(request: Request, context: RouteContext) {
  try {
    const user = await requireApiUser(request);
    const { workspaceId } = await context.params;
    const limit = Number(new URL(request.url).searchParams.get("limit") ?? 50);
    const items = await automationService.listRuns(user.id, workspaceId, limit);
    return NextResponse.json({ items });
  } catch (error) {
    return apiError(error);
  }
}
