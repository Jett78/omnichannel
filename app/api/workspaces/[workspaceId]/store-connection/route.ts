import { NextResponse } from "next/server";

import { apiError, parseJsonBody, requireApiUser } from "@/lib/api";
import { storeConnectionUpsertSchema } from "@/lib/validations";
import { storeConnectionService } from "@/services/store.service";

interface RouteContext {
  params: Promise<{ workspaceId: string }>;
}

/** GET /api/workspaces/[workspaceId]/store-connection — the workspace's store connection, if any. */
export async function GET(request: Request, context: RouteContext) {
  try {
    const user = await requireApiUser(request);
    const { workspaceId } = await context.params;
    const connection = await storeConnectionService.get(user.id, workspaceId);
    return NextResponse.json({ connection });
  } catch (error) {
    return apiError(error);
  }
}

/** PUT /api/workspaces/[workspaceId]/store-connection — connect or replace the store (OWNER/ADMIN). */
export async function PUT(request: Request, context: RouteContext) {
  try {
    const user = await requireApiUser(request);
    const { workspaceId } = await context.params;
    const input = storeConnectionUpsertSchema.parse(await parseJsonBody(request));
    const connection = await storeConnectionService.upsert(user.id, workspaceId, input);
    return NextResponse.json({ connection });
  } catch (error) {
    return apiError(error);
  }
}

/** DELETE /api/workspaces/[workspaceId]/store-connection — disconnect the store (OWNER/ADMIN). */
export async function DELETE(request: Request, context: RouteContext) {
  try {
    const user = await requireApiUser(request);
    const { workspaceId } = await context.params;
    await storeConnectionService.remove(user.id, workspaceId);
    return NextResponse.json({ ok: true });
  } catch (error) {
    return apiError(error);
  }
}
