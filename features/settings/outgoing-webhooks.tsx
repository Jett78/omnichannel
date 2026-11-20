"use client";

import { Check, Copy, Pencil, Plus, Send, Trash2, Webhook, X } from "lucide-react";
import { useState } from "react";

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
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { OUTGOING_WEBHOOK_EVENTS, OUTGOING_WEBHOOK_EVENT_LABELS } from "@/lib/webhook-events";
import type { OutgoingWebhookEvent } from "@/lib/webhook-events";
import type { OutgoingWebhookView } from "@/services/outgoing-webhook.service";

function relativeTime(iso: string): string {
  const seconds = Math.max(1, Math.floor((Date.now() - new Date(iso).getTime()) / 1000));
  if (seconds < 60) return `${seconds}s ago`;
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  return `${Math.floor(hours / 24)}d ago`;
}

interface FormState {
  name: string;
  url: string;
  events: OutgoingWebhookEvent[];
}

const EMPTY_FORM: FormState = { name: "", url: "", events: ["message.created"] };

export function OutgoingWebhooks({
  workspaceId,
  initialWebhooks,
}: {
  workspaceId: string;
  initialWebhooks: OutgoingWebhookView[];
}) {
  const [items, setItems] = useState<OutgoingWebhookView[]>(initialWebhooks);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [form, setForm] = useState<FormState>(EMPTY_FORM);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null);
  const [testNoteId, setTestNoteId] = useState<string | null>(null);
  const [copiedSecret, setCopiedSecret] = useState(false);

  const editing = editingId ? (items.find((item) => item.id === editingId) ?? null) : null;

  async function refreshList() {
    try {
      const response = await fetch(`/api/workspaces/${workspaceId}/webhooks`);
      if (response.ok) {
        const data = (await response.json()) as { items: OutgoingWebhookView[] };
        setItems(data.items);
      }
    } catch {
      // Keep the current list on a refresh hiccup.
    }
  }

  function openCreate() {
    setEditingId(null);
    setForm(EMPTY_FORM);
    setError(null);
    setCopiedSecret(false);
    setDialogOpen(true);
  }

  function openEdit(item: OutgoingWebhookView) {
    setEditingId(item.id);
    setForm({
      name: item.name,
      url: item.url,
      events: item.events.filter((event): event is OutgoingWebhookEvent =>
        (OUTGOING_WEBHOOK_EVENTS as readonly string[]).includes(event),
      ),
    });
    setError(null);
    setCopiedSecret(false);
    setDialogOpen(true);
  }

  function toggleEvent(event: OutgoingWebhookEvent) {
    setForm((current) => ({
      ...current,
      events: current.events.includes(event)
        ? current.events.filter((entry) => entry !== event)
        : [...current.events, event],
    }));
  }

  async function submit() {
    setBusy(true);
    setError(null);
    try {
      const response = await fetch(
        editingId
          ? `/api/workspaces/${workspaceId}/webhooks/${editingId}`
          : `/api/workspaces/${workspaceId}/webhooks`,
        {
          method: editingId ? "PATCH" : "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(form),
        },
      );
      const data = (await response.json()) as { item?: OutgoingWebhookView; error?: string };
      if (!response.ok || !data.item) {
        throw new Error(data.error ?? "Something went wrong");
      }
      setItems((current) =>
        editingId
          ? current.map((item) => (item.id === editingId ? (data.item as OutgoingWebhookView) : item))
          : [...current, data.item as OutgoingWebhookView],
      );
      setDialogOpen(false);
    } catch (submitError) {
      setError(submitError instanceof Error ? submitError.message : "Something went wrong");
    } finally {
      setBusy(false);
    }
  }

  async function toggleEnabled(item: OutgoingWebhookView) {
    try {
      const response = await fetch(`/api/workspaces/${workspaceId}/webhooks/${item.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ enabled: !item.enabled }),
      });
      const data = (await response.json()) as { item?: OutgoingWebhookView };
      if (response.ok && data.item) {
        setItems((current) => current.map((entry) => (entry.id === item.id ? (data.item as OutgoingWebhookView) : entry)));
      }
    } catch {
      // Leave the switch as-is on failure.
    }
  }

  async function remove(item: OutgoingWebhookView) {
    try {
      const response = await fetch(`/api/workspaces/${workspaceId}/webhooks/${item.id}`, {
        method: "DELETE",
      });
      if (response.ok) {
        setItems((current) => current.filter((entry) => entry.id !== item.id));
        setConfirmDeleteId(null);
      }
    } catch {
      // Keep the row on failure.
    }
  }

  async function sendTest(item: OutgoingWebhookView) {
    setTestNoteId(null);
    try {
      const response = await fetch(`/api/workspaces/${workspaceId}/webhooks/${item.id}/test`, {
        method: "POST",
      });
      if (response.ok) {
        setTestNoteId(item.id);
        window.setTimeout(() => void refreshList(), 4000);
      }
    } catch {
      // No note on failure.
    }
  }

  return (
    <Card>
      <CardHeader>
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <CardTitle className="flex items-center gap-2">
              <Webhook className="size-4" /> Outgoing webhooks
            </CardTitle>
            <CardDescription>
              Send conversation and message events to your own systems — Zapier, Make, a CRM or a
              custom endpoint. Deliveries are signed so the receiver can verify they came from
              here. Private notes are never sent.
            </CardDescription>
          </div>
          <Button size="sm" onClick={openCreate}>
            <Plus className="size-4" /> Add webhook
          </Button>
        </div>
      </CardHeader>
      <CardContent className="flex flex-col gap-3">
        {items.length === 0 ? (
          <p className="text-muted-foreground text-sm">
            No webhooks yet. Add one to get notified the moment a customer writes in or a
            conversation changes.
          </p>
        ) : (
          items.map((item) => (
            <div key={item.id} className="rounded-xl border p-3">
              <div className="flex flex-wrap items-center gap-2">
                <p className="font-medium">{item.name}</p>
                <Switch
                  checked={item.enabled}
                  onCheckedChange={() => void toggleEnabled(item)}
                  aria-label={item.enabled ? "Disable webhook" : "Enable webhook"}
                />
                <span className="text-muted-foreground text-xs">
                  {item.enabled ? "On" : "Off"}
                </span>
                <div className="ml-auto flex items-center gap-1">
                  <Button variant="ghost" size="sm" onClick={() => void sendTest(item)}>
                    <Send className="size-3.5" /> Test
                  </Button>
                  <Button variant="ghost" size="sm" onClick={() => openEdit(item)}>
                    <Pencil className="size-3.5" /> Edit
                  </Button>
                  {confirmDeleteId === item.id ? (
                    <>
                      <Button variant="destructive" size="sm" onClick={() => void remove(item)}>
                        Confirm delete
                      </Button>
                      <Button variant="ghost" size="sm" onClick={() => setConfirmDeleteId(null)}>
                        Keep
                      </Button>
                    </>
                  ) : (
                    <Button variant="ghost" size="sm" onClick={() => setConfirmDeleteId(item.id)}>
                      <Trash2 className="size-3.5" />
                    </Button>
                  )}
                </div>
              </div>
              <p className="text-muted-foreground mt-1 truncate font-mono text-xs">{item.url}</p>
              <div className="mt-2 flex flex-wrap gap-1">
                {item.events.map((event) => (
                  <Badge key={event} variant="secondary" className="font-mono text-[11px]">
                    {event}
                  </Badge>
                ))}
              </div>
              <p className="text-muted-foreground mt-2 text-xs">
                {testNoteId === item.id
                  ? "Test ping sent — the result will show here in a few seconds."
                  : item.lastDelivery
                    ? item.lastDelivery.success
                      ? `✓ Last delivery: ${item.lastDelivery.event} · HTTP ${item.lastDelivery.statusCode ?? "—"} · ${relativeTime(item.lastDelivery.createdAt)}`
                      : `✗ Last delivery failed: ${item.lastDelivery.event} · ${item.lastDelivery.error ?? "unknown error"} · ${relativeTime(item.lastDelivery.createdAt)}`
                    : "No deliveries yet."}
              </p>
            </div>
          ))
        )}
      </CardContent>

      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{editingId ? "Edit webhook" : "Add webhook"}</DialogTitle>
            <DialogDescription>
              Events are POSTed to this URL as JSON within seconds. The URL must be a public
              address (HTTPS in production).
            </DialogDescription>
          </DialogHeader>
          <div className="flex flex-col gap-4">
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="webhook-name">Name</Label>
              <Input
                id="webhook-name"
                value={form.name}
                onChange={(event) => setForm((current) => ({ ...current, name: event.target.value }))}
                placeholder="Zapier — new leads"
              />
            </div>
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="webhook-url">URL</Label>
              <Input
                id="webhook-url"
                value={form.url}
                onChange={(event) => setForm((current) => ({ ...current, url: event.target.value }))}
                placeholder="https://hooks.zapier.com/hooks/catch/…"
              />
            </div>
            <div className="flex flex-col gap-1.5">
              <Label>Events</Label>
              <div className="flex flex-col gap-2">
                {OUTGOING_WEBHOOK_EVENTS.map((event) => (
                  <label key={event} className="flex cursor-pointer items-center gap-2 text-sm">
                    <input
                      type="checkbox"
                      className="size-4 accent-indigo-600"
                      checked={form.events.includes(event)}
                      onChange={() => toggleEvent(event)}
                    />
                    <span className="font-mono text-xs">{event}</span>
                    <span className="text-muted-foreground text-xs">
                      — {OUTGOING_WEBHOOK_EVENT_LABELS[event]}
                    </span>
                  </label>
                ))}
              </div>
            </div>
            {editing ? (
              <div className="flex flex-col gap-1.5">
                <Label>Signing secret</Label>
                <div className="flex items-center gap-2">
                  <code className="bg-muted min-w-0 flex-1 truncate rounded-md px-2 py-1.5 font-mono text-xs">
                    {editing.secret}
                  </code>
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => {
                      void navigator.clipboard.writeText(editing.secret);
                      setCopiedSecret(true);
                    }}
                  >
                    {copiedSecret ? <Check className="size-3.5" /> : <Copy className="size-3.5" />}
                    {copiedSecret ? "Copied" : "Copy"}
                  </Button>
                </div>
                <p className="text-muted-foreground text-xs">
                  Deliveries carry an <code className="font-mono">x-uoi-signature</code> header —
                  HMAC-SHA256 of the raw body with this secret — so your receiver can verify them.
                </p>
              </div>
            ) : null}
            {error ? (
              <p className="flex items-center gap-1.5 text-sm text-red-600 dark:text-red-400">
                <X className="size-4" /> {error}
              </p>
            ) : null}
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDialogOpen(false)}>
              Cancel
            </Button>
            <Button
              onClick={() => void submit()}
              disabled={busy || form.name.trim().length < 2 || !form.url.trim() || form.events.length === 0}
            >
              {busy ? "Saving…" : editingId ? "Save changes" : "Add webhook"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </Card>
  );
}
