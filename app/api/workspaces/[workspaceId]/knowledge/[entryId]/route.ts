import { NextResponse } from "next/server";

import { apiError, parseJsonBody, requireApiUser } from "@/lib/api";
import { knowledgeEntryUpdateSchema } from "@/lib/validations";
import { knowledgeService } from "@/services/ai.service";

interface RouteContext {
  params: Promise<{ workspaceId: string; entryId: string }>;
}

/** PATCH /api/workspaces/[workspaceId]/knowledge/[entryId] — edit an entry (Phase 13G). */
export async function PATCH(request: Request, context: RouteContext) {
  try {
    const user = await requireApiUser(request);
    const { workspaceId, entryId } = await context.params;
    const input = knowledgeEntryUpdateSchema.parse(await parseJsonBody(request));
    const item = await knowledgeService.update(user.id, workspaceId, entryId, input);
    return NextResponse.json({ item });
  } catch (error) {
    return apiError(error);
  }
}

/** DELETE /api/workspaces/[workspaceId]/knowledge/[entryId] */
export async function DELETE(request: Request, context: RouteContext) {
  try {
    const user = await requireApiUser(request);
    const { workspaceId, entryId } = await context.params;
    await knowledgeService.remove(user.id, workspaceId, entryId);
    return NextResponse.json({ ok: true });
  } catch (error) {
    return apiError(error);
  }
}
