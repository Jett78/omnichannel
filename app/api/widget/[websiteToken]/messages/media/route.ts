import { NextResponse } from "next/server";

import { apiError } from "@/lib/api";
import { AppError } from "@/lib/errors";
import { hitRateLimit, verifyVisitorToken, widgetService } from "@/services/widget.service";

interface RouteContext {
  params: Promise<{ websiteToken: string }>;
}

/**
 * POST /api/widget/[websiteToken]/messages/media — a visitor sends
 * an image/file: multipart form with `file` and an optional
 * `caption`; the visitor token travels in the x-visitor-token
 * header. Bytes are stored in StoredMedia via the widget service.
 */
export async function POST(request: Request, context: RouteContext) {
  try {
    const { websiteToken } = await context.params;
    const visitorToken = request.headers.get("x-visitor-token") ?? "";
    const verified = verifyVisitorToken(visitorToken);
    if (!verified) throw AppError.unauthorized("Invalid visitor token");
    const allowed = await hitRateLimit(`widget:media:${verified.externalUserId}`, 20, 60);
    if (!allowed) {
      throw new AppError("You are sending files too quickly — please slow down.", "RATE_LIMITED", 429);
    }
    const form = await request.formData();
    const file = form.get("file");
    if (!(file instanceof File)) throw AppError.badRequest("No file was uploaded.");
    const caption = form.get("caption");
    const bytes = Buffer.from(await file.arrayBuffer());
    const result = await widgetService.sendMediaMessage(websiteToken, visitorToken, {
      bytes,
      fileName: file.name || "file",
      mimeType: file.type || "application/octet-stream",
      ...(typeof caption === "string" && caption.trim() ? { caption } : {}),
    });
    return NextResponse.json(result, { status: 201 });
  } catch (error) {
    return apiError(error);
  }
}
