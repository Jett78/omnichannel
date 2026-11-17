import { NextResponse } from "next/server";

import { apiError, parseJsonBody, requireApiUser } from "@/lib/api";
import { updateContactDetailsSchema } from "@/lib/validations";
import { conversationService } from "@/services/conversation.service";

interface RouteContext {
  params: Promise<{ workspaceId: string; conversationId: string }>;
}

/**
 * PATCH …/contact — set or clear the conversation contact's phone/email
 * (inbox Customer details → Edit). Empty string clears a field.
 */
export async function PATCH(request: Request, context: RouteContext) {
  try {
    const user = await requireApiUser(request);
    const { workspaceId, conversationId } = await context.params;
    const input = updateContactDetailsSchema.parse(await parseJsonBody(request));
    const contact = await conversationService.updateContactDetails(
      user.id,
      workspaceId,
      conversationId,
      input,
    );
    return NextResponse.json({
      contact: {
        id: contact.id,
        phone: contact.phone,
        email: contact.email,
      },
    });
  } catch (error) {
    return apiError(error);
  }
}
