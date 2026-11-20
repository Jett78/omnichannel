import { NextResponse } from "next/server";

import { apiError, parseJsonBody, requireApiUser } from "@/lib/api";
import { availabilityUpdateSchema } from "@/lib/validations";
import { automationService } from "@/services/automation.service";

interface RouteContext {
  params: Promise<{ workspaceId: string }>;
}

/**
 * PATCH /api/workspaces/[workspaceId]/members/availability — the
 * signed-in member toggles their own smart-assignment availability
 * (Phase 13B).
 */
export async function PATCH(request: Request, context: RouteContext) {
  try {
    const user = await requireApiUser(request);
    const { workspaceId } = await context.params;
    const input = availabilityUpdateSchema.parse(await parseJsonBody(request));
    const result = await automationService.setMyAvailability(user.id, workspaceId, input.isAvailable);
    return NextResponse.json(result);
  } catch (error) {
    return apiError(error);
  }
}
