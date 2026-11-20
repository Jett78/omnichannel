import { NextResponse } from "next/server";

import { apiError, parseJsonBody, requireApiUser } from "@/lib/api";
import { automationRuleCreateSchema } from "@/lib/validations";
import { automationService } from "@/services/automation.service";

interface RouteContext {
  params: Promise<{ workspaceId: string }>;
}

/** GET /api/workspaces/[workspaceId]/automations — list automation rules (Phase 13B). */
export async function GET(request: Request, context: RouteContext) {
  try {
    const user = await requireApiUser(request);
    const { workspaceId } = await context.params;
    const items = await automationService.listRules(user.id, workspaceId);
    return NextResponse.json({ items });
  } catch (error) {
    return apiError(error);
  }
}

/** POST /api/workspaces/[workspaceId]/automations — create a rule (OWNER/ADMIN). */
export async function POST(request: Request, context: RouteContext) {
  try {
    const user = await requireApiUser(request);
    const { workspaceId } = await context.params;
    const input = automationRuleCreateSchema.parse(await parseJsonBody(request));
    const item = await automationService.createRule(user.id, workspaceId, {
      name: input.name,
      trigger: input.trigger,
      conditions: input.conditions,
      actions: input.actions as never,
      enabled: input.enabled,
    });
    return NextResponse.json({ item }, { status: 201 });
  } catch (error) {
    return apiError(error);
  }
}
