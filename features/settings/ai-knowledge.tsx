"use client";

import { FileText, Paperclip, Pencil, Plus, Sparkles, Trash2, X } from "lucide-react";
import { useEffect, useRef, useState } from "react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import type { KnowledgeEntryView } from "@/services/ai.service";
import type { KnowledgeDocumentView } from "@/services/knowledge-document.service";

interface AiKnowledgeProps {
  workspaceId: string;
  initialEntries: KnowledgeEntryView[];
  initialDocuments: KnowledgeDocumentView[];
  aiConfigured: boolean;
  aiLabel: string | null;
  usageThisMonth: number;
  canManage: boolean;
}

/**
 * Automation → AI assistant & knowledge base (Phase 13G + documents).
 * Each knowledge entry holds a title, its facts AND its own documents
 * (Dograh-style, Jeet 2026-11-26): adding/editing happens in one big
 * modal, files picked there upload when the entry is saved, and the
 * worker extracts their text so Ready documents ground AI replies
 * alongside the typed facts. Management is OWNER/ADMIN
 * (workspace.update), matching the service gates.
 */
export function AiKnowledge({
  workspaceId,
  initialEntries,
  initialDocuments,
  aiConfigured,
  aiLabel,
  usageThisMonth,
  canManage,
}: AiKnowledgeProps) {
  const [entries, setEntries] = useState(initialEntries);
  const [documents, setDocuments] = useState(initialDocuments);
  const [notice, setNotice] = useState<string | null>(null);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [title, setTitle] = useState("");
  const [content, setContent] = useState("");
  const [stagedFiles, setStagedFiles] = useState<File[]>([]);
  const [confirmDeleteDocId, setConfirmDeleteDocId] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const apiBase = `/api/workspaces/${workspaceId}/knowledge`;
  const docsApi = `/api/workspaces/${workspaceId}/knowledge-documents`;

  const anyProcessing = documents.some((doc) => doc.status === "PROCESSING");
  useEffect(() => {
    if (!anyProcessing) return;
    const timer = setInterval(async () => {
      const res = await fetch(docsApi).catch(() => null);
      if (res?.ok) {
        const body = (await res.json()) as { items: KnowledgeDocumentView[] };
        setDocuments(body.items);
      }
    }, 3000);
    return () => clearInterval(timer);
  }, [anyProcessing, docsApi]);

  const docsFor = (entryId: string) => documents.filter((doc) => doc.entryId === entryId);
  const orphanDocs = documents.filter(
    (doc) => !doc.entryId || !entries.some((entry) => entry.id === doc.entryId),
  );

  function openAdd() {
    setEditingId(null);
    setTitle("");
    setContent("");
    setStagedFiles([]);
    setConfirmDeleteDocId(null);
    setDialogOpen(true);
  }

  function openEdit(entry: KnowledgeEntryView) {
    setEditingId(entry.id);
    setTitle(entry.title);
    setContent(entry.content);
    setStagedFiles([]);
    setConfirmDeleteDocId(null);
    setDialogOpen(true);
  }

  async function save() {
    if (!title.trim() || !content.trim() || saving) return;
    setSaving(true);
    const res = editingId
      ? await fetch(`${apiBase}/${editingId}`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ title: title.trim(), content }),
        }).catch(() => null)
      : await fetch(apiBase, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ title: title.trim(), content }),
        }).catch(() => null);
    if (!res?.ok) {
      setSaving(false);
      setNotice("Could not save that knowledge entry.");
      return;
    }
    const body = (await res.json()) as { item: KnowledgeEntryView };
    const saved = body.item;
    setEntries((prev) =>
      editingId
        ? prev.map((entry) => (entry.id === editingId ? saved : entry))
        : [...prev, saved].sort((a, b) => a.title.localeCompare(b.title)),
    );
    // Files picked in the modal upload against the saved entry.
    let uploadFailed = false;
    for (const file of stagedFiles) {
      const form = new FormData();
      form.set("file", file);
      form.set("entryId", saved.id);
      const up = await fetch(docsApi, { method: "POST", body: form }).catch(() => null);
      if (up?.ok) {
        const upBody = (await up.json()) as { item: KnowledgeDocumentView };
        setDocuments((prev) => [upBody.item, ...prev]);
      } else {
        uploadFailed = true;
      }
    }
    setSaving(false);
    setStagedFiles([]);
    setDialogOpen(false);
    if (uploadFailed) {
      setNotice("The entry was saved, but a document could not be uploaded.");
    }
  }

  async function remove(entry: KnowledgeEntryView) {
    const res = await fetch(`${apiBase}/${entry.id}`, { method: "DELETE" }).catch(() => null);
    if (res?.ok) {
      setEntries((prev) => prev.filter((item) => item.id !== entry.id));
      setDocuments((prev) => prev.filter((doc) => doc.entryId !== entry.id));
      if (editingId === entry.id) setDialogOpen(false);
    } else {
      setNotice("Could not delete that knowledge entry.");
    }
  }

  async function removeDoc(doc: KnowledgeDocumentView) {
    const res = await fetch(`${docsApi}/${doc.id}`, { method: "DELETE" }).catch(() => null);
    setConfirmDeleteDocId(null);
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

  function docStatusBadge(doc: KnowledgeDocumentView) {
    return doc.status === "PROCESSING" ? (
      <Badge className="bg-amber-100 text-amber-800 dark:bg-amber-950 dark:text-amber-200">
        Processing…
      </Badge>
    ) : doc.status === "READY" ? (
      <Badge className="bg-emerald-100 text-emerald-800 dark:bg-emerald-950 dark:text-emerald-200">
        Ready
      </Badge>
    ) : (
      <Badge className="bg-red-100 text-red-800 dark:bg-red-950 dark:text-red-200">Failed</Badge>
    );
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Sparkles className="size-4 text-indigo-600" /> AI assistant &amp; knowledge base
        </CardTitle>
        <CardDescription>
          The inbox composer&apos;s AI can suggest replies, rewrite drafts, summarize threads,
          detect sentiment and translate — always as a draft the agent approves. Each entry
          below holds facts and documents that ground its suggestions in your own policies.
        </CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-4">
        {aiConfigured ? (
          <p className="flex items-center gap-2 rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-2 text-sm text-emerald-800 dark:border-emerald-500/30 dark:bg-emerald-500/10 dark:text-emerald-300">
            <span className="size-2 rounded-full bg-emerald-500" />
            AI connected: {aiLabel}. Used {usageThisMonth} time{usageThisMonth === 1 ? "" : "s"}{" "}
            this month.
          </p>
        ) : (
          <div className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-900 dark:border-amber-500/30 dark:bg-amber-500/10 dark:text-amber-200">
            <p className="font-medium">AI is not configured for this workspace yet</p>
            <p className="mt-1 text-[13px]">
              Add this workspace&apos;s own provider key in the{" "}
              <span className="font-medium">AI model</span> card above — pick a provider (Groq
              and Gemini have free tiers), pick a model, paste your key. The AI panel in the
              inbox and the AI auto-reply switch on immediately, no redeploy needed.
            </p>
          </div>
        )}

        {notice ? (
          <p className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700 dark:border-red-500/30 dark:bg-red-500/10 dark:text-red-300">
            {notice}
          </p>
        ) : null}

        <div className="flex items-center justify-between gap-2">
          <p className="text-xs font-semibold tracking-wider text-muted-foreground uppercase">
            Entries
          </p>
          {canManage ? (
            <Button size="sm" className="gap-1.5" onClick={openAdd}>
              <Plus className="size-3.5" /> Add entry
            </Button>
          ) : null}
        </div>

        <div className="flex flex-col gap-2">
          {entries.map((entry) => {
            const entryDocs = docsFor(entry.id);
            return (
              <div key={entry.id} className="flex items-start gap-2 rounded-lg border px-3 py-2">
                <div className="min-w-0 flex-1">
                  <p className="text-sm font-medium">{entry.title}</p>
                  <p className="text-muted-foreground line-clamp-3 text-xs">{entry.content}</p>
                  {entryDocs.length > 0 ? (
                    <ul className="flex flex-col gap-1 pt-2">
                      {entryDocs.map((doc) => (
                        <li
                          key={doc.id}
                          className="text-muted-foreground flex items-center gap-1.5 text-xs"
                        >
                          <FileText className="size-3.5 shrink-0" />
                          <span className="truncate">{doc.fileName}</span>
                          <span
                            className={
                              doc.status === "READY"
                                ? "shrink-0 text-emerald-600"
                                : doc.status === "PROCESSING"
                                  ? "shrink-0 text-amber-600"
                                  : "shrink-0 text-red-600"
                            }
                          >
                            · {doc.status === "READY" ? "Ready" : doc.status === "PROCESSING" ? "Processing…" : "Failed"}
                          </span>
                        </li>
                      ))}
                    </ul>
                  ) : null}
                </div>
                {canManage ? (
                  <>
                    <Button
                      variant="ghost"
                      size="icon"
                      className="text-muted-foreground size-7 shrink-0"
                      aria-label={`Edit ${entry.title}`}
                      onClick={() => openEdit(entry)}
                    >
                      <Pencil className="size-3.5" />
                    </Button>
                    <Button
                      variant="ghost"
                      size="icon"
                      className="size-7 shrink-0 text-red-600"
                      aria-label={`Delete ${entry.title}`}
                      onClick={() => void remove(entry)}
                    >
                      <Trash2 className="size-3.5" />
                    </Button>
                  </>
                ) : null}
              </div>
            );
          })}
          {entries.length === 0 ? (
            <p className="text-muted-foreground text-sm">
              No knowledge entries yet. Add things like delivery policy, return rules, or product
              FAQs — the AI will use them when drafting replies.
            </p>
          ) : null}
        </div>

        {orphanDocs.length > 0 ? (
          <div className="flex flex-col gap-2 border-t pt-3">
            <p className="text-xs font-semibold tracking-wider text-muted-foreground uppercase">
              Unattached documents
            </p>
            <ul className="flex flex-col gap-1.5">
              {orphanDocs.map((doc) => (
                <li key={doc.id} className="flex items-center gap-2 text-sm">
                  <FileText className="text-muted-foreground size-4 shrink-0" />
                  <span className="min-w-0 flex-1 truncate">{doc.fileName}</span>
                  {docStatusBadge(doc)}
                  {canManage ? (
                    <Button
                      variant="ghost"
                      size="icon"
                      className="size-7 shrink-0 text-red-600"
                      aria-label={`Delete ${doc.fileName}`}
                      onClick={() => void removeDoc(doc)}
                    >
                      <Trash2 className="size-3.5" />
                    </Button>
                  ) : null}
                </li>
              ))}
            </ul>
            <p className="text-muted-foreground text-[11px]">
              Uploaded before documents belonged to entries. They still ground the AI; attach
              new files from an entry instead.
            </p>
          </div>
        ) : null}
      </CardContent>

      {canManage ? (
        <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
          <DialogContent className="max-h-[92vh] overflow-y-auto sm:max-w-3xl">
            <DialogHeader>
              <DialogTitle className="text-lg">{editingId ? "Edit entry" : "Add entry"}</DialogTitle>
              <DialogDescription>
                A fact the AI can quote when it drafts or sends replies — written the way you
                would tell a new teammate. Attach documents to this entry and the AI reads
                those too.
              </DialogDescription>
            </DialogHeader>
            <div className="flex flex-col gap-4">
              <div className="flex flex-col gap-1.5">
                <label
                  htmlFor="knowledge-title"
                  className="text-muted-foreground text-xs font-medium"
                >
                  Title
                </label>
                <Input
                  id="knowledge-title"
                  className="h-11 bg-muted/30 px-3.5"
                  value={title}
                  onChange={(event) => setTitle(event.target.value)}
                  placeholder="e.g. Delivery policy"
                />
              </div>
              <div className="flex flex-col gap-1.5">
                <label
                  htmlFor="knowledge-facts"
                  className="text-muted-foreground text-xs font-medium"
                >
                  Facts
                </label>
                <Textarea
                  id="knowledge-facts"
                  value={content}
                  onChange={(event) => setContent(event.target.value)}
                  placeholder="The facts, in plain text — delivery times, charges, areas you serve, exceptions…"
                  rows={12}
                  className="text-sm leading-relaxed"
                />
              </div>

              <div className="flex flex-col gap-2 border-t pt-4">
                <p className="text-xs font-semibold tracking-wider text-muted-foreground uppercase">
                  Documents
                </p>
                {editingId && docsFor(editingId).length > 0 ? (
                  <ul className="flex flex-col divide-y rounded-xl border">
                    {docsFor(editingId).map((doc) => (
                      <li key={doc.id} className="flex items-center gap-2.5 px-3 py-2.5">
                        <FileText className="text-muted-foreground size-4 shrink-0" />
                        <span className="min-w-0 flex-1">
                          <span className="block truncate text-sm font-medium">
                            {doc.fileName}
                          </span>
                          <span className="text-muted-foreground block text-xs">
                            {formatSize(doc.sizeBytes)} · Full document
                            {doc.status === "FAILED" && doc.error ? ` · ${doc.error}` : ""}
                          </span>
                        </span>
                        {docStatusBadge(doc)}
                        {confirmDeleteDocId === doc.id ? (
                          <span className="flex shrink-0 items-center gap-1">
                            <Button
                              type="button"
                              size="sm"
                              variant="destructive"
                              onClick={() => void removeDoc(doc)}
                            >
                              Delete
                            </Button>
                            <Button
                              type="button"
                              size="sm"
                              variant="ghost"
                              onClick={() => setConfirmDeleteDocId(null)}
                            >
                              Cancel
                            </Button>
                          </span>
                        ) : (
                          <Button
                            type="button"
                            size="icon"
                            variant="ghost"
                            className="size-7 shrink-0 text-red-600"
                            aria-label={`Delete ${doc.fileName}`}
                            onClick={() => setConfirmDeleteDocId(doc.id)}
                          >
                            <Trash2 className="size-3.5" />
                          </Button>
                        )}
                      </li>
                    ))}
                  </ul>
                ) : null}

                {stagedFiles.length > 0 ? (
                  <ul className="flex flex-col gap-1.5">
                    {stagedFiles.map((file, index) => (
                      <li
                        key={`${file.name}-${index}`}
                        className="bg-muted/40 flex items-center gap-2 rounded-lg px-3 py-2 text-sm"
                      >
                        <FileText className="text-muted-foreground size-4 shrink-0" />
                        <span className="min-w-0 flex-1 truncate">{file.name}</span>
                        <span className="text-muted-foreground shrink-0 text-xs">
                          {formatSize(file.size)}
                        </span>
                        <Button
                          type="button"
                          size="icon"
                          variant="ghost"
                          className="size-7 shrink-0"
                          aria-label={`Remove ${file.name}`}
                          onClick={() =>
                            setStagedFiles((prev) => prev.filter((_, i) => i !== index))
                          }
                        >
                          <X className="size-3.5" />
                        </Button>
                      </li>
                    ))}
                  </ul>
                ) : null}

                <input
                  ref={fileInputRef}
                  type="file"
                  accept=".pdf,.docx,.txt,.md,.markdown,.json"
                  multiple
                  className="hidden"
                  onChange={(event) => {
                    const picked = Array.from(event.target.files ?? []);
                    event.target.value = "";
                    if (picked.length) setStagedFiles((prev) => [...prev, ...picked]);
                  }}
                />
                <div>
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    className="gap-1.5 border-dashed"
                    onClick={() => fileInputRef.current?.click()}
                  >
                    <Paperclip className="size-3.5" /> Attach document
                  </Button>
                  <p className="text-muted-foreground pt-1.5 text-[11px]">
                    PDF, DOCX, TXT, Markdown or JSON, up to 5 MB each. New files upload when
                    you save the entry, and the AI answers from them once they show Ready.
                  </p>
                </div>
              </div>
            </div>
            <DialogFooter>
              <Button variant="ghost" onClick={() => setDialogOpen(false)}>
                Cancel
              </Button>
              <Button
                onClick={() => void save()}
                disabled={!title.trim() || !content.trim() || saving}
              >
                {saving ? "Saving…" : editingId ? "Save changes" : "Add entry"}
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      ) : null}
    </Card>
  );
}
