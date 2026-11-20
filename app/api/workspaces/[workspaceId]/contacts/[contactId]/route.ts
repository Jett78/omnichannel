import { NextResponse } from "next/server";

import { apiError, parseJsonBody, requireApiUser } from "@/lib/api";
import { contactProfileUpdateSchema } from "@/lib/validations";
import { contactProfileService } from "@/services/contact-profile.service";

interface RouteContext {
  params: Promise<{ workspaceId: string; contactId: string }>;
}

/** PATCH /api/workspaces/[workspaceId]/contacts/[contactId] — edit profile fields (Phase 13D). */
export async function PATCH(request: Request, context: RouteContext) {
  try {
    const user = await requireApiUser(request);
    const { workspaceId, contactId } = await context.params;
    const input = contactProfileUpdateSchema.parse(await parseJsonBody(request));
    const profile = await contactProfileService.updateContact(user.id, workspaceId, contactId, input);
    return NextResponse.json({ profile });
  } catch (error) {
    return apiError(error);
  }
}
