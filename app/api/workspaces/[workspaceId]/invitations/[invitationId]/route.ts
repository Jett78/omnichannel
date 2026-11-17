import { NextResponse } from "next/server";

import { apiError, requireApiUser } from "@/lib/api";
import { workspaceService } from "@/services/workspace.service";

interface RouteContext {
  params: Promise<{ workspaceId: string; invitationId: string }>;
}

/** DELETE …/invitations/[invitationId] — revoke a pending invitation. */
export async function DELETE(request: Request, context: RouteContext) {
  try {
    const user = await requireApiUser(request);
    const { workspaceId, invitationId } = await context.params;
    const invitation = await workspaceService.revokeInvitation(user.id, workspaceId, invitationId);
    return NextResponse.json({ invitation });
  } catch (error) {
    return apiError(error);
  }
}
