"use client";

import { Pencil, Plus, Sparkles, Trash2 } from "lucide-react";
import { useState, type ReactNode } from "react";

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

interface AiKnowledgeProps {
  workspaceId: string;
  initialEntries: KnowledgeEntryView[];
  aiConfigured: boolean;
  aiLabel: string | null;
  usageThisMonth: number;
  canManage: boolean;
  /** Knowledge documents UI, rendered inside this card (Dograh-style:
   *  one knowledge base holding both typed entries and files). */
  documentsSlot?: ReactNode;
}

/**
 * Automation → AI assistant & knowledge base (Phase 13G). Knowledge
 * entries ground the composer's AI suggestions; management is
 * OWNER/ADMIN (workspace.update), matching the service gates.
 * Adding and editing an entry happens in a modal (Jeet, 2026-11-26),
 * and the knowledge documents live inside this same card, the way
 * Dograh keeps every knowledge source in one Knowledge Base.
 */
export function AiKnowledge({
  workspaceId,
  initialEntries,
  aiConfigured,
  aiLabel,
  usageThisMonth,
  canManage,
  documentsSlot,
}: AiKnowledgeProps) {
  const [entries, setEntries] = useState(initialEntries);
  const [notice, setNotice] = useState<string | null>(null);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [title, setTitle] = useState("");
  const [content, setContent] = useState("");
  const [saving, setSaving] = useState(false);

  const apiBase = `/api/workspaces/${workspaceId}/knowledge`;

  function openAdd() {
    setEditingId(null);
    setTitle("");
    setContent("");
    setDialogOpen(true);
  }

  function openEdit(entry: KnowledgeEntryView) {
    setEditingId(entry.id);
    setTitle(entry.title);
    setContent(entry.content);
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
    setSaving(false);
    if (res?.ok) {
      const body = (await res.json()) as { item: KnowledgeEntryView };
      setEntries((prev) =>
        editingId
          ? prev.map((entry) => (entry.id === editingId ? body.item : entry))
          : [...prev, body.item].sort((a, b) => a.title.localeCompare(b.title)),
      );
      setDialogOpen(false);
    } else {
      setNotice("Could not save that knowledge entry.");
    }
  }

  async function remove(entry: KnowledgeEntryView) {
    const res = await fetch(`${apiBase}/${entry.id}`, { method: "DELETE" }).catch(() => null);
    if (res?.ok) {
      setEntries((prev) => prev.filter((item) => item.id !== entry.id));
      if (editingId === entry.id) setDialogOpen(false);
    } else {
      setNotice("Could not delete that knowledge entry.");
    }
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Sparkles className="size-4 text-indigo-600" /> AI assistant &amp; knowledge base
        </CardTitle>
        <CardDescription>
          The inbox composer&apos;s AI can suggest replies, rewrite drafts, summarize threads,
          detect sentiment and translate — always as a draft the agent approves. Entries and
          documents below ground its suggestions in your own policies and facts.
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
          {entries.map((entry) => (
            <div key={entry.id} className="flex items-start gap-2 rounded-lg border px-3 py-2">
              <div className="min-w-0 flex-1">
                <p className="text-sm font-medium">{entry.title}</p>
                <p className="text-muted-foreground line-clamp-3 text-xs">{entry.content}</p>
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
          ))}
          {entries.length === 0 ? (
            <p className="text-muted-foreground text-sm">
              No knowledge entries yet. Add things like delivery policy, return rules, or product
              FAQs — the AI will use them when drafting replies.
            </p>
          ) : null}
        </div>

        {documentsSlot ? <div className="border-t pt-4">{documentsSlot}</div> : null}
      </CardContent>

      {canManage ? (
        <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
          <DialogContent className="sm:max-w-lg">
            <DialogHeader>
              <DialogTitle>{editingId ? "Edit entry" : "Add entry"}</DialogTitle>
              <DialogDescription>
                A fact the AI can quote when it drafts or sends replies — written the way you
                would tell a new teammate.
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
                  rows={8}
                  className="text-sm leading-relaxed"
                />
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
