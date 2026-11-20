import { NextResponse } from "next/server";

import { apiError, parseJsonBody, requireApiUser } from "@/lib/api";
import { knowledgeEntryCreateSchema } from "@/lib/validations";
import { knowledgeService } from "@/services/ai.service";

interface RouteContext {
  params: Promise<{ workspaceId: string }>;
}

/** GET /api/workspaces/[workspaceId]/knowledge — workspace knowledge entries (Phase 13G). */
export async function GET(request: Request, context: RouteContext) {
  try {
    const user = await requireApiUser(request);
    const { workspaceId } = await context.params;
    const items = await knowledgeService.list(user.id, workspaceId);
    return NextResponse.json({ items });
  } catch (error) {
    return apiError(error);
  }
}

/** POST /api/workspaces/[workspaceId]/knowledge — create an entry (OWNER/ADMIN). */
export async function POST(request: Request, context: RouteContext) {
  try {
    const user = await requireApiUser(request);
    const { workspaceId } = await context.params;
    const input = knowledgeEntryCreateSchema.parse(await parseJsonBody(request));
    const item = await knowledgeService.create(user.id, workspaceId, input);
    return NextResponse.json({ item }, { status: 201 });
  } catch (error) {
    return apiError(error);
  }
}
