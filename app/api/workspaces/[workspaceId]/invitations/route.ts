import { NextResponse } from "next/server";

import { apiError, requireApiUser } from "@/lib/api";
import { workspaceService } from "@/services/workspace.service";

interface RouteContext {
  params: Promise<{ workspaceId: string }>;
}

/** GET /api/workspaces/[workspaceId]/invitations — pending invitations. */
export async function GET(request: Request, context: RouteContext) {
  try {
    const user = await requireApiUser(request);
    const { workspaceId } = await context.params;
    const invitations = await workspaceService.listInvitations(user.id, workspaceId);
    return NextResponse.json({ invitations });
  } catch (error) {
    return apiError(error);
  }
}
