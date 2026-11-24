import { NextResponse } from "next/server";

import { apiError, requireApiUser } from "@/lib/api";
import { knowledgeDocumentService } from "@/services/knowledge-document.service";

interface RouteContext {
  params: Promise<{ workspaceId: string; documentId: string }>;
}

/** DELETE /api/workspaces/[workspaceId]/knowledge-documents/[documentId] — remove a knowledge file (OWNER/ADMIN). */
export async function DELETE(request: Request, context: RouteContext) {
  try {
    const user = await requireApiUser(request);
    const { workspaceId, documentId } = await context.params;
    await knowledgeDocumentService.remove(user.id, workspaceId, documentId);
    return NextResponse.json({ ok: true });
  } catch (error) {
    return apiError(error);
  }
}
