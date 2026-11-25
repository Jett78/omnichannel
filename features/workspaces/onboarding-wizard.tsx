"use client";

import { useRouter } from "next/navigation";
import { useState, type FormEvent } from "react";
import {
  ArrowLeft,
  ArrowRight,
  Building2,
  Check,
  LogOut,
  Plug,
  Plus,
  Users,
} from "lucide-react";

import { PROVIDER_META } from "@/components/channel-icon";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { authClient } from "@/lib/auth-client";
import { cn } from "@/lib/utils";
import type { Provider } from "@/generated/prisma/client";

const STEPS = [
  { n: 1, label: "Workspace", icon: Building2 },
  { n: 2, label: "Invite team", icon: Users },
  { n: 3, label: "Connect channels", icon: Plug },
] as const;

const CHANNEL_PICKS: Array<{ provider: Provider; blurb: string }> = [
  { provider: "FACEBOOK", blurb: "Reply to your Page's Messenger chats." },
  { provider: "INSTAGRAM", blurb: "Answer Instagram DMs from the same inbox." },
  { provider: "WHATSAPP", blurb: "Chat with customers on WhatsApp Business." },
];

type InviteRole = "AGENT" | "ADMIN" | "VIEWER";

interface InviteRow {
  email: string;
  role: InviteRole;
  status: "idle" | "sending" | "sent" | "error";
  error?: string;
}

function errorMessage(data: unknown, fallback: string): string {
  if (data && typeof data === "object" && "error" in data) {
    const message = (data as { error: { message?: string } }).error.message;
    if (message) return message;
  }
  return fallback;
}

