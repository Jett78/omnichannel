"use client";

import {
  ArrowDown,
  ArrowUp,
  CheckCircle2,
  ChevronLeft,
  ChevronRight,
  Filter,
  Pencil,
  Play,
  Plus,
  Trash2,
  XCircle,
  Zap,
} from "lucide-react";
import { useState, type ReactNode } from "react";

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
import { Card, CardContent, CardDescription, CardHeader } from "@/components/ui/card";
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
    channelIds?: string[];
    tagIds?: string[];
    unassignedOnly?: boolean;
    firstMessageOnly?: boolean;
    keywords?: string[];
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
  teamIds: string[];
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
  { value: "ai_reply", label: "Reply with AI" },
  { value: "notify", label: "Notify team" },
  { value: "set_status", label: "Set status" },
  { value: "set_priority", label: "Set priority" },
] as const;

const PROVIDER_OPTIONS = (Object.keys(PROVIDER_META) as Provider[]).map((provider) => ({
  value: provider.toLowerCase(),
  label: PROVIDER_META[provider].shortLabel,
}));

/**
 * Dograh-inspired design tokens for this page: uppercase micro-labels
 * for sections and a colour per trigger type (their node-badge
 * palette) while cards themselves stay neutral. The primary CTA uses
 * the app's blue (owner's pick over Dograh's amber).
 */
const CTA_CLASS = "bg-blue-500 text-white hover:bg-blue-600";
const SECTION_LABEL = "text-xs font-semibold tracking-wider text-muted-foreground uppercase";
const TRIGGER_BADGE: Record<string, string> = {
  "conversation.created": "bg-emerald-500",
  "message.created": "bg-blue-500",
  "conversation.assigned": "bg-amber-500",
  "conversation.resolved": "bg-rose-500",
  "tag.added": "bg-purple-500",
};

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
  channels: Array<{ id: string; provider: string; displayName: string }>;
  me: { userId: string; role: string; isAvailable: boolean };
  canManage: boolean;
  /** Page-level sections rendered between the rules and Recent
   *  activity (the AI configuration cards) so activity stays last. */
  aiSections?: ReactNode;
}

