import { NextResponse } from "next/server";

import { apiError } from "@/lib/api";
import { getWidgetChannel, publicConfigOf } from "@/services/widget.service";

interface RouteContext {
  params: Promise<{ websiteToken: string }>;
}

/**
 * GET /api/widget/[websiteToken] — the widget's public configuration
 * (branding + welcome copy). The website token is public by design;
 * no visitor data is exposed here.
 */
export async function GET(_request: Request, context: RouteContext) {
  try {
    const { websiteToken } = await context.params;
    const channel = await getWidgetChannel(websiteToken);
    return NextResponse.json({ config: publicConfigOf(channel) });
  } catch (error) {
    return apiError(error);
  }
}