export function OnboardingWizard({ userName }: { userName: string }) {
  const router = useRouter();
  const firstName = userName.split(" ")[0] || userName;
  const [step, setStep] = useState(1);

  // Step 1 — workspace
  const [wsName, setWsName] = useState("");
  const [timezone, setTimezone] = useState(
    () => Intl.DateTimeFormat().resolvedOptions().timeZone || "Asia/Kathmandu",
  );
  const [workspaceId, setWorkspaceId] = useState<string | null>(null);
  const [wsError, setWsError] = useState<string | null>(null);
  const [wsPending, setWsPending] = useState(false);

  // Step 2 — invites
  const [rows, setRows] = useState<InviteRow[]>([
    { email: "", role: "AGENT", status: "idle" },
    { email: "", role: "AGENT", status: "idle" },
    { email: "", role: "AGENT", status: "idle" },
  ]);
  const [invitesPending, setInvitesPending] = useState(false);

  async function signOut() {
    await authClient.signOut();
    router.push("/login");
    router.refresh();
  }

  async function createWorkspace(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setWsError(null);
    setWsPending(true);
    try {
      const res = await fetch("/api/workspaces", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: wsName, timezone }),
      });
      const data: unknown = await res.json().catch(() => null);
      if (!res.ok) {
        setWsError(errorMessage(data, "Could not create the workspace."));
        return;
      }
      const newId =
        data && typeof data === "object" && "workspace" in data
          ? (data as { workspace: { id: string } }).workspace.id
          : null;
      if (!newId) {
        setWsError("Could not create the workspace.");
        return;
      }
      await fetch("/api/workspaces/active", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ workspaceId: newId }),
      }).catch(() => null);
      setWorkspaceId(newId);
      setStep(2);
    } catch {
      setWsError("Something went wrong. Please try again.");
    } finally {
      setWsPending(false);
    }
  }

  function updateRow(index: number, patch: Partial<InviteRow>) {
    setRows((prev) =>
      prev.map((row, i) => (i === index ? { ...row, ...patch, status: "idle" } : row)),
    );
  }

  async function sendInvites() {
    if (!workspaceId) return;
    const pendingRows = rows.filter((r) => r.email.trim() && r.status !== "sent");
    if (pendingRows.length === 0) {
      setStep(3);
      return;
    }
    setInvitesPending(true);
    const next = [...rows];
    for (let i = 0; i < next.length; i++) {
      const row = next[i];
      if (!row || !row.email.trim() || row.status === "sent") continue;
      next[i] = { ...row, status: "sending" };
      setRows([...next]);
      try {
        const res = await fetch(`/api/workspaces/${workspaceId}/members`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ email: row.email.trim(), role: row.role }),
        });
        const data: unknown = await res.json().catch(() => null);
        next[i] = res.ok
          ? { ...row, status: "sent" }
          : { ...row, status: "error", error: errorMessage(data, "Could not send this invite.") };
      } catch {
        next[i] = { ...row, status: "error", error: "Could not send this invite." };
      }
      setRows([...next]);
    }
    setInvitesPending(false);
    if (next.every((r) => !r.email.trim() || r.status === "sent")) setStep(3);
  }

  const hasUnsentInvites = rows.some((r) => r.email.trim() && r.status !== "sent");

  return (
    <div className="relative flex min-h-screen flex-col overflow-hidden bg-gradient-to-b from-indigo-50 via-white to-violet-50 dark:from-indigo-950/40 dark:via-background dark:to-violet-950/30">
      <div
        aria-hidden="true"
        className="pointer-events-none absolute -top-32 -left-32 size-96 rounded-full bg-indigo-300/30 blur-3xl"
      />
      <div
        aria-hidden="true"
        className="pointer-events-none absolute -right-32 -bottom-32 size-96 rounded-full bg-violet-300/30 blur-3xl"
      />

      <header className="relative flex items-center justify-between px-5 py-4 sm:px-8">
        <div className="flex items-center gap-2.5">
          <span className="flex size-9 items-center justify-center rounded-xl bg-gradient-to-br from-indigo-600 to-violet-600 text-base font-bold text-white shadow-md shadow-indigo-600/25">
            U
          </span>
          <div className="leading-tight">
            <p className="text-sm font-semibold">Unified Inbox</p>
            <p className="text-muted-foreground text-xs">Omnichannel workspace</p>
          </div>
        </div>
        <Button variant="ghost" size="sm" onClick={() => void signOut()} className="gap-1.5">
          <LogOut className="size-3.5" /> Sign out
        </Button>
      </header>

      <main className="relative mx-auto flex w-full max-w-xl flex-1 flex-col px-5 pt-6 pb-16 sm:pt-10">
        {/* Stepper */}
        <ol className="flex items-start" aria-label="Onboarding progress">
          {STEPS.map((s, i) => {
            const done = step > s.n;
            const current = step === s.n;
            return (
              <li key={s.n} className={cn("flex items-start", i > 0 && "flex-1")}>
                {i > 0 ? (
                  <span
                    aria-hidden="true"
                    className={cn(
                      "mx-2 mt-4 h-0.5 flex-1 rounded-full transition-colors sm:mx-3",
                      step >= s.n ? "bg-indigo-600" : "bg-zinc-200 dark:bg-zinc-700",
                    )}
                  />
                ) : null}
                <span className="flex w-20 flex-col items-center gap-1.5 text-center">
                  <span
                    className={cn(
                      "flex size-9 items-center justify-center rounded-full border-2 transition-colors",
                      done
                        ? "border-indigo-600 bg-indigo-600 text-white"
                        : current
                          ? "border-indigo-600 bg-white text-indigo-600 dark:bg-background"
                          : "border-zinc-300 bg-white text-zinc-400 dark:border-zinc-600 dark:bg-background",
                    )}
                  >
                    {done ? <Check className="size-4" /> : <s.icon className="size-4" />}
                  </span>
                  <span
                    className={cn(
                      "text-xs font-medium",
                      current ? "text-indigo-700 dark:text-indigo-300" : "text-muted-foreground",
                    )}
                  >
                    {s.label}
                  </span>
                </span>
              </li>
            );
          })}
        </ol>
        <div className="mt-4 h-1 overflow-hidden rounded-full bg-zinc-200/70 dark:bg-zinc-700/50">
          <div
            className="h-full rounded-full bg-gradient-to-r from-indigo-600 to-violet-600 transition-all duration-500"
            style={{ width: `${(step / STEPS.length) * 100}%` }}
          />
        </div>

        <div className="mt-8 rounded-3xl border bg-white/90 p-6 shadow-xl shadow-indigo-600/5 backdrop-blur sm:p-8 dark:bg-card">
          {step === 1 ? (
            <>
              <h1 className="text-2xl font-semibold tracking-tight">
                Welcome, {firstName} — let&apos;s set up your inbox
              </h1>
              <p className="text-muted-foreground mt-1.5 text-sm">
                First, create a workspace for your business. Channels, contacts and conversations
                all live inside it, and you&apos;ll be its owner.
              </p>
              <form onSubmit={(e) => void createWorkspace(e)} className="mt-6 flex flex-col gap-4">
                <div className="flex flex-col gap-2">
                  <Label htmlFor="ob-name">Workspace name</Label>
                  <Input
                    id="ob-name"
                    value={wsName}
                    onChange={(e) => setWsName(e.target.value)}
                    placeholder="My Business"
                    required
                    minLength={2}
                    autoFocus
                  />
                </div>
                <div className="flex flex-col gap-2">
                  <Label htmlFor="ob-tz">Timezone</Label>
                  <Input
                    id="ob-tz"
                    value={timezone}
                    onChange={(e) => setTimezone(e.target.value)}
                    required
                  />
                  <p className="text-muted-foreground text-xs">
                    Used for timestamps and reports. We detected yours — change it if needed.
                  </p>
                </div>
                {wsError ? (
                  <p className="text-sm text-red-600" role="alert">
                    {wsError}
                  </p>
                ) : null}
                <Button
                  type="submit"
                  disabled={wsPending || wsName.trim().length < 2}
                  className="mt-1 w-full bg-indigo-600 text-white hover:bg-indigo-700"
                  size="lg"
                >
                  {wsPending ? "Creating…" : "Create workspace"}
                  {!wsPending ? <ArrowRight className="size-4" /> : null}
                </Button>
              </form>
              <p className="text-muted-foreground mt-6 text-center text-xs">
                Were you invited to a workspace instead?{" "}
                <a href="/accept-invite" className="text-indigo-600 underline underline-offset-4">
                  Open your invite link
                </a>
              </p>
            </>
          ) : null}

          {step === 2 ? (
            <>
              <h1 className="text-2xl font-semibold tracking-tight">Invite your team</h1>
              <p className="text-muted-foreground mt-1.5 text-sm">
                We&apos;ll email each person an invitation link. Agents reply to customers, Admins
                manage the workspace, Viewers can only look. You can skip this and invite people
                later from Settings.
              </p>
              <div className="mt-6 flex flex-col gap-3">
                {rows.map((row, i) => (
                  <div key={i} className="flex flex-col gap-1">
                    <div className="flex items-center gap-2">
                      <Input
                        type="email"
                        value={row.email}
                        onChange={(e) => updateRow(i, { email: e.target.value })}
                        placeholder="teammate@example.com"
                        disabled={row.status === "sent" || row.status === "sending"}
                        aria-label={`Invite email ${i + 1}`}
                        className="flex-1"
                      />
                      <Select
                        value={row.role}
                        onValueChange={(v) => updateRow(i, { role: v as InviteRole })}
                        disabled={row.status === "sent" || row.status === "sending"}
                      >
                        <SelectTrigger className="w-28" aria-label={`Role for invite ${i + 1}`}>
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="AGENT">Agent</SelectItem>
                          <SelectItem value="ADMIN">Admin</SelectItem>
                          <SelectItem value="VIEWER">Viewer</SelectItem>
                        </SelectContent>
                      </Select>
                      {row.status === "sent" ? (
                        <span className="flex size-6 shrink-0 items-center justify-center rounded-full bg-emerald-100 text-emerald-700 dark:bg-emerald-500/20 dark:text-emerald-300">
                          <Check className="size-3.5" />
                        </span>
                      ) : null}
                    </div>
                    {row.status === "error" && row.error ? (
                      <p className="text-xs text-red-600">{row.error}</p>
                    ) : null}
                  </div>
                ))}
                {rows.length < 5 ? (
                  <button
                    type="button"
                    onClick={() =>
                      setRows((prev) => [...prev, { email: "", role: "AGENT", status: "idle" }])
                    }
                    className="flex items-center gap-1 self-start text-sm font-medium text-indigo-600 hover:text-indigo-700"
                  >
                    <Plus className="size-4" /> Add another
                  </button>
                ) : null}
              </div>
              <div className="mt-7 flex items-center gap-2">
                <Button variant="ghost" onClick={() => setStep(1)} className="gap-1.5">
                  <ArrowLeft className="size-4" /> Back
                </Button>
                <span className="flex-1" />
                <Button variant="ghost" onClick={() => setStep(3)}>
                  Skip for now
                </Button>
                <Button
                  onClick={() => void sendInvites()}
                  disabled={invitesPending}
                  className="bg-indigo-600 text-white hover:bg-indigo-700"
                >
                  {invitesPending
                    ? "Sending…"
                    : hasUnsentInvites
                      ? "Send invites"
                      : "Continue"}
                  {!invitesPending ? <ArrowRight className="size-4" /> : null}
                </Button>
              </div>
            </>
          ) : null}

          {step === 3 ? (
            <>
              <h1 className="text-2xl font-semibold tracking-tight">Connect your first channel</h1>
              <p className="text-muted-foreground mt-1.5 text-sm">
                Pick a channel to connect now — you&apos;ll finish the connection on the Channels
                page. Or skip and explore the inbox first; channels can be connected any time.
              </p>
              <div className="mt-6 grid gap-3 sm:grid-cols-2">
                {CHANNEL_PICKS.map(({ provider, blurb }) => {
                  const meta = PROVIDER_META[provider];
                  const Icon = meta.icon;
                  return (
                    <button
                      key={provider}
                      type="button"
                      onClick={() => router.push("/channels")}
                      className="group flex flex-col gap-2.5 rounded-2xl border p-4 text-left transition-all hover:-translate-y-0.5 hover:border-indigo-300 hover:shadow-lg hover:shadow-indigo-600/10"
                    >
                      <span
                        className="flex size-10 items-center justify-center rounded-xl"
                        style={{ backgroundColor: `${meta.color}1f`, color: meta.color }}
                      >
                        <Icon className="size-5" />
                      </span>
                      <span>
                        <span className="flex items-center gap-1 text-sm font-semibold">
                          {meta.label}
                          <ArrowRight className="size-3.5 text-indigo-600 opacity-0 transition-opacity group-hover:opacity-100" />
                        </span>
                        <span className="text-muted-foreground mt-0.5 block text-xs">{blurb}</span>
                      </span>
                    </button>
                  );
                })}
              </div>
              <div className="mt-7 flex items-center gap-2">
                <Button variant="ghost" onClick={() => setStep(2)} className="gap-1.5">
                  <ArrowLeft className="size-4" /> Back
                </Button>
                <span className="flex-1" />
                <Button
                  onClick={() => router.push("/dashboard")}
                  className="bg-indigo-600 text-white hover:bg-indigo-700"
                >
                  Go to my inbox <ArrowRight className="size-4" />
                </Button>
              </div>
            </>
          ) : null}
        </div>

        <p className="text-muted-foreground mt-5 text-center text-xs">
          Step {step} of {STEPS.length}
        </p>
      </main>
    </div>
  );
}
