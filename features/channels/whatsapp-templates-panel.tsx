"use client";

import { FilePlus2, RefreshCw, Trash2 } from "lucide-react";
import { useCallback, useEffect, useMemo, useState } from "react";

import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Spinner } from "@/components/ui/spinner";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import type { RealChannel } from "@/features/channels/channels-catalog";
import type { WhatsAppTemplateAdminView } from "@/services/whatsapp-connection.service";

const LANGUAGE_SUGGESTIONS = [
  "en_US",
  "en",
  "en_GB",
  "hi",
  "bn",
  "ne",
  "ur",
  "ta",
  "te",
  "mr",
  "gu",
  "pa",
  "es",
  "ar",
  "id",
  "pt_BR",
  "fr",
  "de",
];

function placeholders(text: string): number[] {
  const found = new Set<number>();
  for (const match of text.matchAll(/\{\{\s*(\d+)\s*\}\}/g)) found.add(Number(match[1]));
  return [...found].sort((a, b) => a - b);
}

function statusVariant(status: string): "success" | "warning" | "destructive" | "muted" {
  if (status === "APPROVED") return "success";
  if (status === "PENDING") return "warning";
  if (status === "REJECTED" || status === "DISABLED" || status === "PAUSED") return "destructive";
  return "muted";
}

interface TemplateForm {
  name: string;
  language: string;
  category: "UTILITY" | "MARKETING";
  headerText: string;
  headerExample: string;
  bodyText: string;
  bodyExamples: string[];
  footerText: string;
}

const EMPTY_FORM: TemplateForm = {
  name: "",
  language: "en_US",
  category: "UTILITY",
  headerText: "",
  headerExample: "",
  bodyText: "",
  bodyExamples: [],
  footerText: "",
};

/**
 * WhatsApp message templates manager (Phase 14) — Channels page.
 * Lists every template on the connected WABA with its Meta review
 * status, creates new ones (Meta reviews each; they come back
 * PENDING) and deletes them. Sending lives in the inbox composer,
 * which only ever offers APPROVED templates.
 */
