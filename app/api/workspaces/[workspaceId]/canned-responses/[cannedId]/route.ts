import { NextResponse } from "next/server";

import { apiError, parseJsonBody, requireApiUser } from "@/lib/api";
import { cannedResponseUpdateSchema } from "@/lib/validations";
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

/** PATCH /api/workspaces/[workspaceId]/canned-responses/[cannedId] — edit (Phase 13A). */
export async function PATCH(request: Request, context: RouteContext) {
  try {
    const user = await requireApiUser(request);
    const { workspaceId, cannedId } = await context.params;
    const input = cannedResponseUpdateSchema.parse(await parseJsonBody(request));
    const item = await cannedResponseService.update(user.id, workspaceId, cannedId, input);
    return NextResponse.json({ item });
  } catch (error) {
    return apiError(error);
  }
}
