import { AppError } from "@/lib/errors";
import {
  extractKnowledgeText,
  knowledgeFileKind,
  knowledgeFileRejection,
  MAX_KNOWLEDGE_FILE_BYTES,
} from "@/lib/knowledge-extract";
import { prisma } from "@/lib/prisma";
import { getQueues } from "@/lib/queue";
import { requireWorkspacePermission } from "@/lib/workspace-auth";

/**
 * Dograh-style knowledge base documents.
 *
 * An admin uploads a file (PDF/DOCX/TXT/Markdown/JSON, ≤5 MB); the row
 * is created as PROCESSING and a worker job extracts the text. Only
 * READY documents ground AI replies. The view NEVER includes the file
 * bytes or the extracted text — the Settings UI shows metadata and
 * status, and the AI layer reads the text server-side.
 */

export interface KnowledgeDocumentView {
  id: string;
  title: string;
  fileName: string;
  mimeType: string;
  sizeBytes: number;
  mode: string;
  status: string;
  error: string | null;
  charCount: number | null;
  createdAt: string;
  updatedAt: string;
  /** The knowledge entry this document belongs to (null = unattached). */
  entryId: string | null;
}

type DocumentRow = {
  id: string;
  title: string;
  fileName: string;
  mimeType: string;
  sizeBytes: number;
  mode: string;
  status: string;
  error: string | null;
  charCount: number | null;
  createdAt: Date;
  updatedAt: Date;
  entryId: string | null;
};

function toView(row: DocumentRow): KnowledgeDocumentView {
  return {
    id: row.id,
    title: row.title,
    fileName: row.fileName,
    mimeType: row.mimeType,
    sizeBytes: row.sizeBytes,
    mode: row.mode,
    status: row.status,
    error: row.error,
    charCount: row.charCount,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
    entryId: row.entryId,
  };
}

const VIEW_SELECT = {
  id: true,
  title: true,
  fileName: true,
  mimeType: true,
  sizeBytes: true,
  mode: true,
  status: true,
  error: true,
  charCount: true,
  createdAt: true,
  updatedAt: true,
  entryId: true,
} as const;

export const knowledgeDocumentService = {
  async list(
    actorUserId: string,
    workspaceId: string,
  ): Promise<KnowledgeDocumentView[]> {
    await requireWorkspacePermission(actorUserId, workspaceId, "conversations.view");
    const rows = await prisma.knowledgeDocument.findMany({
      where: { workspaceId },
      orderBy: { createdAt: "desc" },
      select: VIEW_SELECT,
    });
    return rows.map(toView);
  },

  async upload(
    actorUserId: string,
    workspaceId: string,
    input: {
      fileName: string;
      mimeType: string;
      bytes: Buffer;
      title?: string;
      entryId?: string;
    },
  ): Promise<KnowledgeDocumentView> {
    await requireWorkspacePermission(actorUserId, workspaceId, "workspace.update");
    const fileName = input.fileName.trim();
    if (!fileName) throw AppError.badRequest("A file name is required.");
    if (!knowledgeFileKind(fileName)) {
      throw AppError.badRequest(knowledgeFileRejection(fileName));
    }
    if (input.bytes.length === 0) throw AppError.badRequest("The file is empty.");
    if (input.bytes.length > MAX_KNOWLEDGE_FILE_BYTES) {
      throw AppError.badRequest("Knowledge files can be at most 5 MB.");
    }
    if (input.entryId) {
      const entry = await prisma.knowledgeEntry.findFirst({
        where: { id: input.entryId, workspaceId },
        select: { id: true },
      });
      if (!entry) throw AppError.badRequest("That knowledge entry does not exist.");
    }
    const row = await prisma.knowledgeDocument.create({
      data: {
        workspaceId,
        title: input.title?.trim() || fileName,
        fileName,
        mimeType: input.mimeType || "application/octet-stream",
        sizeBytes: input.bytes.length,
        data: Uint8Array.from(input.bytes),
        createdById: actorUserId,
        ...(input.entryId ? { entryId: input.entryId } : {}),
      },
      select: VIEW_SELECT,
    });
    await getQueues().knowledge.add("extract", {
      documentId: row.id,
      workspaceId,
    });
    return toView(row);
  },

  async remove(
    actorUserId: string,
    workspaceId: string,
    documentId: string,
  ): Promise<void> {
    await requireWorkspacePermission(actorUserId, workspaceId, "workspace.update");
    const existing = await prisma.knowledgeDocument.findFirst({
      where: { id: documentId, workspaceId },
      select: { id: true },
    });
    if (!existing) throw AppError.notFound("Knowledge document not found");
    await prisma.knowledgeDocument.delete({ where: { id: documentId } });
  },
};

/**
 * Worker-side processing: extract the text and settle the row as
 * READY (text stored) or FAILED (reason stored). Extraction errors
 * are NOT thrown — retrying a corrupt file would fail identically;
 * only infrastructure errors propagate to BullMQ's retry.
 */
export async function processKnowledgeDocument(documentId: string): Promise<void> {
  const row = await prisma.knowledgeDocument.findUnique({
    where: { id: documentId },
  });
  if (!row) {
    console.warn(`[worker:knowledge] document ${documentId} not found — skipping`);
    return;
  }
  if (row.status === "READY") return;
  const kind = knowledgeFileKind(row.fileName);
  try {
    if (!kind) throw new Error(knowledgeFileRejection(row.fileName));
    const text = await extractKnowledgeText(kind, Buffer.from(row.data));
    await prisma.knowledgeDocument.update({
      where: { id: documentId },
      data: { status: "READY", extractedText: text, charCount: text.length, error: null },
    });
    console.log(
      `[worker:knowledge] document ${documentId} ready (${text.length} chars from ${row.fileName})`,
    );
  } catch (error) {
    const message = error instanceof Error ? error.message : "Text extraction failed.";
    await prisma.knowledgeDocument.update({
      where: { id: documentId },
      data: { status: "FAILED", error: message.slice(0, 300) },
    });
    console.warn(`[worker:knowledge] document ${documentId} failed: ${message}`);
  }
}
