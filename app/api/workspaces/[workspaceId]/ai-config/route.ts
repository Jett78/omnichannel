import { NextResponse } from "next/server";

import { apiError, parseJsonBody, requireApiUser } from "@/lib/api";
import { aiConfigUpsertSchema } from "@/lib/validations";
import { aiConfigService } from "@/services/ai-config.service";

interface RouteContext {
  params: Promise<{ workspaceId: string }>;
}

/** GET /api/workspaces/[workspaceId]/ai-config — the workspace's own AI config (never includes the key). */
export async function GET(request: Request, context: RouteContext) {
  try {
    const user = await requireApiUser(request);
    const { workspaceId } = await context.params;
    const config = await aiConfigService.get(user.id, workspaceId);
    return NextResponse.json({ config });
  } catch (error) {
    return apiError(error);
  }
}

/** PUT /api/workspaces/[workspaceId]/ai-config — save provider + model + key (OWNER/ADMIN). */
export async function PUT(request: Request, context: RouteContext) {
  try {
    const user = await requireApiUser(request);
    const { workspaceId } = await context.params;
    const input = aiConfigUpsertSchema.parse(await parseJsonBody(request));
    const result = await aiConfigService.upsert(user.id, workspaceId, input);
    return NextResponse.json(result);
  } catch (error) {
    return apiError(error);
  }
}

/** DELETE /api/workspaces/[workspaceId]/ai-config — remove the workspace key (OWNER/ADMIN). */
export async function DELETE(request: Request, context: RouteContext) {
  try {
    const user = await requireApiUser(request);
    const { workspaceId } = await context.params;
    await aiConfigService.remove(user.id, workspaceId);
    return NextResponse.json({ ok: true });
  } catch (error) {
    return apiError(error);
  }
}
