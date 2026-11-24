import { NextResponse } from "next/server";

import { apiError, parseJsonBody, requireApiUser } from "@/lib/api";
import { storeConnectionTestSchema } from "@/lib/validations";
import { storeConnectionService } from "@/services/store.service";

interface RouteContext {
  params: Promise<{ workspaceId: string }>;
}

/** POST /api/workspaces/[workspaceId]/store-connection/test — reachability check for a store URL (OWNER/ADMIN). */
export async function POST(request: Request, context: RouteContext) {
  try {
    const user = await requireApiUser(request);
    const { workspaceId } = await context.params;
    const input = storeConnectionTestSchema.parse(await parseJsonBody(request));
    const result = await storeConnectionService.test(user.id, workspaceId, input.baseUrl);
    return NextResponse.json(result);
  } catch (error) {
    return apiError(error);
  }
}
