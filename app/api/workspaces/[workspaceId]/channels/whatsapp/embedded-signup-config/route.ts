import { connection, NextResponse } from "next/server";

import { apiError, requireApiUser } from "@/lib/api";
import { requireWhatsAppEmbeddedConfig } from "@/integrations/meta/meta-config";
import { requireWorkspaceMembership } from "@/lib/workspace-auth";

interface RouteContext {
  params: Promise<{ workspaceId: string }>;
}

/**
 * GET /api/workspaces/[workspaceId]/channels/whatsapp/embedded-signup-config
 * Public Embedded Signup launch values (Meta app id + Facebook Login
 * for Business configuration id + Graph version) for the dashboard's
 * FB JS SDK flow. 503 with the missing env vars named when the
 * deployment is not configured for Embedded Signup.
 */
export async function GET(request: Request, context: RouteContext) {
  await connection();
  try {
    const user = await requireApiUser(request);
    const { workspaceId } = await context.params;
    await requireWorkspaceMembership(user.id, workspaceId);
    const config = requireWhatsAppEmbeddedConfig();
    return NextResponse.json({
      appId: config.appId,
      configId: config.embeddedSignupConfigId,
      graphVersion: config.graphApiVersion,
    });
  } catch (error) {
    return apiError(error);
  }
}
