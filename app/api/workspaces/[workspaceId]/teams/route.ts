import { NextResponse } from "next/server";

import { apiError, parseJsonBody, requireApiUser } from "@/lib/api";
import { createTeamSchema } from "@/lib/validations";
import { workspaceService } from "@/services/workspace.service";

interface RouteContext {
  params: Promise<{ workspaceId: string }>;
}

export async function GET(request: Request, context: RouteContext) {
  try {
    const user = await requireApiUser(request);
    const { workspaceId } = await context.params;
    const teams = await workspaceService.listTeams(user.id, workspaceId);
    return NextResponse.json({ teams });
  } catch (error) {
    return apiError(error);
  }
}

export async function POST(request: Request, context: RouteContext) {
  try {
    const user = await requireApiUser(request);
    const { workspaceId } = await context.params;
    const input = createTeamSchema.parse(await parseJsonBody(request));
    const team = await workspaceService.createTeam(user.id, workspaceId, input);
    return NextResponse.json({ team }, { status: 201 });
  } catch (error) {
    return apiError(error);
  }
}