export function WhatsAppTemplatesPanel({
  workspaceId,
  connectedChannels,
}: {
  workspaceId: string;
  connectedChannels: RealChannel[];
}) {
  const whatsappChannels = useMemo(
    () =>
      connectedChannels.filter(
        (channel) => channel.provider === "WHATSAPP" && channel.status === "CONNECTED",
      ),
    [connectedChannels],
  );
  const [channelId, setChannelId] = useState<string>(whatsappChannels[0]?.id ?? "");
  const [templates, setTemplates] = useState<WhatsAppTemplateAdminView[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [createOpen, setCreateOpen] = useState(false);
  const [form, setForm] = useState<TemplateForm>(EMPTY_FORM);
  const [creating, setCreating] = useState(false);
  const [deleteTarget, setDeleteTarget] = useState<WhatsAppTemplateAdminView | null>(null);
  const [deleting, setDeleting] = useState(false);

  const activeChannelId = whatsappChannels.some((channel) => channel.id === channelId)
    ? channelId
    : (whatsappChannels[0]?.id ?? "");

  const load = useCallback(async () => {
    if (!activeChannelId) return;
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(
        `/api/workspaces/${workspaceId}/channels/${activeChannelId}/templates?view=manage`,
      );
      const body = (await res.json().catch(() => null)) as {
        templates?: WhatsAppTemplateAdminView[];
        error?: { message?: string };
      } | null;
      if (!res.ok || !body?.templates) {
        throw new Error(body?.error?.message ?? `Could not load templates (${res.status})`);
      }
      setTemplates(body.templates);
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : "Could not load templates");
    } finally {
      setLoading(false);
    }
  }, [workspaceId, activeChannelId]);

  useEffect(() => {
    // load() only setStates around an async fetch (initial sync from Meta).
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void load();
  }, [load]);

  if (whatsappChannels.length === 0) return null;

  const bodyVars = placeholders(form.bodyText);
  const headerVars = placeholders(form.headerText);

  function setBodyText(value: string) {
    setForm((prev) => {
      const vars = placeholders(value);
      return {
        ...prev,
        bodyText: value,
        bodyExamples: vars.map((_, index) => prev.bodyExamples[index] ?? ""),
      };
    });
  }

  async function onCreate() {
    setCreating(true);
    setError(null);
    try {
      const res = await fetch(
        `/api/workspaces/${workspaceId}/channels/${activeChannelId}/templates`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            name: form.name.trim(),
            language: form.language.trim(),
            category: form.category,
            bodyText: form.bodyText,
            bodyExamples: form.bodyExamples.map((value) => value.trim()).filter(Boolean),
            ...(form.headerText.trim() ? { headerText: form.headerText.trim() } : {}),
            ...(form.headerExample.trim() ? { headerExample: form.headerExample.trim() } : {}),
            ...(form.footerText.trim() ? { footerText: form.footerText.trim() } : {}),
          }),
        },
      );
      const body = (await res.json().catch(() => null)) as {
        template?: { status?: string };
        error?: { message?: string };
      } | null;
      if (!res.ok) {
        throw new Error(body?.error?.message ?? `Meta rejected the template (${res.status})`);
      }
      setCreateOpen(false);
      setForm(EMPTY_FORM);
      setNotice(
        `"${form.name.trim()}" was submitted to Meta for review (status: ${body?.template?.status ?? "PENDING"}). It can be sent from the inbox once Meta approves it.`,
      );
      await load();
    } catch (createError) {
      setError(createError instanceof Error ? createError.message : "Could not create the template");
    } finally {
      setCreating(false);
    }
  }

  async function onDelete() {
    if (!deleteTarget) return;
    setDeleting(true);
    setError(null);
    try {
      const res = await fetch(
        `/api/workspaces/${workspaceId}/channels/${activeChannelId}/templates?name=${encodeURIComponent(deleteTarget.name)}`,
        { method: "DELETE" },
      );
      const body = (await res.json().catch(() => null)) as {
        error?: { message?: string };
      } | null;
      if (!res.ok) {
        throw new Error(body?.error?.message ?? `Could not delete the template (${res.status})`);
      }
      setNotice(`"${deleteTarget.name}" was deleted from the WABA (all languages).`);
      setDeleteTarget(null);
      await load();
    } catch (deleteError) {
      setError(deleteError instanceof Error ? deleteError.message : "Could not delete the template");
    } finally {
      setDeleting(false);
    }
  }

  return (
    <Card>
      <CardHeader>
        <div className="flex flex-wrap items-start gap-3">
          <div className="min-w-0 flex-1">
            <CardTitle>WhatsApp message templates</CardTitle>
            <CardDescription>
              Templates are how you message a customer after WhatsApp&apos;s 24-hour window
              closes — or start a new conversation. Meta reviews every new template; approved
              ones appear in the inbox composer automatically.
            </CardDescription>
          </div>
          <div className="flex items-center gap-2">
            <Button variant="outline" size="sm" onClick={() => void load()} disabled={loading}>
              <RefreshCw className={`size-4 ${loading ? "animate-spin" : ""}`} />
              Refresh
            </Button>
            <Button size="sm" onClick={() => setCreateOpen(true)}>
              <FilePlus2 className="size-4" />
              New template
            </Button>
          </div>
        </div>
        {whatsappChannels.length > 1 ? (
          <div className="pt-2">
            <Select value={activeChannelId} onValueChange={setChannelId}>
              <SelectTrigger className="w-full min-[480px]:w-72" aria-label="WhatsApp channel">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {whatsappChannels.map((channel) => (
                  <SelectItem key={channel.id} value={channel.id}>
                    {channel.displayName}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        ) : null}
      </CardHeader>
      <CardContent className="flex flex-col gap-3">
        {error ? (
          <p className="text-destructive text-sm" role="alert">
            {error}
          </p>
        ) : null}
        {notice ? (
          <p className="text-sm" role="status">
            {notice}
          </p>
        ) : null}
        {loading && templates.length === 0 ? (
          <div className="flex justify-center py-6">
            <Spinner />
          </div>
        ) : templates.length === 0 ? (
          <p className="text-muted-foreground text-sm">
            No templates on this WhatsApp account yet. Create the first one — order updates and
            delivery notices are usually Utility templates.
          </p>
        ) : (
          <ul className="flex flex-col divide-y">
            {templates.map((template) => (
              <li
                key={`${template.name}|${template.language}`}
                className="flex flex-wrap items-start gap-3 py-3"
              >
                <div className="min-w-0 flex-1">
                  <p className="flex flex-wrap items-center gap-2">
                    <span className="font-mono text-sm font-medium">{template.name}</span>
                    <Badge variant={statusVariant(template.status)}>{template.status}</Badge>
                    <Badge variant="outline">{template.category}</Badge>
                    <span className="text-muted-foreground text-xs">{template.language}</span>
                    {template.paramsCount > 0 ? (
                      <span className="text-muted-foreground text-xs">
                        {template.paramsCount} variable{template.paramsCount === 1 ? "" : "s"}
                      </span>
                    ) : null}
                  </p>
                  {template.bodyText ? (
                    <p className="text-muted-foreground line-clamp-2 pt-1 text-sm">
                      {template.bodyText}
                    </p>
                  ) : null}
                </div>
                <Button
                  variant="ghost"
                  size="icon"
                  className="size-8"
                  aria-label={`Delete template ${template.name}`}
                  title="Delete template"
                  onClick={() => setDeleteTarget(template)}
                >
                  <Trash2 className="size-4" />
                </Button>
              </li>
            ))}
          </ul>
        )}
      </CardContent>

      <Dialog open={createOpen} onOpenChange={setCreateOpen}>
        <DialogContent className="max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>New WhatsApp template</DialogTitle>
            <DialogDescription>
              Meta reviews every template before it can be sent — most are decided within a
              day. Names are permanent and shared across languages.
            </DialogDescription>
          </DialogHeader>
          <div className="flex flex-col gap-4">
            <div className="grid gap-4 min-[560px]:grid-cols-2">
              <div className="flex flex-col gap-2">
                <Label htmlFor="tpl-name">Name</Label>
                <Input
                  id="tpl-name"
                  placeholder="order_shipped"
                  value={form.name}
                  onChange={(event) =>
                    setForm((prev) => ({
                      ...prev,
                      name: event.target.value.toLowerCase().replace(/[^a-z0-9_]/g, "_"),
                    }))
                  }
                />
                <p className="text-muted-foreground text-xs">
                  Lowercase letters, numbers and underscores only.
                </p>
              </div>
              <div className="flex flex-col gap-2">
                <Label htmlFor="tpl-language">Language code</Label>
                <Input
                  id="tpl-language"
                  list="tpl-languages"
                  value={form.language}
                  onChange={(event) =>
                    setForm((prev) => ({ ...prev, language: event.target.value }))
                  }
                />
                <datalist id="tpl-languages">
                  {LANGUAGE_SUGGESTIONS.map((code) => (
                    <option key={code} value={code} />
                  ))}
                </datalist>
              </div>
            </div>
            <div className="flex flex-col gap-2">
              <Label htmlFor="tpl-category">Category</Label>
              <Select
                value={form.category}
                onValueChange={(value) =>
                  setForm((prev) => ({ ...prev, category: value as TemplateForm["category"] }))
                }
              >
                <SelectTrigger id="tpl-category">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="UTILITY">
                    Utility — order updates, reminders, account notices
                  </SelectItem>
                  <SelectItem value="MARKETING">Marketing — offers and promotions</SelectItem>
                </SelectContent>
              </Select>
              <p className="text-muted-foreground text-xs">
                Authentication (OTP) templates follow stricter Meta rules and can&apos;t be
                created here yet.
              </p>
            </div>
            <div className="flex flex-col gap-2">
              <Label htmlFor="tpl-header">Header (optional)</Label>
              <Input
                id="tpl-header"
                placeholder="Your order has shipped"
                maxLength={60}
                value={form.headerText}
                onChange={(event) =>
                  setForm((prev) => ({ ...prev, headerText: event.target.value }))
                }
              />
              {headerVars.length > 0 ? (
                <Input
                  aria-label="Example value for the header variable"
                  placeholder="Example for {{1}} in the header"
                  value={form.headerExample}
                  onChange={(event) =>
                    setForm((prev) => ({ ...prev, headerExample: event.target.value }))
                  }
                />
              ) : null}
            </div>
            <div className="flex flex-col gap-2">
              <Label htmlFor="tpl-body">Body</Label>
              <Textarea
                id="tpl-body"
                rows={5}
                className="text-sm leading-relaxed"
                placeholder={"Hi {{1}}, your order {{2}} is on its way."}
                value={form.bodyText}
                onChange={(event) => setBodyText(event.target.value)}
              />
              <p className="text-muted-foreground text-xs">
                Use {"{{1}}"}, {"{{2}}"}… for the parts the agent fills in when sending. Meta
                needs one example value per variable to review the template.
              </p>
            </div>
            {bodyVars.map((variable, index) => (
              <div key={variable} className="flex flex-col gap-2">
                <Label htmlFor={`tpl-example-${variable}`}>
                  Example for {"{{"}
                  {variable}
                  {"}}"}
                </Label>
                <Input
                  id={`tpl-example-${variable}`}
                  value={form.bodyExamples[index] ?? ""}
                  onChange={(event) =>
                    setForm((prev) => {
                      const next = [...prev.bodyExamples];
                      next[index] = event.target.value;
                      return { ...prev, bodyExamples: next };
                    })
                  }
                />
              </div>
            ))}
            <div className="flex flex-col gap-2">
              <Label htmlFor="tpl-footer">Footer (optional)</Label>
              <Input
                id="tpl-footer"
                placeholder="Reply STOP to opt out"
                maxLength={60}
                value={form.footerText}
                onChange={(event) =>
                  setForm((prev) => ({ ...prev, footerText: event.target.value }))
                }
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setCreateOpen(false)}>
              Cancel
            </Button>
            <Button
              onClick={() => void onCreate()}
              disabled={
                creating ||
                !form.name ||
                !form.bodyText.trim() ||
                bodyVars.some((_, index) => !(form.bodyExamples[index] ?? "").trim()) ||
                (headerVars.length > 0 && !form.headerExample.trim())
              }
            >
              {creating ? "Submitting…" : "Submit for Meta review"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <AlertDialog
        open={deleteTarget !== null}
        onOpenChange={(open) => !open && setDeleteTarget(null)}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete this template?</AlertDialogTitle>
            <AlertDialogDescription>
              “{deleteTarget?.name}” will be deleted from your WhatsApp account in every
              language. Agents will no longer be able to send it, and the name can&apos;t be
              reused for 30 days.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={() => void onDelete()} disabled={deleting}>
              {deleting ? "Deleting…" : "Delete template"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </Card>
  );
}
