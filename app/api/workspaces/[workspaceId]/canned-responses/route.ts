import { NextResponse } from "next/server";

import { apiError, parseJsonBody, requireApiUser } from "@/lib/api";
import { cannedResponseCreateSchema } from "@/lib/validations";
import { cannedResponseService } from "@/services/canned-response.service";

interface RouteContext {
  params: Promise<{ workspaceId: string }>;
}

/** GET /api/workspaces/[workspaceId]/canned-responses — list saved replies. */
export async function GET(request: Request, context: RouteContext) {
  try {
    const user = await requireApiUser(request);
    const { workspaceId } = await context.params;
    const items = await cannedResponseService.list(user.id, workspaceId);
    return NextResponse.json({ items });
  } catch (error) {
    return apiError(error);
  }
}

/** POST /api/workspaces/[workspaceId]/canned-responses — create a saved reply. */
export async function POST(request: Request, context: RouteContext) {
  try {
    const user = await requireApiUser(request);
    const { workspaceId } = await context.params;
    const input = cannedResponseCreateSchema.parse(await parseJsonBody(request));
    const item = await cannedResponseService.create(user.id, workspaceId, input);
    return NextResponse.json({ item }, { status: 201 });
  } catch (error) {
    return apiError(error);
  }
}
