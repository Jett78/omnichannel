"use client";

import { FileText, Trash2, Upload } from "lucide-react";
import { useEffect, useRef, useState } from "react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import type { KnowledgeDocumentView } from "@/services/knowledge-document.service";

interface KnowledgeDocumentsProps {
  workspaceId: string;
  initialDocuments: KnowledgeDocumentView[];
  canManage: boolean;
}

/**
 * Settings → Knowledge documents (Dograh-style knowledge base).
 * Admins upload PDF/DOCX/TXT/Markdown/JSON files (≤5 MB); the worker
 * extracts the text and the row settles as Ready or Failed. While any
 * document is Processing the list polls every 3 seconds. Ready
 * documents ground AI suggestions and auto-replies in Full Document
 * mode — the whole text of a matching document is given to the AI.
 */
export function KnowledgeDocuments({
  workspaceId,
  initialDocuments,
  canManage,
}: KnowledgeDocumentsProps) {
  const [documents, setDocuments] = useState(initialDocuments);
  const [notice, setNotice] = useState<string | null>(null);
  const [uploading, setUploading] = useState(false);
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const apiBase = `/api/workspaces/${workspaceId}/knowledge-documents`;
  const anyProcessing = documents.some((doc) => doc.status === "PROCESSING");

  useEffect(() => {
    if (!anyProcessing) return;
    const timer = setInterval(async () => {
      const res = await fetch(apiBase).catch(() => null);
      if (res?.ok) {
        const body = (await res.json()) as { items: KnowledgeDocumentView[] };
        setDocuments(body.items);
      }
    }, 3000);
    return () => clearInterval(timer);
  }, [anyProcessing, apiBase]);

  async function upload(file: File) {
    setUploading(true);
    setNotice(null);
    const form = new FormData();
    form.set("file", file);
    const res = await fetch(apiBase, { method: "POST", body: form }).catch(() => null);
    setUploading(false);
    if (res?.ok) {
      const body = (await res.json()) as { item: KnowledgeDocumentView };
      setDocuments((prev) => [body.item, ...prev]);
    } else {
      const body = res ? ((await res.json().catch(() => null)) as { error?: string } | null) : null;
      setNotice(body?.error ?? "That file could not be uploaded.");
    }
  }

  async function remove(doc: KnowledgeDocumentView) {
    const res = await fetch(`${apiBase}/${doc.id}`, { method: "DELETE" }).catch(() => null);
    setConfirmDeleteId(null);
    if (res?.ok) {
      setDocuments((prev) => prev.filter((item) => item.id !== doc.id));
    } else {
      setNotice("Could not delete that document.");
    }
  }

  function formatSize(bytes: number): string {
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <FileText className="size-4" /> Knowledge documents
        </CardTitle>
        <CardDescription>
          Upload files the AI can read — price lists, delivery policies, FAQs. PDF, DOCX, TXT,
          Markdown or JSON, up to 5 MB each. When a customer&apos;s message matches a Ready
          document, the AI answers from its full text (Full Document mode) and names it under
          &ldquo;Used knowledge&rdquo;.
        </CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-4">
        {canManage ? (
          <div>
            <input
              ref={fileInputRef}
              type="file"
              accept=".pdf,.docx,.txt,.md,.markdown,.json"
              className="hidden"
              onChange={(event) => {
                const file = event.target.files?.[0];
                event.target.value = "";
                if (file) void upload(file);
              }}
            />
            <Button
              type="button"
              variant="outline"
              disabled={uploading}
              onClick={() => fileInputRef.current?.click()}
            >
              <Upload className="size-4" /> {uploading ? "Uploading…" : "Upload a document"}
            </Button>
          </div>
        ) : (
          <p className="text-sm text-muted-foreground">
            Only workspace owners and admins can manage knowledge documents.
          </p>
        )}

        {notice ? <p className="text-sm text-destructive">{notice}</p> : null}

        {documents.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            No documents yet. Upload a price list or policy file and the AI will answer from it,
            alongside the typed knowledge entries above.
          </p>
        ) : (
          <ul className="flex flex-col divide-y">
            {documents.map((doc) => (
              <li key={doc.id} className="flex items-start gap-3 py-3">
                <FileText className="mt-0.5 size-4 shrink-0 text-muted-foreground" />
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-medium">{doc.fileName}</p>
                  <p className="text-xs text-muted-foreground">
                    {formatSize(doc.sizeBytes)} · Full document
                    {doc.status === "READY" && doc.charCount !== null
                      ? ` · ${doc.charCount.toLocaleString("en-US")} characters`
                      : ""}
                  </p>
                  {doc.status === "FAILED" && doc.error ? (
                    <p className="mt-1 text-xs text-destructive">{doc.error}</p>
                  ) : null}
                </div>
                {doc.status === "PROCESSING" ? (
                  <Badge className="bg-amber-100 text-amber-800 dark:bg-amber-950 dark:text-amber-200">
                    Processing…
                  </Badge>
                ) : doc.status === "READY" ? (
                  <Badge className="bg-emerald-100 text-emerald-800 dark:bg-emerald-950 dark:text-emerald-200">
                    Ready
                  </Badge>
                ) : (
                  <Badge className="bg-red-100 text-red-800 dark:bg-red-950 dark:text-red-200">
                    Failed
                  </Badge>
                )}
                {canManage ? (
                  confirmDeleteId === doc.id ? (
                    <span className="flex shrink-0 items-center gap-1">
                      <Button
                        type="button"
                        size="sm"
                        variant="destructive"
                        onClick={() => void remove(doc)}
                      >
                        Delete
                      </Button>
                      <Button
                        type="button"
                        size="sm"
                        variant="ghost"
                        onClick={() => setConfirmDeleteId(null)}
                      >
                        Cancel
                      </Button>
                    </span>
                  ) : (
                    <Button
                      type="button"
                      size="sm"
                      variant="ghost"
                      aria-label={`Delete ${doc.fileName}`}
                      onClick={() => setConfirmDeleteId(doc.id)}
                    >
                      <Trash2 className="size-4" />
                    </Button>
                  )
                ) : null}
              </li>
            ))}
          </ul>
        )}
      </CardContent>
    </Card>
  );
}
