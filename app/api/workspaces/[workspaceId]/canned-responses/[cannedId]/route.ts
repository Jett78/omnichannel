import { NextResponse } from "next/server";

import { apiError, requireApiUser } from "@/lib/api";
import { cannedResponseService } from "@/services/canned-response.service";

interface RouteContext {
  params: Promise<{ workspaceId: string; cannedId: string }>;
}

/** DELETE /api/workspaces/[workspaceId]/canned-responses/[cannedId] */
export async function DELETE(request: Request, context: RouteContext) {
  try {
    const user = await requireApiUser(request);
    const { workspaceId, cannedId } = await context.params;
    const result = await cannedResponseService.remove(user.id, workspaceId, cannedId);
    return NextResponse.json(result);
  } catch (error) {
    return apiError(error);
  }
}
