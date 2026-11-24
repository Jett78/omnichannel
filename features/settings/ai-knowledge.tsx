"use client";

import { Pencil, Sparkles, Trash2 } from "lucide-react";
import { useState } from "react";

import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
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
}

/**
 * Settings → AI assistant & knowledge base (Phase 13G). Knowledge
 * entries ground the composer's AI suggestions; management is
 * OWNER/ADMIN (workspace.update), matching the service gates.
 */
export function AiKnowledge({
  workspaceId,
  initialEntries,
  aiConfigured,
  aiLabel,
  usageThisMonth,
  canManage,
}: AiKnowledgeProps) {
  const [entries, setEntries] = useState(initialEntries);
  const [notice, setNotice] = useState<string | null>(null);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [title, setTitle] = useState("");
  const [content, setContent] = useState("");
  const [saving, setSaving] = useState(false);

  const apiBase = `/api/workspaces/${workspaceId}/knowledge`;

  function resetForm() {
    setEditingId(null);
    setTitle("");
    setContent("");
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
      resetForm();
    } else {
      setNotice("Could not save that knowledge entry.");
    }
  }

  async function remove(entry: KnowledgeEntryView) {
    const res = await fetch(`${apiBase}/${entry.id}`, { method: "DELETE" }).catch(() => null);
    if (res?.ok) {
      setEntries((prev) => prev.filter((item) => item.id !== entry.id));
      if (editingId === entry.id) resetForm();
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
          detect sentiment and translate — always as a draft the agent approves. Entries below
          ground its suggestions in your own policies and facts.
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

        <div className="flex flex-col gap-2">
          {entries.map((entry) => (
            <div key={entry.id} className="flex items-start gap-2 rounded-lg border px-3 py-2">
              <div className="min-w-0 flex-1">
                <p className="text-sm font-medium">{entry.title}</p>
                <p className="text-muted-foreground line-clamp-2 text-xs">{entry.content}</p>
              </div>
              {canManage ? (
                <>
                  <Button
                    variant="ghost"
                    size="icon"
                    className="text-muted-foreground size-7 shrink-0"
                    aria-label={`Edit ${entry.title}`}
                    onClick={() => {
                      setEditingId(entry.id);
                      setTitle(entry.title);
                      setContent(entry.content);
                    }}
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

        {canManage ? (
          <div className="flex flex-col gap-2 border-t pt-3">
            <Input
              value={title}
              onChange={(event) => setTitle(event.target.value)}
              placeholder="Title, e.g. Delivery policy"
              aria-label="Knowledge entry title"
            />
            <Textarea
              value={content}
              onChange={(event) => setContent(event.target.value)}
              placeholder="The facts, in plain text…"
              aria-label="Knowledge entry content"
              rows={4}
            />
            <div className="flex justify-end gap-2">
              {editingId ? (
                <Button variant="ghost" onClick={resetForm}>
                  Cancel edit
                </Button>
              ) : null}
              <Button
                onClick={() => void save()}
                disabled={!title.trim() || !content.trim() || saving}
              >
                {saving ? "Saving…" : editingId ? "Save changes" : "Add entry"}
              </Button>
            </div>
          </div>
        ) : null}
      </CardContent>
    </Card>
  );
}
