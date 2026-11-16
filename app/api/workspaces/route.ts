import { NextResponse } from "next/server";

import { apiError, parseJsonBody, requireApiUser } from "@/lib/api";
import { createWorkspaceSchema } from "@/lib/validations";
import { workspaceService } from "@/services/workspace.service";

export async function GET(request: Request) {
  try {
    const user = await requireApiUser(request);
    const workspaces = await workspaceService.listWorkspacesForUser(user.id);
    return NextResponse.json({ workspaces });
  } catch (error) {
    return apiError(error);
  }
}

export async function POST(request: Request) {
  try {
    const user = await requireApiUser(request);
    const input = createWorkspaceSchema.parse(await parseJsonBody(request));
    const workspace = await workspaceService.createWorkspace(user.id, input);
    return NextResponse.json({ workspace }, { status: 201 });
  } catch (error) {
    return apiError(error);
  }
}
