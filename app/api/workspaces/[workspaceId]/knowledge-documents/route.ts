import { NextResponse } from "next/server";

import { apiError, requireApiUser } from "@/lib/api";
import { AppError } from "@/lib/errors";
import { knowledgeDocumentService } from "@/services/knowledge-document.service";

interface RouteContext {
  params: Promise<{ workspaceId: string }>;
}

/** GET /api/workspaces/[workspaceId]/knowledge-documents — uploaded knowledge files (metadata + status only). */
export async function GET(request: Request, context: RouteContext) {
  try {
    const user = await requireApiUser(request);
    const { workspaceId } = await context.params;
    const items = await knowledgeDocumentService.list(user.id, workspaceId);
    return NextResponse.json({ items });
  } catch (error) {
    return apiError(error);
  }
}

/**
 * POST /api/workspaces/[workspaceId]/knowledge-documents — upload a
 * knowledge file (multipart form field "file", optional "title").
 * The row is created as PROCESSING; the worker extracts the text.
 */
export async function POST(request: Request, context: RouteContext) {
  try {
    const user = await requireApiUser(request);
    const { workspaceId } = await context.params;
    const form = await request.formData();
    const file = form.get("file");
    if (!file || typeof file === "string") {
      throw AppError.badRequest("Attach a file in the 'file' form field.");
    }
    const title = form.get("title");
    const bytes = Buffer.from(await file.arrayBuffer());
    const item = await knowledgeDocumentService.upload(user.id, workspaceId, {
      fileName: file.name || "document",
      mimeType: file.type || "",
      bytes,
      ...(typeof title === "string" && title.trim() ? { title } : {}),
    });
    return NextResponse.json({ item }, { status: 201 });
  } catch (error) {
    return apiError(error);
  }
}
