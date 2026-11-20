import { NextResponse } from "next/server";

import { apiError, parseJsonBody, requireApiUser } from "@/lib/api";
import { outgoingWebhookUpdateSchema } from "@/lib/validations";
import { outgoingWebhookService } from "@/services/outgoing-webhook.service";

interface RouteContext {
  params: Promise<{ workspaceId: string; webhookId: string }>;
}

/** PATCH /api/workspaces/[workspaceId]/webhooks/[webhookId] — update a webhook. */
export async function PATCH(request: Request, context: RouteContext) {
  try {
    const user = await requireApiUser(request);
    const { workspaceId, webhookId } = await context.params;
    const input = outgoingWebhookUpdateSchema.parse(await parseJsonBody(request));
    const item = await outgoingWebhookService.updateWebhook(user.id, workspaceId, webhookId, input);
    return NextResponse.json({ item });
  } catch (error) {
    return apiError(error);
  }
}

/** DELETE /api/workspaces/[workspaceId]/webhooks/[webhookId] — remove a webhook. */
export async function DELETE(request: Request, context: RouteContext) {
  try {
    const user = await requireApiUser(request);
    const { workspaceId, webhookId } = await context.params;
    await outgoingWebhookService.deleteWebhook(user.id, workspaceId, webhookId);
    return NextResponse.json({ ok: true });
  } catch (error) {
    return apiError(error);
  }
}
