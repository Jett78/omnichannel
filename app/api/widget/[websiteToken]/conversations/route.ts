import { NextResponse } from "next/server";

import { apiError, parseJsonBody } from "@/lib/api";
import { AppError } from "@/lib/errors";
import { widgetStartSchema } from "@/lib/validations";
import { hitRateLimit, widgetService } from "@/services/widget.service";

interface RouteContext {
  params: Promise<{ websiteToken: string }>;
}

function clientIp(request: Request): string {
  return request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ?? "unknown";
}

/**
 * POST /api/widget/[websiteToken]/conversations — start a visitor
 * conversation: creates the visitor's contact + identity and returns
 * their signed visitor token. Rate-limited per site + IP because
 * this endpoint is public.
 */
export async function POST(request: Request, context: RouteContext) {
  try {
    const { websiteToken } = await context.params;
    const allowed = await hitRateLimit(
      `widget:start:${websiteToken}:${clientIp(request)}`,
      10,
      3600,
    );
    if (!allowed) {
      throw new AppError("Too many chats started — please try again later.", "RATE_LIMITED", 429);
    }
    const input = widgetStartSchema.parse(await parseJsonBody(request));
    const email = input.email && /.+@.+\..+/.test(input.email) ? input.email : undefined;
    const result = await widgetService.startConversation(websiteToken, {
      ...(input.name ? { name: input.name } : {}),
      ...(email ? { email } : {}),
    });
    return NextResponse.json(result, { status: 201 });
  } catch (error) {
    return apiError(error);
  }
}
