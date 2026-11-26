import { NextResponse } from "next/server";

import { apiError, parseJsonBody, requireApiUser } from "@/lib/api";
import { setTeamMembersSchema } from "@/lib/validations";
import { workspaceService } from "@/services/workspace.service";

interface RouteContext {
  params: Promise<{ workspaceId: string; teamId: string }>;
}

/** Replace the team's membership with the given WorkspaceMember id set. */
export async function PUT(request: Request, context: RouteContext) {
  try {
    const user = await requireApiUser(request);
    const { workspaceId, teamId } = await context.params;
    const input = setTeamMembersSchema.parse(await parseJsonBody(request));
    const result = await workspaceService.setTeamMembers(user.id, workspaceId, teamId, input);
    return NextResponse.json(result);
  } catch (error) {
    return apiError(error);
  }
}
