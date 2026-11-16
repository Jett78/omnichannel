import { connection, NextResponse } from "next/server";

import { apiError, requireApiUser } from "@/lib/api";
import { metaConnectionService } from "@/services/meta-connection.service";

interface RouteContext {
  params: Promise<{ workspaceId: string; sessionId: string }>;
}

/**
 * GET /api/workspaces/[workspaceId]/channel-connections/[sessionId]
 * Sanitized accounts from a completed Meta OAuth callback — ids,
 * names, eligibility. Tokens are NEVER included.
 */
export async function GET(request: Request, context: RouteContext) {
  await connection();
  try {
    const user = await requireApiUser(request);
    const { workspaceId, sessionId } = await context.params;
    const view = await metaConnectionService.getConnectionSession(user.id, workspaceId, sessionId);
    return NextResponse.json({
      session: {
        id: view.sessionId,
        provider: view.provider,
        expiresAt: view.expiresAt.toISOString(),
        accounts: view.accounts,
      },
    });
  } catch (error) {
    return apiError(error);
  }
}
