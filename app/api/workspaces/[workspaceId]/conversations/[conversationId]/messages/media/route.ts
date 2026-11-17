import { NextResponse } from "next/server";

import { apiError, requireApiUser } from "@/lib/api";
import { AppError } from "@/lib/errors";
import { messagingService } from "@/services/messaging.service";

interface RouteContext {
  params: Promise<{ workspaceId: string; conversationId: string }>;
}

/**
 * POST …/messages/media — send a file from the inbox composer
 * (multipart form: `file`, optional `caption`). The file is uploaded to
 * the platform and delivered through the normal outbound queue.
 */
export async function POST(request: Request, context: RouteContext) {
  try {
    const user = await requireApiUser(request);
    const { workspaceId, conversationId } = await context.params;
    const form = await request.formData();
    const file = form.get("file");
    if (!(file instanceof File)) {
      throw AppError.badRequest("A file is required (multipart field 'file').");
    }
    const caption = form.get("caption");
    const bytes = Buffer.from(await file.arrayBuffer());
    const message = await messagingService.sendOutboundMedia(
      user.id,
      workspaceId,
      conversationId,
      {
        bytes,
        fileName: file.name || "file",
        mimeType: file.type || "application/octet-stream",
        ...(typeof caption === "string" && caption.trim() ? { caption } : {}),
      },
    );
    return NextResponse.json({ message }, { status: 201 });
  } catch (error) {
    return apiError(error);
  }
}
