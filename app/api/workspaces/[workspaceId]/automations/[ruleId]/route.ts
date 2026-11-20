import { NextResponse } from "next/server";

import { apiError, parseJsonBody, requireApiUser } from "@/lib/api";
import { automationRuleUpdateSchema } from "@/lib/validations";
import { automationService } from "@/services/automation.service";

interface RouteContext {
  params: Promise<{ workspaceId: string; ruleId: string }>;
}

/** PATCH /api/workspaces/[workspaceId]/automations/[ruleId] — edit a rule (Phase 13B). */
export async function PATCH(request: Request, context: RouteContext) {
  try {
    const user = await requireApiUser(request);
    const { workspaceId, ruleId } = await context.params;
    const input = automationRuleUpdateSchema.parse(await parseJsonBody(request));
    const item = await automationService.updateRule(user.id, workspaceId, ruleId, {
      ...input,
      actions: input.actions as never,
    });
    return NextResponse.json({ item });
  } catch (error) {
    return apiError(error);
  }
}

/** DELETE /api/workspaces/[workspaceId]/automations/[ruleId] */
export async function DELETE(request: Request, context: RouteContext) {
  try {
    const user = await requireApiUser(request);
    const { workspaceId, ruleId } = await context.params;
    await automationService.deleteRule(user.id, workspaceId, ruleId);
    return NextResponse.json({ ok: true });
  } catch (error) {
    return apiError(error);
  }
}
