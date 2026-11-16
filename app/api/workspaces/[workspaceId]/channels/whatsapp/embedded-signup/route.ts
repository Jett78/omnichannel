import { NextResponse } from "next/server";

import { apiError, parseJsonBody, requireApiUser } from "@/lib/api";
import { whatsappEmbeddedSignupSchema } from "@/lib/validations";
import { whatsappConnectionService } from "@/services/whatsapp-connection.service";

interface RouteContext {
  params: Promise<{ workspaceId: string }>;
}

/**
 * POST /api/workspaces/[workspaceId]/channels/whatsapp/embedded-signup
 * Completes WhatsApp Embedded Signup: the browser popup returns
 * {code, wabaId, phoneNumberId}; the code is exchanged server-side and
 * the business token is parked in an encrypted selection session.
 * The response contains only sanitized WABA/number metadata.
 */
export async function POST(request: Request, context: RouteContext) {
  try {
    const user = await requireApiUser(request);
    const { workspaceId } = await context.params;
    const input = whatsappEmbeddedSignupSchema.parse(await parseJsonBody(request));
    const result = await whatsappConnectionService.startEmbeddedSignup(user.id, workspaceId, input);
    return NextResponse.json(
      {
        sessionId: result.sessionId,
        waba: result.waba,
        phoneNumbers: result.phoneNumbers,
        ...(result.subscriptionWarning
          ? { subscriptionWarning: result.subscriptionWarning }
          : {}),
      },
      { status: 201 },
    );
  } catch (error) {
    return apiError(error);
  }
}
