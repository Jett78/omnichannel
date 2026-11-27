import { NextResponse } from "next/server";

import { apiError, parseJsonBody, requireApiUser } from "@/lib/api";
import { updateWorkspaceSchema } from "@/lib/validations";
import { workspaceService } from "@/services/workspace.service";

interface RouteContext {
  params: Promise<{ workspaceId: string }>;
}

export async function GET(request: Request, context: RouteContext) {
  try {
    const user = await requireApiUser(request);
    const { workspaceId } = await context.params;
    const workspace = await workspaceService.getWorkspaceForUser(user.id, workspaceId);
    return NextResponse.json({ workspace });
  } catch (error) {
    return apiError(error);
  }
}

export async function PATCH(request: Request, context: RouteContext) {
  try {
    const user = await requireApiUser(request);
    const { workspaceId } = await context.params;
    const input = updateWorkspaceSchema.parse(await parseJsonBody(request));
    const workspace = await workspaceService.updateWorkspace(user.id, workspaceId, input);
    return NextResponse.json({ workspace });
  } catch (error) {
    return apiError(error);
  }
}

/** DELETE — permanently delete the workspace (OWNER only, enforced in the service). */
export async function DELETE(request: Request, context: RouteContext) {
  try {
    const user = await requireApiUser(request);
    const { workspaceId } = await context.params;
    await workspaceService.deleteWorkspace(user.id, workspaceId);
    return NextResponse.json({ deleted: true });
  } catch (error) {
    return apiError(error);
  }
}
