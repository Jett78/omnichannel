import { NextResponse } from "next/server";

import { apiError, requireApiUser } from "@/lib/api";
import { outgoingWebhookService } from "@/services/outgoing-webhook.service";

interface RouteContext {
  params: Promise<{ workspaceId: string; webhookId: string }>;
}

/** POST /api/workspaces/[workspaceId]/webhooks/[webhookId]/test — send a test ping. */
export async function POST(request: Request, context: RouteContext) {
  try {
    const user = await requireApiUser(request);
    const { workspaceId, webhookId } = await context.params;
    await outgoingWebhookService.sendTestPing(user.id, workspaceId, webhookId);
    return NextResponse.json({ ok: true });
  } catch (error) {
    return apiError(error);
  }
}
