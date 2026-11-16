import { NextResponse } from "next/server";

import { apiError, parseJsonBody, requireApiUser } from "@/lib/api";
import { inviteMemberSchema } from "@/lib/validations";
import { workspaceService } from "@/services/workspace.service";

interface RouteContext {
  params: Promise<{ workspaceId: string }>;
}

export async function GET(request: Request, context: RouteContext) {
  try {
    const user = await requireApiUser(request);
    const { workspaceId } = await context.params;
    const members = await workspaceService.listMembers(user.id, workspaceId);
    return NextResponse.json({ members });
  } catch (error) {
    return apiError(error);
  }
}

export async function POST(request: Request, context: RouteContext) {
  try {
    const user = await requireApiUser(request);
    const { workspaceId } = await context.params;
    const input = inviteMemberSchema.parse(await parseJsonBody(request));
    const { invitation, inviteUrl } = await workspaceService.inviteMember(
      user.id,
      workspaceId,
      input,
    );
    // inviteUrl is returned so the inviter can share it in development
    // (the dev mailer also logs it). The invitation token is a bearer
    // secret for the invitee only — never a platform credential.
    return NextResponse.json({ invitation, inviteUrl }, { status: 201 });
  } catch (error) {
    return apiError(error);
  }
}
