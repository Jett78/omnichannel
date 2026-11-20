"use client";

import {
  ArrowDown,
  ArrowUp,
  CheckCircle2,
  Filter,
  Pencil,
  Play,
  Plus,
  Trash2,
  XCircle,
  Zap,
} from "lucide-react";
import { useState } from "react";

import { PageHeader } from "@/components/layout/page-header";
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
import {
  Dialog,
  DialogContent,
  DialogDescription,
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
import { Switch } from "@/components/ui/switch";
import { PROVIDER_META } from "@/components/channel-icon";
import type { Provider } from "@/generated/prisma/client";

// ─── Types (mirror the Phase-13B API) ───────────────────────────────

export interface AutomationRuleView {
  id: string;
  name: string;
  enabled: boolean;
  trigger: string;
  conditions: {
    providers?: string[];
    tagIds?: string[];
    unassignedOnly?: boolean;
    firstMessageOnly?: boolean;
  } | null;
  actions: Array<Record<string, unknown>>;
  createdById: string;
  createdAt: string;
  updatedAt: string;
}

export interface AutomationRunView {
  id: string;
  ruleId: string;
  ruleName: string;
  conversationId: string;
  trigger: string;
  results: Array<{ type: string; ok: boolean; detail: string }>;
  createdAt: string;
}

interface MemberOption {
  userId: string;
  name: string;
  email: string;
  role: string;
  teamId: string | null;
  isAvailable: boolean;
}

interface ActionDraft {
  type: string;
  strategy: string;
  userId: string;
  teamId: string;
  name: string;
  cannedResponseId: string;
  message: string;
  userIds: string[];
  status: string;
  priority: string;
}

const TRIGGERS = [
  { value: "conversation.created", label: "New conversation", hint: "A customer starts a new conversation" },
  { value: "message.created", label: "New message", hint: "A customer sends a message" },
  { value: "conversation.assigned", label: "Conversation assigned", hint: "An agent is assigned" },
  { value: "conversation.resolved", label: "Conversation resolved", hint: "A conversation is marked resolved" },
  { value: "tag.added", label: "Tag added", hint: "A tag is added to a conversation" },
] as const;

const ACTION_TYPES = [
  { value: "assign", label: "Assign conversation" },
  { value: "add_tag", label: "Add tag" },
  { value: "send_canned", label: "Send saved reply" },
  { value: "notify", label: "Notify team" },
  { value: "set_status", label: "Set status" },
  { value: "set_priority", label: "Set priority" },
] as const;

const PROVIDER_OPTIONS = (Object.keys(PROVIDER_META) as Provider[]).map((provider) => ({
  value: provider.toLowerCase(),
  label: PROVIDER_META[provider].shortLabel,
}));

function emptyDraft(): ActionDraft {
  return {
    type: "assign",
    strategy: "round_robin",
    userId: "",
    teamId: "",
    name: "",
    cannedResponseId: "",
    message: "",
    userIds: [],
    status: "RESOLVED",
    priority: "HIGH",
  };
}

function draftFromAction(action: Record<string, unknown>): ActionDraft {
  const draft = emptyDraft();
  draft.type = String(action.type ?? "assign");
  if (typeof action.strategy === "string") draft.strategy = action.strategy;
  if (typeof action.userId === "string") draft.userId = action.userId;
  if (typeof action.teamId === "string") draft.teamId = action.teamId;
  if (typeof action.name === "string") draft.name = action.name;
  if (typeof action.cannedResponseId === "string") draft.cannedResponseId = action.cannedResponseId;
  if (typeof action.message === "string") draft.message = action.message;
  if (Array.isArray(action.userIds)) draft.userIds = action.userIds.map(String);
  if (typeof action.status === "string") draft.status = action.status;
  if (typeof action.priority === "string") draft.priority = action.priority;
  return draft;
}

function draftComplete(draft: ActionDraft): boolean {
  switch (draft.type) {
    case "assign":
      return draft.strategy !== "specific" || draft.userId !== "";
    case "add_tag":
      return draft.name.trim() !== "";
    case "send_canned":
      return draft.cannedResponseId !== "";
    case "notify":
      return draft.message.trim() !== "";
    default:
      return true;
  }
}

function toApiAction(draft: ActionDraft): Record<string, unknown> {
  switch (draft.type) {
    case "assign":
      return {
        type: "assign",
        strategy: draft.strategy,
        ...(draft.strategy === "specific" ? { userId: draft.userId } : {}),
        ...(draft.teamId ? { teamId: draft.teamId } : {}),
      };
    case "add_tag":
      return { type: "add_tag", name: draft.name.trim() };
    case "send_canned":
      return { type: "send_canned", cannedResponseId: draft.cannedResponseId };
    case "notify":
      return {
        type: "notify",
        message: draft.message.trim(),
        ...(draft.userIds.length ? { userIds: draft.userIds } : {}),
      };
    case "set_status":
      return { type: "set_status", status: draft.status };
    case "set_priority":
      return { type: "set_priority", priority: draft.priority };
    default:
      return { type: draft.type };
  }
}

function triggerLabel(value: string): string {
  return TRIGGERS.find((t) => t.value === value)?.label ?? value;
}

function relativeTime(iso: string): string {
  const seconds = Math.max(1, Math.floor((Date.now() - new Date(iso).getTime()) / 1000));
  if (seconds < 60) return "just now";
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  return `${Math.floor(hours / 24)}d ago`;
}

// ─── Component ──────────────────────────────────────────────────────

interface AutomationRulesProps {
  workspaceId: string;
  initialRules: AutomationRuleView[];
  initialRuns: AutomationRunView[];
  members: MemberOption[];
  teams: Array<{ id: string; name: string }>;
  tags: Array<{ id: string; name: string; color: string | null }>;
  canned: Array<{ id: string; title: string; category: string | null }>;
  me: { userId: string; role: string; isAvailable: boolean };
  canManage: boolean;
}

export function AutomationRules({
  workspaceId,
  initialRules,
  initialRuns,
  members,
  teams,
  tags,
  canned,
  me,
  canManage,
}: AutomationRulesProps) {
  const [rules, setRules] = useState(initialRules);
  const [runs, setRuns] = useState(initialRuns);
  const [notice, setNotice] = useState<string | null>(null);
  const [myAvailable, setMyAvailable] = useState(me.isAvailable);
  const [builderOpen, setBuilderOpen] = useState(false);
  const [deleteTarget, setDeleteTarget] = useState<AutomationRuleView | null>(null);
  const [deleting, setDeleting] = useState(false);

  // Builder form state.
  const [editingId, setEditingId] = useState<string | null>(null);
  const [ruleName, setRuleName] = useState("");
  const [trigger, setTrigger] = useState<string>("conversation.created");
  const [condProviders, setCondProviders] = useState<string[]>([]);
  const [condTagIds, setCondTagIds] = useState<string[]>([]);
  const [condUnassignedOnly, setCondUnassignedOnly] = useState(false);
  const [condFirstMessageOnly, setCondFirstMessageOnly] = useState(false);
  const [drafts, setDrafts] = useState<ActionDraft[]>([emptyDraft()]);
  const [saving, setSaving] = useState(false);

  const apiBase = `/api/workspaces/${workspaceId}`;
  const memberName = (userId: string) =>
    members.find((m) => m.userId === userId)?.name ?? "a member";
  const assignableMembers = members.filter((m) => m.role !== "VIEWER");

  async function refresh() {
    const rulesRes = await fetch(`${apiBase}/automations`).catch(() => null);
    if (rulesRes?.ok) {
      const body = (await rulesRes.json()) as { items: AutomationRuleView[] };
      setRules(body.items);
    }
    if (canManage) {
      const runsRes = await fetch(`${apiBase}/automations/runs?limit=20`).catch(() => null);
      if (runsRes?.ok) {
        const body = (await runsRes.json()) as { items: AutomationRunView[] };
        setRuns(body.items);
      }
    }
  }

  async function toggleEnabled(rule: AutomationRuleView) {
    const res = await fetch(`${apiBase}/automations/${rule.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ enabled: !rule.enabled }),
    }).catch(() => null);
    if (res?.ok) {
      setRules((prev) =>
        prev.map((r) => (r.id === rule.id ? { ...r, enabled: !r.enabled } : r)),
      );
    } else {
      setNotice("Could not update that rule.");
    }
  }

  async function toggleAvailability(next: boolean) {
    setMyAvailable(next);
    const res = await fetch(`${apiBase}/members/availability`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ isAvailable: next }),
    }).catch(() => null);
    if (!res?.ok) {
      setMyAvailable(!next);
      setNotice("Could not update your availability.");
    }
  }

  function openBuilder(rule?: AutomationRuleView) {
    if (rule) {
      setEditingId(rule.id);
      setRuleName(rule.name);
      setTrigger(rule.trigger);
      setCondProviders(rule.conditions?.providers ?? []);
      setCondTagIds(rule.conditions?.tagIds ?? []);
      setCondUnassignedOnly(rule.conditions?.unassignedOnly ?? false);
      setCondFirstMessageOnly(rule.conditions?.firstMessageOnly ?? false);
      setDrafts(rule.actions.length ? rule.actions.map(draftFromAction) : [emptyDraft()]);
    } else {
      setEditingId(null);
      setRuleName("");
      setTrigger("conversation.created");
      setCondProviders([]);
      setCondTagIds([]);
      setCondUnassignedOnly(false);
      setCondFirstMessageOnly(false);
      setDrafts([emptyDraft()]);
    }
    setBuilderOpen(true);
  }

  const formValid =
    ruleName.trim() !== "" && drafts.length > 0 && drafts.every(draftComplete);

  async function saveRule() {
    if (!formValid || saving) return;
    setSaving(true);
    const conditions: Record<string, unknown> = {};
    if (condProviders.length) conditions.providers = condProviders;
    if (condTagIds.length) conditions.tagIds = condTagIds;
    if (condUnassignedOnly) conditions.unassignedOnly = true;
    if (condFirstMessageOnly && trigger === "message.created") conditions.firstMessageOnly = true;
    const hasConditions = Object.keys(conditions).length > 0;
    const payload = {
      name: ruleName.trim(),
      trigger,
      // Create: omit empty conditions. Edit: null clears them.
      ...(hasConditions
        ? { conditions }
        : editingId
          ? { conditions: null }
          : {}),
      actions: drafts.map(toApiAction),
    };
    const res = editingId
      ? await fetch(`${apiBase}/automations/${editingId}`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(payload),
        }).catch(() => null)
      : await fetch(`${apiBase}/automations`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(payload),
        }).catch(() => null);
    setSaving(false);
    if (res?.ok) {
      setBuilderOpen(false);
      void refresh();
    } else {
      setNotice("Could not save that rule. Check the fields and try again.");
    }
  }

  async function confirmDelete() {
    if (!deleteTarget || deleting) return;
    setDeleting(true);
    const res = await fetch(`${apiBase}/automations/${deleteTarget.id}`, {
      method: "DELETE",
    }).catch(() => null);
    setDeleting(false);
    setDeleteTarget(null);
    if (res?.ok) {
      setRules((prev) => prev.filter((r) => r.id !== deleteTarget.id));
    } else {
      setNotice("Could not delete that rule.");
    }
  }

  function actionSummary(action: Record<string, unknown>): string {
    switch (action.type) {
      case "assign":
        if (action.strategy === "specific") {
          return `Assign to ${typeof action.userId === "string" ? memberName(action.userId) : "a member"}`;
        }
        return action.strategy === "least_busy"
          ? "Assign to least-busy agent"
          : "Assign round-robin";
      case "add_tag":
        return `Add tag “${String(action.name ?? "")}”`;
      case "send_canned": {
        const item = canned.find((c) => c.id === action.cannedResponseId);
        return `Send saved reply “${item?.title ?? "…"}”`;
      }
      case "notify":
        return "Notify team";
      case "set_status":
        return action.status === "RESOLVED" ? "Resolve conversation" : "Reopen conversation";
      case "set_priority":
        return `Set priority ${String(action.priority ?? "")}`;
      default:
        return String(action.type ?? "Action");
    }
  }

  function conditionsSummary(rule: AutomationRuleView): string | null {
    const parts: string[] = [];
    const conditions = rule.conditions;
    if (!conditions) return null;
    if (conditions.providers?.length) {
      parts.push(
        conditions.providers
          .map((p) => PROVIDER_OPTIONS.find((o) => o.value === p)?.label ?? p)
          .join(", "),
      );
    }
    if (conditions.tagIds?.length) {
      parts.push(
        `tag: ${conditions.tagIds
          .map((id) => tags.find((t) => t.id === id)?.name ?? "…")
          .join(", ")}`,
      );
    }
    if (conditions.unassignedOnly) parts.push("only when unassigned");
    if (conditions.firstMessageOnly) parts.push("first message only");
    return parts.length ? parts.join(" · ") : null;
  }

  function updateDraft(index: number, patch: Partial<ActionDraft>) {
    setDrafts((prev) => prev.map((d, i) => (i === index ? { ...d, ...patch } : d)));
  }

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title="Automation"
        description="Rules that greet, route and escalate conversations automatically. Actions run as the rule's creator, so channel messaging windows still apply."
        actions={
          canManage ? (
            <Button onClick={() => openBuilder()}>
              <Plus className="size-4" /> New rule
            </Button>
          ) : undefined
        }
      />

      {notice ? (
        <p className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700 dark:border-red-500/30 dark:bg-red-500/10 dark:text-red-300">
          {notice}
        </p>
      ) : null}

      <Card>
        <CardContent className="flex flex-wrap items-center gap-3 py-4">
          <div className="min-w-0 flex-1">
            <p className="text-sm font-medium">My availability for auto-assignment</p>
            <p className="text-muted-foreground text-xs">
              When off, round-robin and least-busy rules skip you.
            </p>
          </div>
          <Switch
            checked={myAvailable}
            onCheckedChange={(value) => void toggleAvailability(value)}
            aria-label="My availability for auto-assignment"
          />
          <span className="text-sm font-medium">{myAvailable ? "Available" : "Away"}</span>
        </CardContent>
      </Card>

      {rules.length === 0 ? (
        <Card>
          <CardContent className="flex flex-col items-center gap-2 py-10 text-center">
            <Zap className="text-muted-foreground size-8" />
            <p className="text-sm font-medium">No automation rules yet</p>
            <p className="text-muted-foreground max-w-sm text-sm">
              Create your first rule — for example, round-robin assignment for new
              conversations, or an automatic greeting from your saved replies.
            </p>
            {canManage ? (
              <Button className="mt-2" onClick={() => openBuilder()}>
                <Plus className="size-4" /> New rule
              </Button>
            ) : null}
          </CardContent>
        </Card>
      ) : (
        <div className="grid gap-4 lg:grid-cols-2">
          {rules.map((rule) => (
            <Card key={rule.id} className={rule.enabled ? undefined : "opacity-70"}>
              <CardHeader className="pb-2">
                <div className="flex items-start gap-3">
                  <div className="min-w-0 flex-1">
                    <CardTitle className="text-base">{rule.name}</CardTitle>
                    <CardDescription>
                      When: {triggerLabel(rule.trigger)}
                      {conditionsSummary(rule) ? ` · ${conditionsSummary(rule)}` : ""}
                    </CardDescription>
                  </div>
                  {canManage ? (
                    <Switch
                      checked={rule.enabled}
                      onCheckedChange={() => void toggleEnabled(rule)}
                      aria-label={`Enable rule ${rule.name}`}
                    />
                  ) : (
                    <Badge variant={rule.enabled ? "default" : "secondary"}>
                      {rule.enabled ? "On" : "Off"}
                    </Badge>
                  )}
                </div>
              </CardHeader>
              <CardContent className="flex flex-col gap-3">
                <div className="flex flex-wrap gap-1.5">
                  {rule.actions.map((action, index) => (
                    <Badge key={index} variant="secondary" className="font-normal">
                      {index + 1}. {actionSummary(action)}
                    </Badge>
                  ))}
                </div>
                {canManage ? (
                  <div className="flex gap-2">
                    <Button variant="outline" size="sm" onClick={() => openBuilder(rule)}>
                      <Pencil className="size-3.5" /> Edit
                    </Button>
                    <Button
                      variant="ghost"
                      size="sm"
                      className="text-red-600"
                      onClick={() => setDeleteTarget(rule)}
                    >
                      <Trash2 className="size-3.5" /> Delete
                    </Button>
                  </div>
                ) : null}
              </CardContent>
            </Card>
          ))}
        </div>
      )}

      {canManage ? (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Recent activity</CardTitle>
            <CardDescription>
              The latest rule executions. A failed action (for example, a reply outside the
              channel&apos;s messaging window) is recorded here, never hidden.
            </CardDescription>
          </CardHeader>
          <CardContent>
            {runs.length === 0 ? (
              <p className="text-muted-foreground text-sm">
                No executions yet — rules run when their trigger happens.
              </p>
            ) : (
              <div className="flex flex-col divide-y">
                {runs.map((run) => (
                  <div key={run.id} className="flex flex-col gap-1 py-2.5">
                    <div className="flex flex-wrap items-center gap-2 text-sm">
                      <span className="font-medium">{run.ruleName}</span>
                      <Badge variant="outline" className="font-normal">
                        {triggerLabel(run.trigger)}
                      </Badge>
                      <span className="text-muted-foreground text-xs">
                        {relativeTime(run.createdAt)}
                      </span>
                    </div>
                    <div className="flex flex-wrap gap-1.5">
                      {run.results.map((result, index) => (
                        <span
                          key={index}
                          title={result.detail}
                          className={
                            result.ok
                              ? "inline-flex items-center gap-1 rounded-full bg-emerald-100 px-2 py-0.5 text-[11px] font-medium text-emerald-800 dark:bg-emerald-500/15 dark:text-emerald-300"
                              : "inline-flex items-center gap-1 rounded-full bg-red-100 px-2 py-0.5 text-[11px] font-medium text-red-800 dark:bg-red-500/15 dark:text-red-300"
                          }
                        >
                          {result.ok ? (
                            <CheckCircle2 className="size-3" />
                          ) : (
                            <XCircle className="size-3" />
                          )}
                          {result.type}: {result.detail}
                        </span>
                      ))}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </CardContent>
        </Card>
      ) : null}

      {/* ─── Builder dialog ─────────────────────────────────────── */}
      <Dialog open={builderOpen} onOpenChange={setBuilderOpen}>
        <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-2xl">
          <DialogHeader>
            <DialogTitle>{editingId ? "Edit rule" : "New automation rule"}</DialogTitle>
            <DialogDescription>
              Build the flow top to bottom: when it happens, the conditions that must match,
              then what to do.
            </DialogDescription>
          </DialogHeader>

          <div className="flex flex-col gap-2">
            <Label htmlFor="rule-name">Rule name</Label>
            <Input
              id="rule-name"
              value={ruleName}
              onChange={(event) => setRuleName(event.target.value)}
              placeholder="e.g. Welcome + round-robin for new chats"
            />
          </div>

          {/* Step 1 — trigger */}
          <div className="rounded-xl border p-4">
            <p className="mb-3 flex items-center gap-2 text-sm font-semibold">
              <Zap className="size-4 text-indigo-600" /> When…
            </p>
            <Select value={trigger} onValueChange={setTrigger}>
              <SelectTrigger aria-label="Trigger">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {TRIGGERS.map((item) => (
                  <SelectItem key={item.value} value={item.value}>
                    {item.label} — {item.hint}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="flex justify-center" aria-hidden>
            <ArrowDown className="text-muted-foreground size-4" />
          </div>

          {/* Step 2 — conditions */}
          <div className="rounded-xl border p-4">
            <p className="mb-3 flex items-center gap-2 text-sm font-semibold">
              <Filter className="size-4 text-indigo-600" /> Only if…
              <span className="text-muted-foreground text-xs font-normal">
                (leave empty to run every time)
              </span>
            </p>
            <div className="flex flex-col gap-4">
              <div>
                <p className="text-muted-foreground mb-1.5 text-xs font-medium">
                  Channel is one of
                </p>
                <div className="flex flex-wrap gap-1.5">
                  {PROVIDER_OPTIONS.map((option) => {
                    const active = condProviders.includes(option.value);
                    return (
                      <button
                        key={option.value}
                        type="button"
                        onClick={() =>
                          setCondProviders((prev) =>
                            active
                              ? prev.filter((p) => p !== option.value)
                              : [...prev, option.value],
                          )
                        }
                        className={
                          active
                            ? "rounded-full bg-indigo-600 px-2.5 py-1 text-xs font-medium text-white"
                            : "bg-muted text-muted-foreground hover:text-foreground rounded-full px-2.5 py-1 text-xs font-medium"
                        }
                      >
                        {option.label}
                      </button>
                    );
                  })}
                </div>
              </div>
              {tags.length > 0 ? (
                <div>
                  <p className="text-muted-foreground mb-1.5 text-xs font-medium">
                    Conversation has tag
                  </p>
                  <div className="flex flex-wrap gap-1.5">
                    {tags.map((tag) => {
                      const active = condTagIds.includes(tag.id);
                      return (
                        <button
                          key={tag.id}
                          type="button"
                          onClick={() =>
                            setCondTagIds((prev) =>
                              active ? prev.filter((id) => id !== tag.id) : [...prev, tag.id],
                            )
                          }
                          className={
                            active
                              ? "rounded-full bg-indigo-600 px-2.5 py-1 text-xs font-medium text-white"
                              : "bg-muted text-muted-foreground hover:text-foreground rounded-full px-2.5 py-1 text-xs font-medium"
                          }
                        >
                          {tag.name}
                        </button>
                      );
                    })}
                  </div>
                </div>
              ) : null}
              <div className="flex flex-wrap gap-x-6 gap-y-2">
                <label className="flex items-center gap-2 text-sm">
                  <Switch checked={condUnassignedOnly} onCheckedChange={setCondUnassignedOnly} />
                  Only when unassigned
                </label>
                {trigger === "message.created" ? (
                  <label className="flex items-center gap-2 text-sm">
                    <Switch
                      checked={condFirstMessageOnly}
                      onCheckedChange={setCondFirstMessageOnly}
                    />
                    Only the first message
                  </label>
                ) : null}
              </div>
            </div>
          </div>

          <div className="flex justify-center" aria-hidden>
            <ArrowDown className="text-muted-foreground size-4" />
          </div>

          {/* Step 3 — actions */}
          <div className="rounded-xl border p-4">
            <p className="mb-3 flex items-center gap-2 text-sm font-semibold">
              <Play className="size-4 text-indigo-600" /> Then do…
            </p>
            <div className="flex flex-col gap-3">
              {drafts.map((draft, index) => (
                <div key={index} className="bg-muted/40 flex flex-col gap-2 rounded-lg border p-3">
                  <div className="flex items-center gap-2">
                    <Select
                      value={draft.type}
                      onValueChange={(value) => updateDraft(index, { type: value })}
                    >
                      <SelectTrigger className="w-52" aria-label="Action type">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        {ACTION_TYPES.map((item) => (
                          <SelectItem key={item.value} value={item.value}>
                            {item.label}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                    <div className="ml-auto flex gap-1">
                      <Button
                        variant="ghost"
                        size="icon"
                        className="size-7"
                        disabled={index === 0}
                        onClick={() =>
                          setDrafts((prev) => {
                            const next = [...prev];
                            const [moved] = next.splice(index, 1);
                            if (moved) next.splice(index - 1, 0, moved);
                            return next;
                          })
                        }
                        aria-label="Move action up"
                      >
                        <ArrowUp className="size-3.5" />
                      </Button>
                      <Button
                        variant="ghost"
                        size="icon"
                        className="size-7"
                        disabled={index === drafts.length - 1}
                        onClick={() =>
                          setDrafts((prev) => {
                            const next = [...prev];
                            const [moved] = next.splice(index, 1);
                            if (moved) next.splice(index + 1, 0, moved);
                            return next;
                          })
                        }
                        aria-label="Move action down"
                      >
                        <ArrowDown className="size-3.5" />
                      </Button>
                      <Button
                        variant="ghost"
                        size="icon"
                        className="size-7 text-red-600"
                        disabled={drafts.length === 1}
                        onClick={() =>
                          setDrafts((prev) => prev.filter((_, i) => i !== index))
                        }
                        aria-label="Remove action"
                      >
                        <Trash2 className="size-3.5" />
                      </Button>
                    </div>
                  </div>

                  {draft.type === "assign" ? (
                    <div className="flex flex-wrap gap-2">
                      <Select
                        value={draft.strategy}
                        onValueChange={(value) => updateDraft(index, { strategy: value })}
                      >
                        <SelectTrigger className="w-48" aria-label="Assignment strategy">
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="round_robin">Round-robin (available)</SelectItem>
                          <SelectItem value="least_busy">Least busy (available)</SelectItem>
                          <SelectItem value="specific">A specific person</SelectItem>
                        </SelectContent>
                      </Select>
                      {draft.strategy === "specific" ? (
                        <Select
                          value={draft.userId || undefined}
                          onValueChange={(value) => updateDraft(index, { userId: value })}
                        >
                          <SelectTrigger className="w-52" aria-label="Assign to">
                            <SelectValue placeholder="Choose a member" />
                          </SelectTrigger>
                          <SelectContent>
                            {assignableMembers.map((member) => (
                              <SelectItem key={member.userId} value={member.userId}>
                                {member.name} ({member.role.toLowerCase()})
                              </SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                      ) : null}
                      {teams.length > 0 && draft.strategy !== "specific" ? (
                        <Select
                          value={draft.teamId || "any"}
                          onValueChange={(value) =>
                            updateDraft(index, { teamId: value === "any" ? "" : value })
                          }
                        >
                          <SelectTrigger className="w-48" aria-label="Restrict to team">
                            <SelectValue />
                          </SelectTrigger>
                          <SelectContent>
                            <SelectItem value="any">Any team</SelectItem>
                            {teams.map((team) => (
                              <SelectItem key={team.id} value={team.id}>
                                {team.name}
                              </SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                      ) : null}
                    </div>
                  ) : null}

                  {draft.type === "add_tag" ? (
                    <Input
                      value={draft.name}
                      onChange={(event) => updateDraft(index, { name: event.target.value })}
                      placeholder="Tag name, e.g. vip"
                      aria-label="Tag name"
                    />
                  ) : null}

                  {draft.type === "send_canned" ? (
                    canned.length > 0 ? (
                      <Select
                        value={draft.cannedResponseId || undefined}
                        onValueChange={(value) =>
                          updateDraft(index, { cannedResponseId: value })
                        }
                      >
                        <SelectTrigger aria-label="Saved reply">
                          <SelectValue placeholder="Choose a saved reply" />
                        </SelectTrigger>
                        <SelectContent>
                          {canned.map((item) => (
                            <SelectItem key={item.id} value={item.id}>
                              {item.title}
                              {item.category ? ` · ${item.category}` : ""}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    ) : (
                      <p className="text-muted-foreground text-xs">
                        No saved replies yet — create one from the inbox (Saved replies) first.
                      </p>
                    )
                  ) : null}

                  {draft.type === "notify" ? (
                    <div className="flex flex-col gap-2">
                      <Input
                        value={draft.message}
                        onChange={(event) => updateDraft(index, { message: event.target.value })}
                        placeholder="Message, e.g. New chat from {{contact.name}}"
                        aria-label="Notification message"
                      />
                      <div className="flex flex-wrap gap-1.5">
                        <span className="text-muted-foreground py-1 text-xs">Send to:</span>
                        {members.map((member) => {
                          const active = draft.userIds.includes(member.userId);
                          return (
                            <button
                              key={member.userId}
                              type="button"
                              onClick={() =>
                                updateDraft(index, {
                                  userIds: active
                                    ? draft.userIds.filter((id) => id !== member.userId)
                                    : [...draft.userIds, member.userId],
                                })
                              }
                              className={
                                active
                                  ? "rounded-full bg-indigo-600 px-2.5 py-1 text-xs font-medium text-white"
                                  : "bg-muted text-muted-foreground hover:text-foreground rounded-full px-2.5 py-1 text-xs font-medium"
                              }
                            >
                              {member.name}
                            </button>
                          );
                        })}
                        {draft.userIds.length === 0 ? (
                          <span className="text-muted-foreground py-1 text-xs">
                            (none picked = owners &amp; admins)
                          </span>
                        ) : null}
                      </div>
                    </div>
                  ) : null}

                  {draft.type === "set_status" ? (
                    <Select
                      value={draft.status}
                      onValueChange={(value) => updateDraft(index, { status: value })}
                    >
                      <SelectTrigger className="w-52" aria-label="New status">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="RESOLVED">Resolved</SelectItem>
                        <SelectItem value="OPEN">Open (reopen)</SelectItem>
                      </SelectContent>
                    </Select>
                  ) : null}

                  {draft.type === "set_priority" ? (
                    <Select
                      value={draft.priority}
                      onValueChange={(value) => updateDraft(index, { priority: value })}
                    >
                      <SelectTrigger className="w-52" aria-label="Priority">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="LOW">Low</SelectItem>
                        <SelectItem value="MEDIUM">Medium</SelectItem>
                        <SelectItem value="HIGH">High</SelectItem>
                        <SelectItem value="URGENT">Urgent</SelectItem>
                      </SelectContent>
                    </Select>
                  ) : null}
                </div>
              ))}
              {drafts.length < 10 ? (
                <Button
                  variant="outline"
                  size="sm"
                  className="self-start"
                  onClick={() => setDrafts((prev) => [...prev, emptyDraft()])}
                >
                  <Plus className="size-3.5" /> Add action
                </Button>
              ) : null}
            </div>
          </div>

          <div className="flex items-center justify-end gap-2 pt-1">
            <Button variant="ghost" onClick={() => setBuilderOpen(false)}>
              Cancel
            </Button>
            <Button onClick={() => void saveRule()} disabled={!formValid || saving}>
              {saving ? "Saving…" : editingId ? "Save changes" : "Create rule"}
            </Button>
          </div>
        </DialogContent>
      </Dialog>

      {/* ─── Delete confirm ─────────────────────────────────────── */}
      <AlertDialog
        open={deleteTarget !== null}
        onOpenChange={(open) => {
          if (!open && !deleting) setDeleteTarget(null);
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete this rule?</AlertDialogTitle>
            <AlertDialogDescription>
              “{deleteTarget?.name}” will stop running immediately and its execution history
              will be removed. This cannot be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={deleting}>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => void confirmDelete()}
              disabled={deleting}
              className="bg-red-600 text-white hover:bg-red-700"
            >
              {deleting ? "Deleting…" : "Delete rule"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
