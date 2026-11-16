import { connection, NextResponse } from "next/server";

import { apiError, requireApiUser } from "@/lib/api";
import { metaConnectionService } from "@/services/meta-connection.service";

interface RouteContext {
  params: Promise<{ workspaceId: string }>;
}

/**
 * GET /api/workspaces/[workspaceId]/channels/instagram/connect
 * Starts the official Instagram Login flow: creates a connection
 * session, stores the raw `state` in an httpOnly cookie, and 302s to
 * Instagram's authorization page. When the deployment is not
 * configured this returns a 503 JSON naming the missing env vars.
 */
export async function GET(request: Request, context: RouteContext) {
  await connection();
  try {
    const user = await requireApiUser(request);
    const { workspaceId } = await context.params;
    const { authUrl, state } = await metaConnectionService.startInstagramConnect(
      user.id,
      workspaceId,
    );
    const response = NextResponse.redirect(authUrl);
    response.cookies.set("uoi_oauth_state_instagram", state, {
      httpOnly: true,
      path: "/api/oauth",
      sameSite: "lax",
      secure: process.env.NODE_ENV === "production",
      maxAge: 900,
    });
    return response;
  } catch (error) {
    return apiError(error);
  }
}
