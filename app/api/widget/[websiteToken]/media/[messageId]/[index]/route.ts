import { apiError } from "@/lib/api";
import { widgetService } from "@/services/widget.service";

interface RouteContext {
  params: Promise<{ websiteToken: string; messageId: string; index: string }>;
}

/**
 * GET /api/widget/[websiteToken]/media/[messageId]/[index]?t=<visitorToken>
 * Serves one attachment of one of the visitor's OWN messages (the
 * service verifies the token and the message's ownership). All
 * website-channel media lives in StoredMedia — there is no external
 * platform to download from.
 */
export async function GET(request: Request, context: RouteContext) {
  try {
    const { websiteToken, messageId, index } = await context.params;
    const visitorToken =
      request.headers.get("x-visitor-token") ?? new URL(request.url).searchParams.get("t") ?? "";
    const parsedIndex = Number.parseInt(index, 10);
    const media = await widgetService.getMediaBytes(
      websiteToken,
      visitorToken,
      messageId,
      Number.isNaN(parsedIndex) ? 0 : parsedIndex,
    );
    const fileName = (media.fileName ?? "file").replace(/"/g, "");
    return new Response(new Uint8Array(media.bytes), {
      headers: {
        "Content-Type": media.mimeType,
        "Content-Disposition": `inline; filename="${fileName}"`,
        "Cache-Control": "private, max-age=3600",
      },
    });
  } catch (error) {
    return apiError(error);
  }
}
