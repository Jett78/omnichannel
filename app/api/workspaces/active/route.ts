import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import { z } from "zod";

import { ACTIVE_WORKSPACE_COOKIE } from "@/lib/active-workspace";
import { apiError, parseJsonBody, requireApiUser } from "@/lib/api";
import { requireWorkspaceMembership } from "@/lib/workspace-auth";

const bodySchema = z.object({ workspaceId: z.string().min(1) });

/** Set the active-workspace cookie — only for workspaces the user belongs to. */
export async function POST(request: Request) {
  try {
    const user = await requireApiUser(request);
    const { workspaceId } = bodySchema.parse(await parseJsonBody(request));
    await requireWorkspaceMembership(user.id, workspaceId);
    const cookieStore = await cookies();
    cookieStore.set(ACTIVE_WORKSPACE_COOKIE, workspaceId, {
      httpOnly: true,
      sameSite: "lax",
      path: "/",
      maxAge: 60 * 60 * 24 * 365,
    });
    return NextResponse.json({ activeWorkspaceId: workspaceId });
  } catch (error) {
    return apiError(error);
  }
}
