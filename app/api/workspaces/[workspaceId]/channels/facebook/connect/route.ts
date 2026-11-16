import { connection, NextResponse } from "next/server";

import { apiError, requireApiUser } from "@/lib/api";
import { metaConnectionService } from "@/services/meta-connection.service";

interface RouteContext {
  params: Promise<{ workspaceId: string }>;
}

/**
 * GET /api/workspaces/[workspaceId]/channels/facebook/connect
 * Starts the official Facebook OAuth flow: creates a connection
 * session, stores the raw `state` in an httpOnly cookie, and 302s to
 * Meta's authorization dialog. When the deployment is not configured
 * this returns a 503 JSON naming the missing env vars.
 */
export async function GET(request: Request, context: RouteContext) {
  await connection();
  try {
    const user = await requireApiUser(request);
    const { workspaceId } = await context.params;
    const { authUrl, state } = await metaConnectionService.startFacebookConnect(
      user.id,
      workspaceId,
    );
    const response = NextResponse.redirect(authUrl);
    response.cookies.set("uoi_oauth_state_facebook", state, {
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
