import { connection, NextResponse } from "next/server";

import { apiError, requireApiUser } from "@/lib/api";
import { xConnectionService } from "@/services/x-connection.service";

interface RouteContext {
  params: Promise<{ workspaceId: string }>;
}

/**
 * GET /api/workspaces/[workspaceId]/channels/x/connect
 * Starts the official X OAuth 2.0 (Authorization Code + PKCE) flow:
 * creates a connection session (its encrypted payload holds the PKCE
 * verifier), stores the raw `state` in an httpOnly cookie, and 302s
 * to X's authorization page. When the deployment is not configured
 * this returns a 503 JSON naming the missing env vars.
 */
export async function GET(request: Request, context: RouteContext) {
  await connection();
  try {
    const user = await requireApiUser(request);
    const { workspaceId } = await context.params;
    const { authUrl, state } = await xConnectionService.startXConnect(user.id, workspaceId);
    const response = NextResponse.redirect(authUrl);
    response.cookies.set("uoi_oauth_state_x", state, {
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
