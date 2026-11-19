import { NextResponse } from "next/server";

import { apiError, parseJsonBody } from "@/lib/api";
import { AppError } from "@/lib/errors";
import { widgetMessageSchema } from "@/lib/validations";
import { hitRateLimit, verifyVisitorToken, widgetService } from "@/services/widget.service";

interface RouteContext {
  params: Promise<{ websiteToken: string }>;
}

function visitorTokenFrom(request: Request): string {
  const header = request.headers.get("x-visitor-token");
  if (header) return header;
  return new URL(request.url).searchParams.get("t") ?? "";
}

/**
 * GET  /api/widget/[websiteToken]/messages — the visitor's own
 *      conversation history (polled by the widget).
 * POST /api/widget/[websiteToken]/messages — send a text message
 *      into the inbox (rate-limited per visitor).
 */
export async function GET(request: Request, context: RouteContext) {
  try {
    const { websiteToken } = await context.params;
    const result = await widgetService.listMessages(websiteToken, visitorTokenFrom(request));
    return NextResponse.json(result);
  } catch (error) {
    return apiError(error);
  }
}

export async function POST(request: Request, context: RouteContext) {
  try {
    const { websiteToken } = await context.params;
    const visitorToken = visitorTokenFrom(request);
    const verified = verifyVisitorToken(visitorToken);
    if (!verified) throw AppError.unauthorized("Invalid visitor token");
    const allowed = await hitRateLimit(`widget:send:${verified.externalUserId}`, 60, 60);
    if (!allowed) {
      throw new AppError("You are sending messages too quickly — please slow down.", "RATE_LIMITED", 429);
    }
    const input = widgetMessageSchema.parse(await parseJsonBody(request));
    const result = await widgetService.sendTextMessage(websiteToken, visitorToken, input.content);
    return NextResponse.json(result, { status: 201 });
  } catch (error) {
    return apiError(error);
  }
}
