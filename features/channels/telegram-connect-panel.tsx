"use client";

import { Send, TriangleAlert } from "lucide-react";
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
 * Telegram connect/edit dialog (Phase 10). Nothing renders on the
 * page itself — the Channels catalog opens this dialog:
 *
 *  - Connect (catalog "Connect now" / "Connect another bot"): paste
 *    a BotFather bot token. The server validates it against the real
 *    Bot API (getMe) before storing it encrypted and registering the
 *    webhook, so a bad token fails here with Telegram's own verdict.
 *  - Edit (connected list's Reconnect): paste the bot's token again
 *    (or a fresh one from BotFather) — the stored token is replaced
 *    and the webhook re-registered with a new secret. Stored tokens
 *    are never readable, so the field always starts empty.
 *
 * A workspace can connect several bots; each is its own channel.
 */
export function TelegramConnectPanel({
  workspaceId,
  connectedChannels,
  openSignal = 0,
  editSignal = 0,
  editChannelId = null,
}: {
  workspaceId: string;
  connectedChannels: RealChannel[];
  openSignal?: number;
  editSignal?: number;
  editChannelId?: string | null;
}) {
  const router = useRouter();
  const [dialogOpen, setDialogOpen] = useState(false);
  const [mode, setMode] = useState<"connect" | "edit">("connect");
  const [botToken, setBotToken] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [warning, setWarning] = useState<string | null>(null);

  const [handledOpenSignal, setHandledOpenSignal] = useState(openSignal);
  if (openSignal !== handledOpenSignal) {
    setHandledOpenSignal(openSignal);
    if (openSignal > 0) {
      setMode("connect");
      setBotToken("");
      setError(null);
      setWarning(null);
      setDialogOpen(true);
    }
  }
  const [handledEditSignal, setHandledEditSignal] = useState(editSignal);
  if (editSignal !== handledEditSignal) {
    setHandledEditSignal(editSignal);
    if (editSignal > 0 && editChannelId) {
      setMode("edit");
      setBotToken("");
      setError(null);
      setWarning(null);
      setDialogOpen(true);
    }
  }

  const editChannel = connectedChannels.find((channel) => channel.id === editChannelId);

  async function submit() {
    setBusy(true);
    setError(null);
    setWarning(null);
    try {
      const res = await fetch(`/api/workspaces/${workspaceId}/channels/telegram/connect`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ botToken }),
      });
      const body = (await res.json().catch(() => null)) as {
        subscriptionWarning?: string;
        error?: { message?: string };
      } | null;
      if (!res.ok) {
        throw new Error(body?.error?.message ?? `Telegram connect failed (${res.status})`);
      }
      setBotToken("");
      if (body?.subscriptionWarning) {
        setWarning(
          `Connected, but the webhook registration failed: ${body.subscriptionWarning}. Reconnect to try again — messages will not arrive until it succeeds.`,
        );
      } else {
        setDialogOpen(false);
      }
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Telegram connect failed");
    } finally {
      setBusy(false);
    }
  }

  return (
    <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <span className="flex size-8 items-center justify-center rounded-lg bg-[#229ed9]/15 text-[#229ed9]">
              <Send className="size-4" />
            </span>
            {mode === "edit" ? "Reconnect Telegram bot" : "Connect a Telegram bot"}
          </DialogTitle>
          <DialogDescription>
            {mode === "edit"
              ? "Paste the bot token again to replace the stored one — the webhook is re-registered automatically. Stored tokens are never shown."
              : "Telegram bots are created with BotFather — no app review, no fees. The token is validated with Telegram before it is stored, encrypted."}
          </DialogDescription>
        </DialogHeader>

        {mode === "edit" && editChannel ? (
          <p className="rounded-md bg-muted/60 px-3 py-2 text-sm">
            Bot: <strong>{editChannel.displayName}</strong>
          </p>
        ) : null}

        {mode === "connect" ? (
          <ol className="list-decimal space-y-1.5 pl-5 text-sm text-muted-foreground">
            <li>
              In Telegram, open <strong className="text-foreground">@BotFather</strong> and send{" "}
              <code className="text-foreground">/newbot</code>
            </li>
            <li>Pick a display name and a username ending in “bot”</li>
            <li>BotFather replies with a token — paste it below</li>
          </ol>
        ) : null}

        <div className="space-y-2">
          <Label htmlFor="telegram-bot-token">Bot token</Label>
          <Input
            id="telegram-bot-token"
            type="password"
            autoComplete="off"
            placeholder="123456789:AA…"
            value={botToken}
            onChange={(event) => setBotToken(event.target.value)}
          />
          <p className="text-xs text-muted-foreground">
            Customers must message your bot first — Telegram bots cannot start conversations.
            Replies from here can be sent at any time afterwards.
          </p>
        </div>

        {warning ? (
          <p className="flex items-start gap-2 rounded-md bg-amber-50 px-3 py-2 text-sm text-amber-800 dark:bg-amber-500/10 dark:text-amber-200">
            <TriangleAlert className="mt-0.5 size-4 shrink-0" /> {warning}
          </p>
        ) : null}
        {error ? <p className="text-sm text-red-600">{error}</p> : null}

        <div className="flex justify-end gap-2">
          <Button variant="outline" onClick={() => setDialogOpen(false)} disabled={busy}>
            Cancel
          </Button>
          <Button onClick={() => void submit()} disabled={busy || botToken.trim().length < 20}>
            {busy ? "Checking with Telegram…" : mode === "edit" ? "Replace token" : "Connect bot"}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
