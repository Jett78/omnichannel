import { NextResponse } from "next/server";

import { apiError, parseJsonBody, requireApiUser } from "@/lib/api";
import { outgoingWebhookCreateSchema } from "@/lib/validations";
import { outgoingWebhookService } from "@/services/outgoing-webhook.service";

interface RouteContext {
  params: Promise<{ workspaceId: string }>;
}

/** GET /api/workspaces/[workspaceId]/webhooks — list outgoing webhooks (admins). */
export async function GET(request: Request, context: RouteContext) {
  try {
    const user = await requireApiUser(request);
    const { workspaceId } = await context.params;
    const items = await outgoingWebhookService.listWebhooks(user.id, workspaceId);
    return NextResponse.json({ items });
  } catch (error) {
    return apiError(error);
  }
}

/** POST /api/workspaces/[workspaceId]/webhooks — create an outgoing webhook. */
export async function POST(request: Request, context: RouteContext) {
  try {
    const user = await requireApiUser(request);
    const { workspaceId } = await context.params;
    const input = outgoingWebhookCreateSchema.parse(await parseJsonBody(request));
    const item = await outgoingWebhookService.createWebhook(user.id, workspaceId, input);
    return NextResponse.json({ item }, { status: 201 });
  } catch (error) {
    return apiError(error);
  }
}
