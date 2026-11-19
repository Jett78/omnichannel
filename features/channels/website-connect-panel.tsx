"use client";

import { Check, Copy, Globe } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState } from "react";

import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import type { RealChannel } from "@/features/channels/channels-catalog";

/**
 * Website live-chat dialogs (Phase 11). Nothing renders on the page
 * itself — the Channels catalog opens this dialog:
 *
 *  - Create ("Add to your website"): name + appearance settings.
 *    Creating the channel generates its public website token; the
 *    dialog then switches to the embed-code view.
 *  - Snippet ("Embed code" on a connected row): the one-line script
 *    tag to paste into the site. The token identifies the site —
 *    it is public by design, not a secret.
 *  - Edit ("Settings"): updates name/appearance. The bubble color
 *    is baked into the snippet, so after a color change the snippet
 *    must be copied again (the chat panel itself always uses the
 *    live settings).
 */

const COLOR_PRESETS = ["#4f46e5", "#0ea5e9", "#059669", "#ea580c", "#dc2626", "#111827"];

interface FormState {
  name: string;
  websiteUrl: string;
  widgetColor: string;
  welcomeTitle: string;
  welcomeTagline: string;
  preChatForm: boolean;
}

const EMPTY_FORM: FormState = {
  name: "",
  websiteUrl: "",
  widgetColor: "#4f46e5",
  welcomeTitle: "Chat with us",
  welcomeTagline: "We usually reply within a few minutes.",
  preChatForm: true,
};

function snippetFor(token: string, color: string): string {
  const origin = typeof window !== "undefined" ? window.location.origin : "";
  return `<script src="${origin}/widget.js" data-website-token="${token}" data-color="${color}" async></script>`;
}

