import { NextResponse } from "next/server";

import { apiError, parseJsonBody, requireApiUser } from "@/lib/api";
import { updateMemberRoleSchema } from "@/lib/validations";
import { workspaceService } from "@/services/workspace.service";

interface RouteContext {
  params: Promise<{ workspaceId: string; memberId: string }>;
}

export async function PATCH(request: Request, context: RouteContext) {
  try {
    const user = await requireApiUser(request);
    const { workspaceId, memberId } = await context.params;
    const input = updateMemberRoleSchema.parse(await parseJsonBody(request));
    const member = await workspaceService.updateMemberRole(
      user.id,
      workspaceId,
      memberId,
      input.role,
    );
    return NextResponse.json({ member });
  } catch (error) {
    return apiError(error);
  }
}

export async function DELETE(request: Request, context: RouteContext) {
  try {
    const user = await requireApiUser(request);
    const { workspaceId, memberId } = await context.params;
    const result = await workspaceService.removeMember(user.id, workspaceId, memberId);
    return NextResponse.json(result);
  } catch (error) {
    return apiError(error);
  }
}