export function AutomationRules({
  workspaceId,
  initialRules,
  initialRuns,
  members,
  teams,
  tags,
  canned,
  channels,
  me,
  canManage,
  aiSections,
}: AutomationRulesProps) {
  const [rules, setRules] = useState(initialRules);
  const [runs, setRuns] = useState(initialRuns);
  const [runsPage, setRunsPage] = useState(1);
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
  const [condChannelIds, setCondChannelIds] = useState<string[]>([]);
  const [condTagIds, setCondTagIds] = useState<string[]>([]);
  const [condUnassignedOnly, setCondUnassignedOnly] = useState(false);
  const [condFirstMessageOnly, setCondFirstMessageOnly] = useState(false);
  const [condKeywords, setCondKeywords] = useState("");
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
      const runsRes = await fetch(`${apiBase}/automations/runs?limit=100`).catch(() => null);
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
      setCondChannelIds(rule.conditions?.channelIds ?? []);
      setCondTagIds(rule.conditions?.tagIds ?? []);
      setCondUnassignedOnly(rule.conditions?.unassignedOnly ?? false);
      setCondFirstMessageOnly(rule.conditions?.firstMessageOnly ?? false);
      setCondKeywords((rule.conditions?.keywords ?? []).join(", "));
      setDrafts(rule.actions.length ? rule.actions.map(draftFromAction) : [emptyDraft()]);
    } else {
      setEditingId(null);
      setRuleName("");
      setTrigger("conversation.created");
      setCondProviders([]);
      setCondChannelIds([]);
      setCondTagIds([]);
      setCondUnassignedOnly(false);
      setCondFirstMessageOnly(false);
      setCondKeywords("");
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
    if (condChannelIds.length) conditions.channelIds = condChannelIds;
    if (condTagIds.length) conditions.tagIds = condTagIds;
    if (condUnassignedOnly) conditions.unassignedOnly = true;
    if (condFirstMessageOnly && trigger === "message.created") conditions.firstMessageOnly = true;
    if (trigger === "message.created" || trigger === "conversation.created") {
      const keywords = [
        ...new Set(
          condKeywords
            .split(",")
            .map((word) => word.trim())
            .filter((word) => word !== ""),
        ),
      ].slice(0, 20);
      if (keywords.length) conditions.keywords = keywords;
    }
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
      case "ai_reply":
        return "Reply with AI";
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
    if (conditions.channelIds?.length) {
      parts.push(
        `channels: ${conditions.channelIds
          .map((id) => channels.find((c) => c.id === id)?.displayName ?? "…")
          .join(", ")}`,
      );
    }
    if (conditions.tagIds?.length) {
      parts.push(
        `tag: ${conditions.tagIds
          .map((id) => tags.find((t) => t.id === id)?.name ?? "…")
          .join(", ")}`,
      );
    }
    if (conditions.keywords?.length) {
      parts.push(`message contains: ${conditions.keywords.join(", ")}`);
    }
    if (conditions.unassignedOnly) parts.push("only when unassigned");
    if (conditions.firstMessageOnly) parts.push("first message only");
    return parts.length ? parts.join(" · ") : null;
  }

  function updateDraft(index: number, patch: Partial<ActionDraft>) {
    setDrafts((prev) => prev.map((d, i) => (i === index ? { ...d, ...patch } : d)));
  }

  // Recent activity pagination: 15 entries per page.
  const RUNS_PER_PAGE = 15;
  const runsPageCount = Math.max(1, Math.ceil(runs.length / RUNS_PER_PAGE));
  const currentRunsPage = Math.min(runsPage, runsPageCount);
  const pageRuns = runs.slice(
    (currentRunsPage - 1) * RUNS_PER_PAGE,
    currentRunsPage * RUNS_PER_PAGE,
  );

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title="Automation"
        description="Rules that greet, route and escalate conversations automatically. Actions run as the rule's creator, so channel messaging windows still apply."
        actions={
          canManage ? (
            <Button className={CTA_CLASS} onClick={() => openBuilder()}>
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

      <div className="flex flex-col gap-2">
        <p className={SECTION_LABEL}>My availability</p>
        <div className="border-border/60 bg-muted/30 flex flex-wrap items-center gap-3 rounded-full border px-4 py-2">
          <span
            className={`size-2 shrink-0 rounded-full ${myAvailable ? "bg-emerald-500" : "bg-zinc-400"}`}
          />
          <p className="min-w-0 flex-1 text-sm">
            <span className="font-medium">{myAvailable ? "Available" : "Away"}</span>
            <span className="text-muted-foreground">
              {" "}
              — round-robin and least-busy rules {myAvailable ? "can assign to you" : "skip you"}
            </span>
          </p>
          <Switch
            checked={myAvailable}
            onCheckedChange={(value) => void toggleAvailability(value)}
            aria-label="My availability for auto-assignment"
          />
        </div>
      </div>

      <div className="flex flex-col gap-2">
        <p className={SECTION_LABEL}>Rules</p>
        {rules.length === 0 ? (
          <Card>
            <CardContent className="flex flex-col items-center gap-2 py-10 text-center">
              <p className="text-muted-foreground max-w-sm text-sm">
                No automation rules yet. Create your first rule to get started — for
                example, round-robin assignment for new conversations, or an automatic
                greeting from your saved replies.
              </p>
              {canManage ? (
                <Button className={`mt-2 ${CTA_CLASS}`} onClick={() => openBuilder()}>
                  <Plus className="size-4" /> New rule
                </Button>
              ) : null}
            </CardContent>
          </Card>
        ) : (
          <Card className="gap-0 overflow-hidden py-0">
            <div className="flex flex-col divide-y">
              {rules.map((rule) => (
                <div
                  key={rule.id}
                  className={`flex flex-col gap-2 px-4 py-3.5 transition-colors hover:bg-muted/50 sm:flex-row sm:items-center sm:gap-4 ${
                    rule.enabled ? "" : "opacity-60"
                  }`}
                >
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <span
                        className={`size-2 shrink-0 rounded-full ${
                          rule.enabled ? "bg-emerald-500" : "bg-zinc-400"
                        }`}
                      />
                      <span className="text-sm font-medium">{rule.name}</span>
                      <span
                        className={`inline-flex items-center rounded-full px-2 py-0.5 text-[11px] font-medium text-white ${
                          TRIGGER_BADGE[rule.trigger] ?? "bg-zinc-500"
                        }`}
                      >
                        {triggerLabel(rule.trigger)}
                      </span>
                      <span className="text-muted-foreground text-xs">
                        {rule.enabled ? "Enabled" : "Disabled"}
                      </span>
                    </div>
                    {conditionsSummary(rule) ? (
                      <p className="text-muted-foreground mt-1 text-xs">
                        Only if: {conditionsSummary(rule)}
                      </p>
                    ) : null}
                    <div className="mt-1.5 flex flex-wrap gap-1.5">
                      {rule.actions.map((action, index) => (
                        <span
                          key={index}
                          className="bg-muted inline-flex items-center rounded-full px-2 py-0.5 text-[11px] font-medium"
                        >
                          {index + 1}. {actionSummary(action)}
                        </span>
                      ))}
                    </div>
                  </div>
                  <div className="flex shrink-0 items-center gap-2">
                    {canManage ? (
                      <>
                        <Switch
                          checked={rule.enabled}
                          onCheckedChange={() => void toggleEnabled(rule)}
                          aria-label={`Enable rule ${rule.name}`}
                        />
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
                      </>
                    ) : (
                      <Badge variant={rule.enabled ? "default" : "secondary"}>
                        {rule.enabled ? "On" : "Off"}
                      </Badge>
                    )}
                  </div>
                </div>
              ))}
            </div>
          </Card>
        )}
      </div>

      {aiSections}

      {canManage ? (
        <div className="flex flex-col gap-2">
          <p className={SECTION_LABEL}>Recent activity</p>
          <Card>
            <CardHeader>
              <CardDescription>
                The latest rule executions. A failed action (for example, a reply outside
                the channel&apos;s messaging window) is recorded here, never hidden.
              </CardDescription>
            </CardHeader>
          <CardContent>
            {runs.length === 0 ? (
              <p className="text-muted-foreground text-sm">
                No executions yet — rules run when their trigger happens.
              </p>
            ) : (
              <div className="flex flex-col divide-y">
                {pageRuns.map((run) => (
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
            {runs.length > RUNS_PER_PAGE ? (
              <div className="mt-3 flex flex-wrap items-center gap-3 border-t pt-3">
                <p className="text-muted-foreground flex-1 text-xs">
                  Showing {(currentRunsPage - 1) * RUNS_PER_PAGE + 1}–
                  {Math.min(currentRunsPage * RUNS_PER_PAGE, runs.length)} of {runs.length}{" "}
                  entries
                </p>
                <Button
                  variant="outline"
                  size="sm"
                  disabled={currentRunsPage <= 1}
                  onClick={() => setRunsPage(currentRunsPage - 1)}
                >
                  <ChevronLeft className="size-3.5" /> Previous
                </Button>
                <span className="text-xs font-medium">
                  Page {currentRunsPage} of {runsPageCount}
                </span>
                <Button
                  variant="outline"
                  size="sm"
                  disabled={currentRunsPage >= runsPageCount}
                  onClick={() => setRunsPage(currentRunsPage + 1)}
                >
                  Next <ChevronRight className="size-3.5" />
                </Button>
              </div>
            ) : null}
            </CardContent>
          </Card>
        </div>
      ) : null}

      {/* ─── Builder dialog ─────────────────────────────────────── */}
      <Dialog open={builderOpen} onOpenChange={setBuilderOpen}>
        <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-3xl">
          <DialogHeader>
            <DialogTitle className="text-lg">
              {editingId ? "Edit rule" : "New automation rule"}
            </DialogTitle>
            <DialogDescription>
              Build the flow top to bottom: when it happens, the conditions that must match,
              then what to do.
            </DialogDescription>
          </DialogHeader>

          <div className="flex flex-col gap-2">
            <Label htmlFor="rule-name">Rule name</Label>
            <Input
              id="rule-name"
              className="h-11 bg-muted/30 px-3.5"
              value={ruleName}
              onChange={(event) => setRuleName(event.target.value)}
              placeholder="e.g. Welcome + round-robin for new chats"
            />
          </div>

          {/* Step 1 — trigger. Dograh node-card style: the card stays
              neutral; the step's colour lives in a small badge that
              overlaps the card's top edge. */}
          <div className="relative mt-3 rounded-xl border border-emerald-200/70 bg-emerald-50/40 p-4 pt-5 dark:border-emerald-500/20 dark:bg-emerald-500/5">
            <span className="absolute -top-3 left-4 inline-flex items-center gap-1 rounded-full bg-emerald-500 px-2 py-0.5 text-xs font-medium text-white">
              <Zap className="size-3" /> When
            </span>
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
            <span className="bg-muted flex size-6 items-center justify-center rounded-full ring-1 ring-border/60">
              <ArrowDown className="text-muted-foreground size-3.5" />
            </span>
          </div>

          {/* Step 2 — conditions */}
          <div className="relative mt-3 rounded-xl border border-amber-200/70 bg-amber-50/40 p-4 pt-5 dark:border-amber-500/20 dark:bg-amber-500/5">
            <span className="absolute -top-3 left-4 inline-flex items-center gap-1 rounded-full bg-amber-500 px-2 py-0.5 text-xs font-medium text-white">
              <Filter className="size-3" /> Only if
            </span>
            <p className="text-muted-foreground mb-3 text-xs">
              Leave everything empty to run every time.
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
                            ? "rounded-full bg-primary px-2.5 py-1 text-xs font-semibold text-primary-foreground ring-1 ring-primary transition-colors"
                            : "rounded-full bg-muted/60 px-2.5 py-1 text-xs font-medium text-muted-foreground ring-1 ring-border/60 transition-colors hover:bg-muted hover:text-foreground hover:ring-border"
                        }
                      >
                        {option.label}
                      </button>
                    );
                  })}
                </div>
              </div>
              {channels.length > 0 ? (
                <div>
                  <p className="text-muted-foreground mb-1.5 text-xs font-medium">
                    Only on these channels
                  </p>
                  <div className="flex flex-wrap gap-1.5">
                    {channels.map((channel) => {
                      const active = condChannelIds.includes(channel.id);
                      const providerLabel =
                        PROVIDER_OPTIONS.find(
                          (o) => o.value === channel.provider.toLowerCase(),
                        )?.label ?? channel.provider;
                      return (
                        <button
                          key={channel.id}
                          type="button"
                          onClick={() =>
                            setCondChannelIds((prev) =>
                              active
                                ? prev.filter((id) => id !== channel.id)
                                : [...prev, channel.id],
                            )
                          }
                          className={
                            active
                              ? "rounded-full bg-primary px-2.5 py-1 text-xs font-semibold text-primary-foreground ring-1 ring-primary transition-colors"
                              : "rounded-full bg-muted/60 px-2.5 py-1 text-xs font-medium text-muted-foreground ring-1 ring-border/60 transition-colors hover:bg-muted hover:text-foreground hover:ring-border"
                          }
                        >
                          {channel.displayName}
                          <span className="opacity-70"> · {providerLabel}</span>
                        </button>
                      );
                    })}
                  </div>
                  <p className="text-muted-foreground mt-1 text-[11px]">
                    Leave empty to run on every channel. Pick channels here to scope a
                    rule — e.g. let “Reply with AI” answer only on your website and
                    Messenger, never on WhatsApp.
                  </p>
                </div>
              ) : null}
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
                              ? "rounded-full bg-primary px-2.5 py-1 text-xs font-semibold text-primary-foreground ring-1 ring-primary transition-colors"
                              : "rounded-full bg-muted/60 px-2.5 py-1 text-xs font-medium text-muted-foreground ring-1 ring-border/60 transition-colors hover:bg-muted hover:text-foreground hover:ring-border"
                          }
                        >
                          {tag.name}
                        </button>
                      );
                    })}
                  </div>
                </div>
              ) : null}
              {trigger === "message.created" || trigger === "conversation.created" ? (
                <div>
                  <p className="text-muted-foreground mb-1.5 text-xs font-medium">
                    Message contains any of these words or phrases
                  </p>
                  <Input
                    value={condKeywords}
                    onChange={(event) => setCondKeywords(event.target.value)}
                    placeholder="price, kati, delivery charge, opening hours"
                    aria-label="Message keywords"
                  />
                  <p className="text-muted-foreground mt-1 text-[11px]">
                    Comma-separated, case-insensitive. Pair with a “Send a saved reply” action
                    below for keyword auto-replies.
                  </p>
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
            <span className="bg-muted flex size-6 items-center justify-center rounded-full ring-1 ring-border/60">
              <ArrowDown className="text-muted-foreground size-3.5" />
            </span>
          </div>

          {/* Step 3 — actions */}
          <div className="relative mt-3 rounded-xl border border-blue-200/70 bg-blue-50/40 p-4 pt-5 dark:border-blue-500/20 dark:bg-blue-500/5">
            <span className="absolute -top-3 left-4 inline-flex items-center gap-1 rounded-full bg-blue-500 px-2 py-0.5 text-xs font-medium text-white">
              <Play className="size-3" /> Then do
            </span>
            <div className="flex flex-col gap-3">
              {drafts.map((draft, index) => (
                <div
                  key={index}
                  className="flex flex-col gap-3 rounded-xl border bg-background p-4"
                >
                  <div className="flex items-center gap-2.5">
                    <span className="bg-primary/10 text-primary flex size-7 shrink-0 items-center justify-center rounded-full text-xs font-bold">
                      {index + 1}
                    </span>
                    <Select
                      value={draft.type}
                      onValueChange={(value) => updateDraft(index, { type: value })}
                    >
                      <SelectTrigger
                        className="h-10 flex-1 bg-muted/30 font-medium sm:w-60 sm:flex-none"
                        aria-label="Action type"
                      >
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
                    <div className="ml-auto flex items-center gap-0.5 rounded-lg bg-muted/40 p-0.5 ring-1 ring-border/50">
                      <Button
                        variant="ghost"
                        size="icon"
                        className="size-7 rounded-md"
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
                        className="size-7 rounded-md"
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
                        className="size-7 rounded-md text-red-600 hover:bg-red-50 hover:text-red-700 dark:hover:bg-red-950/40"
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

                  <div className="flex flex-col gap-3 border-t border-dashed pt-3">
                    {draft.type === "assign" ? (
                      <div className="grid gap-3 sm:grid-cols-2">
                        <label className="flex flex-col gap-1.5">
                          <span className="text-muted-foreground text-[11px] font-semibold tracking-wider uppercase">
                            Strategy
                          </span>
                          <Select
                            value={draft.strategy}
                            onValueChange={(value) => updateDraft(index, { strategy: value })}
                          >
                            <SelectTrigger className="h-10 w-full bg-muted/30" aria-label="Assignment strategy">
                              <SelectValue />
                            </SelectTrigger>
                            <SelectContent>
                              <SelectItem value="round_robin">Round-robin (available)</SelectItem>
                              <SelectItem value="least_busy">Least busy (available)</SelectItem>
                              <SelectItem value="specific">A specific person</SelectItem>
                            </SelectContent>
                          </Select>
                        </label>
                        {draft.strategy === "specific" ? (
                          <label className="flex flex-col gap-1.5">
                            <span className="text-muted-foreground text-[11px] font-semibold tracking-wider uppercase">
                              Assign to
                            </span>
                            <Select
                              value={draft.userId || undefined}
                              onValueChange={(value) => updateDraft(index, { userId: value })}
                            >
                              <SelectTrigger className="h-10 w-full bg-muted/30" aria-label="Assign to">
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
                          </label>
                        ) : null}
                        {teams.length > 0 && draft.strategy !== "specific" ? (
                          <label className="flex flex-col gap-1.5">
                            <span className="text-muted-foreground text-[11px] font-semibold tracking-wider uppercase">
                              Team
                            </span>
                            <Select
                              value={draft.teamId || "any"}
                              onValueChange={(value) =>
                                updateDraft(index, { teamId: value === "any" ? "" : value })
                              }
                            >
                              <SelectTrigger className="h-10 w-full bg-muted/30" aria-label="Restrict to team">
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
                          </label>
                        ) : null}
                      </div>
                    ) : null}

                    {draft.type === "ai_reply" ? (
                      <p className="rounded-lg bg-primary/5 px-3 py-2.5 text-xs leading-relaxed text-muted-foreground ring-1 ring-primary/10">
                        The AI writes and sends a reply from the conversation and your knowledge
                        base (managed under “AI assistant” on this page). It stops replying in a
                        conversation once a human agent has replied there. Needs the AI key
                        configured — without it, the run records “not configured” and nothing is
                        sent.
                      </p>
                    ) : null}

                    {draft.type === "add_tag" ? (
                      <label className="flex flex-col gap-1.5">
                        <span className="text-muted-foreground text-[11px] font-semibold tracking-wider uppercase">
                          Tag name
                        </span>
                        <Input
                          className="h-10 bg-muted/30"
                          value={draft.name}
                          onChange={(event) => updateDraft(index, { name: event.target.value })}
                          placeholder="Tag name, e.g. vip"
                          aria-label="Tag name"
                        />
                      </label>
                    ) : null}

                    {draft.type === "send_canned" ? (
                      canned.length > 0 ? (
                        <label className="flex flex-col gap-1.5">
                          <span className="text-muted-foreground text-[11px] font-semibold tracking-wider uppercase">
                            Saved reply
                          </span>
                          <Select
                            value={draft.cannedResponseId || undefined}
                            onValueChange={(value) =>
                              updateDraft(index, { cannedResponseId: value })
                            }
                          >
                            <SelectTrigger className="h-10 w-full bg-muted/30" aria-label="Saved reply">
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
                        </label>
                      ) : (
                        <p className="text-muted-foreground text-xs">
                          No saved replies yet — create one from the inbox (Saved replies) first.
                        </p>
                      )
                    ) : null}

                    {draft.type === "notify" ? (
                      <div className="flex flex-col gap-3">
                        <label className="flex flex-col gap-1.5">
                          <span className="text-muted-foreground text-[11px] font-semibold tracking-wider uppercase">
                            Message
                          </span>
                          <Input
                            className="h-10 bg-muted/30"
                            value={draft.message}
                            onChange={(event) =>
                              updateDraft(index, { message: event.target.value })
                            }
                            placeholder="Message, e.g. New chat from {{contact.name}}"
                            aria-label="Notification message"
                          />
                        </label>
                        <div className="flex flex-col gap-1.5">
                          <span className="text-muted-foreground text-[11px] font-semibold tracking-wider uppercase">
                            Send to
                          </span>
                          <div className="flex flex-wrap gap-1.5">
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
                                      ? "rounded-full bg-primary px-2.5 py-1 text-xs font-semibold text-primary-foreground ring-1 ring-primary transition-colors"
                                      : "rounded-full bg-muted/60 px-2.5 py-1 text-xs font-medium text-muted-foreground ring-1 ring-border/60 transition-colors hover:bg-muted hover:text-foreground hover:ring-border"
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
                      </div>
                    ) : null}

                    {draft.type === "set_status" ? (
                      <label className="flex flex-col gap-1.5">
                        <span className="text-muted-foreground text-[11px] font-semibold tracking-wider uppercase">
                          New status
                        </span>
                        <Select
                          value={draft.status}
                          onValueChange={(value) => updateDraft(index, { status: value })}
                        >
                          <SelectTrigger className="h-10 w-full bg-muted/30 sm:w-60" aria-label="New status">
                            <SelectValue />
                          </SelectTrigger>
                          <SelectContent>
                            <SelectItem value="RESOLVED">Resolved</SelectItem>
                            <SelectItem value="OPEN">Open (reopen)</SelectItem>
                          </SelectContent>
                        </Select>
                      </label>
                    ) : null}

                    {draft.type === "set_priority" ? (
                      <label className="flex flex-col gap-1.5">
                        <span className="text-muted-foreground text-[11px] font-semibold tracking-wider uppercase">
                          Priority
                        </span>
                        <Select
                          value={draft.priority}
                          onValueChange={(value) => updateDraft(index, { priority: value })}
                        >
                          <SelectTrigger className="h-10 w-full bg-muted/30 sm:w-60" aria-label="Priority">
                            <SelectValue />
                          </SelectTrigger>
                          <SelectContent>
                            <SelectItem value="LOW">Low</SelectItem>
                            <SelectItem value="MEDIUM">Medium</SelectItem>
                            <SelectItem value="HIGH">High</SelectItem>
                            <SelectItem value="URGENT">Urgent</SelectItem>
                          </SelectContent>
                        </Select>
                      </label>
                    ) : null}
                  </div>
                </div>
              ))}
              {drafts.length < 10 ? (
                <Button
                  variant="outline"
                  className="w-full border-dashed py-5 text-muted-foreground hover:text-foreground"
                  onClick={() => setDrafts((prev) => [...prev, emptyDraft()])}
                >
                  <Plus className="size-4" /> Add action
                </Button>
              ) : null}
            </div>
          </div>

          <div className="sticky bottom-0 z-10 -mx-6 -mb-6 flex items-center justify-end gap-2 border-t bg-background/95 px-6 pt-3 pb-4 backdrop-blur">
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
