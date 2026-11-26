import { NextResponse } from "next/server";

import { apiError, parseJsonBody, requireApiUser } from "@/lib/api";
import { updateTeamSchema } from "@/lib/validations";
import { workspaceService } from "@/services/workspace.service";

interface RouteContext {
  params: Promise<{ workspaceId: string; teamId: string }>;
}

export async function PATCH(request: Request, context: RouteContext) {
  try {
    const user = await requireApiUser(request);
    const { workspaceId, teamId } = await context.params;
    const input = updateTeamSchema.parse(await parseJsonBody(request));
    const team = await workspaceService.updateTeam(user.id, workspaceId, teamId, input);
    return NextResponse.json({ team });
  } catch (error) {
    return apiError(error);
  }
}

export async function DELETE(request: Request, context: RouteContext) {
  try {
    const user = await requireApiUser(request);
    const { workspaceId, teamId } = await context.params;
    const result = await workspaceService.deleteTeam(user.id, workspaceId, teamId);
    return NextResponse.json(result);
  } catch (error) {
    return apiError(error);
  }
}