export function WebsiteConnectPanel({
  workspaceId,
  connectedChannels,
  createSignal = 0,
  editSignal = 0,
  editChannelId = null,
  snippetSignal = 0,
  snippetChannelId = null,
}: {
  workspaceId: string;
  connectedChannels: RealChannel[];
  createSignal?: number;
  editSignal?: number;
  editChannelId?: string | null;
  snippetSignal?: number;
  snippetChannelId?: string | null;
}) {
  const router = useRouter();
  const [dialogOpen, setDialogOpen] = useState(false);
  const [mode, setMode] = useState<"create" | "edit" | "snippet">("create");
  const [form, setForm] = useState<FormState>(EMPTY_FORM);
  const [activeChannelId, setActiveChannelId] = useState<string | null>(null);
  const [created, setCreated] = useState<{ token: string; color: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  function formFromChannel(channel: RealChannel): FormState {
    return {
      name: channel.displayName,
      websiteUrl: channel.config?.websiteUrl ?? "",
      widgetColor: channel.config?.widgetColor ?? "#4f46e5",
      welcomeTitle: channel.config?.welcomeTitle ?? "Chat with us",
      welcomeTagline: channel.config?.welcomeTagline ?? "We usually reply within a few minutes.",
      preChatForm: channel.config?.preChatForm !== false,
    };
  }

  const [handledCreate, setHandledCreate] = useState(createSignal);
  if (createSignal !== handledCreate) {
    setHandledCreate(createSignal);
    if (createSignal > 0) {
      setMode("create");
      setForm(EMPTY_FORM);
      setActiveChannelId(null);
      setCreated(null);
      setError(null);
      setCopied(false);
      setDialogOpen(true);
    }
  }
  const [handledEdit, setHandledEdit] = useState(editSignal);
  if (editSignal !== handledEdit) {
    setHandledEdit(editSignal);
    if (editSignal > 0 && editChannelId) {
      const channel = connectedChannels.find((c) => c.id === editChannelId);
      if (channel) {
        setMode("edit");
        setForm(formFromChannel(channel));
        setActiveChannelId(channel.id);
        setError(null);
        setCopied(false);
        setDialogOpen(true);
      }
    }
  }
  const [handledSnippet, setHandledSnippet] = useState(snippetSignal);
  if (snippetSignal !== handledSnippet) {
    setHandledSnippet(snippetSignal);
    if (snippetSignal > 0 && snippetChannelId) {
      setMode("snippet");
      setActiveChannelId(snippetChannelId);
      setError(null);
      setCopied(false);
      setDialogOpen(true);
    }
  }

  const activeChannel = connectedChannels.find((c) => c.id === activeChannelId);
  const snippetToken = activeChannel?.externalAccountId ?? created?.token ?? "";
  const snippetColor =
    activeChannel?.config?.widgetColor ?? created?.color ?? form.widgetColor;
  const snippet = snippetToken ? snippetFor(snippetToken, snippetColor) : "";

  async function submit() {
    setBusy(true);
    setError(null);
    try {
      const payload = {
        name: form.name.trim(),
        websiteUrl: form.websiteUrl.trim() || undefined,
        widgetColor: form.widgetColor,
        welcomeTitle: form.welcomeTitle.trim() || undefined,
        welcomeTagline: form.welcomeTagline.trim() || undefined,
        preChatForm: form.preChatForm,
      };
      const isEdit = mode === "edit" && activeChannelId;
      const res = await fetch(
        isEdit
          ? `/api/workspaces/${workspaceId}/channels/website/${activeChannelId}`
          : `/api/workspaces/${workspaceId}/channels/website`,
        {
          method: isEdit ? "PATCH" : "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(payload),
        },
      );
      const body = (await res.json().catch(() => null)) as {
        channel?: { id: string; externalAccountId?: string };
        error?: { message?: string };
      } | null;
      if (!res.ok || !body?.channel) {
        throw new Error(body?.error?.message ?? `Saving failed (${res.status})`);
      }
      router.refresh();
      if (isEdit) {
        setDialogOpen(false);
      } else {
        setActiveChannelId(body.channel.id);
        setCreated({
          token: body.channel.externalAccountId ?? "",
          color: form.widgetColor,
        });
        setMode("snippet");
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Saving failed");
    } finally {
      setBusy(false);
    }
  }

  async function copySnippet() {
    try {
      await navigator.clipboard.writeText(snippet);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 2000);
    } catch {
      setCopied(false);
    }
  }

  return (
    <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <span className="flex size-8 items-center justify-center rounded-lg bg-[#6366f1]/15 text-[#6366f1]">
              <Globe className="size-4" />
            </span>
            {mode === "create"
              ? "Add live chat to a website"
              : mode === "edit"
                ? "Website chat settings"
                : "Your embed code"}
          </DialogTitle>
          <DialogDescription>
            {mode === "snippet"
              ? "Paste this one line into your website, just before the closing </body> tag — on every page where the chat bubble should appear."
              : "Visitors chat without any account or login. Their messages land in this inbox like any other channel."}
          </DialogDescription>
        </DialogHeader>

        {mode === "snippet" ? (
          <div className="space-y-3">
            <pre className="overflow-x-auto rounded-lg bg-zinc-950 p-3 text-[11px] leading-relaxed break-all whitespace-pre-wrap text-zinc-100">
              {snippet}
            </pre>
            <div className="flex items-center gap-2">
              <Button onClick={() => void copySnippet()} className="gap-1.5">
                {copied ? <Check className="size-4" /> : <Copy className="size-4" />}
                {copied ? "Copied" : "Copy code"}
              </Button>
              {activeChannel ? (
                <Button
                  variant="outline"
                  onClick={() => {
                    setForm(formFromChannel(activeChannel));
                    setMode("edit");
                  }}
                >
                  Widget settings
                </Button>
              ) : null}
            </div>
            <p className="text-xs text-muted-foreground">
              The bubble color is part of the snippet — if you change it in settings, copy the code
              again. Everything else (welcome text, pre-chat form) updates on its own.
            </p>
          </div>
        ) : (
          <div className="space-y-3">
            <div className="space-y-1.5">
              <Label htmlFor="website-name">Website name</Label>
              <Input
                id="website-name"
                placeholder="e.g. Biolife Store"
                value={form.name}
                onChange={(e) => setForm({ ...form, name: e.target.value })}
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="website-url">Website address (optional)</Label>
              <Input
                id="website-url"
                placeholder="https://yourshop.com"
                value={form.websiteUrl}
                onChange={(e) => setForm({ ...form, websiteUrl: e.target.value })}
              />
            </div>
            <div className="space-y-1.5">
              <Label>Bubble color</Label>
              <div className="flex items-center gap-2">
                {COLOR_PRESETS.map((preset) => (
                  <button
                    key={preset}
                    type="button"
                    aria-label={`Color ${preset}`}
                    onClick={() => setForm({ ...form, widgetColor: preset })}
                    className={`size-7 rounded-full border-2 ${form.widgetColor === preset ? "border-zinc-900 dark:border-white" : "border-transparent"}`}
                    style={{ backgroundColor: preset }}
                  />
                ))}
                <Input
                  type="color"
                  value={form.widgetColor}
                  onChange={(e) => setForm({ ...form, widgetColor: e.target.value })}
                  className="h-9 w-14 cursor-pointer p-1"
                />
                <span className="text-xs text-muted-foreground">{form.widgetColor}</span>
              </div>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="website-welcome-title">Welcome heading</Label>
              <Input
                id="website-welcome-title"
                value={form.welcomeTitle}
                onChange={(e) => setForm({ ...form, welcomeTitle: e.target.value })}
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="website-welcome-tagline">Welcome line</Label>
              <Input
                id="website-welcome-tagline"
                value={form.welcomeTagline}
                onChange={(e) => setForm({ ...form, welcomeTagline: e.target.value })}
              />
            </div>
            <label className="flex cursor-pointer items-center gap-2 text-sm">
              <input
                type="checkbox"
                checked={form.preChatForm}
                onChange={(e) => setForm({ ...form, preChatForm: e.target.checked })}
                className="size-4 accent-indigo-600"
              />
              Ask for name &amp; email before the first chat
            </label>
            {error ? <p className="text-sm text-red-600">{error}</p> : null}
            <div className="flex justify-end gap-2 pt-1">
              <Button variant="outline" onClick={() => setDialogOpen(false)} disabled={busy}>
                Cancel
              </Button>
              <Button
                onClick={() => void submit()}
                disabled={busy || form.name.trim().length < 2}
              >
                {busy ? "Saving…" : mode === "edit" ? "Save settings" : "Create & get code"}
              </Button>
            </div>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
