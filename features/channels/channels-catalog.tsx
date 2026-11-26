"use client";

import {
  Code2,
  FlaskConical,
  MoreVertical,
  Plug,
  PlugZap,
  RefreshCw,
  Settings,
  Trash2,
  TriangleAlert,
  Unplug,
} from "lucide-react";
import { useRouter } from "next/navigation";
import { useState } from "react";

import { ChannelIcon, PROVIDER_META, PROVIDER_ORDER } from "@/components/channel-icon";
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
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { MetaConnectionPanel } from "@/features/channels/meta-connection-panel";
import { TelegramConnectPanel } from "@/features/channels/telegram-connect-panel";
import { WebsiteConnectPanel } from "@/features/channels/website-connect-panel";
import {
  WhatsAppConnectPanel,
  type WhatsAppConfigView,
} from "@/features/channels/whatsapp-connect-panel";
import { WhatsAppTemplatesPanel } from "@/features/channels/whatsapp-templates-panel";
import type { Provider } from "@/generated/prisma/client";
import { cn } from "@/lib/utils";

/** Client-safe subset of Channel.config (never contains tokens). */
export interface RealChannelConfig {
  lastError?: string;
  lastErrorAt?: string;
  username?: string;
  websiteUrl?: string;
  widgetColor?: string;
  welcomeTitle?: string;
  welcomeTagline?: string;
  preChatForm?: boolean;
  displayPhoneNumber?: string;
  verifiedName?: string;
  connectionMethod?: string;
  wabaId?: string;
  qualityRating?: string;
  webhookSubscription?: { status?: string; error?: string };
}

export interface RealChannel {
  id: string;
  provider: Provider;
  displayName: string;
  status: string;
  config?: RealChannelConfig;
  externalAccountId?: string;
  /** ISO timestamp of the last channel-row update — shown as "Last connected". */
  updatedAt?: string;
}

/** Provider sublabels for the connected-accounts list (reference design). */
const CONNECTED_SUBLABELS: Partial<Record<Provider, string>> = {
  FACEBOOK: "Facebook Messenger",
  WEBSITE: "Website live chat",
  WHATSAPP: "WhatsApp Business",
};

/** Public Meta setup facts (no secrets) passed from the server page. */
export interface MetaConfigView {
  facebookConfigured: boolean;
  instagramConfigured: boolean;
  facebookRedirectUri: string;
  instagramRedirectUri: string;
  facebookWebhookUrl: string;
  instagramWebhookUrl: string;
}

/**
 * Public TikTok setup facts (no secrets). TikTok Business Messaging is
 * access-gated by TikTok (Phase 7): `configured` only says whether the
 * developer app credentials exist in env — it never means messaging
 * access has been granted.
 */
export interface TikTokConfigView {
  configured: boolean;
  redirectUri: string;
  webhookUrl: string;
}


/**
 * Public Gmail setup facts (no secrets). Gmail is self-serve via a
 * Google Cloud OAuth client (Phase 9): `configured` says whether the
 * OAuth credentials exist in env.
 */
export interface GmailConfigView {
  configured: boolean;
  redirectUri: string;
}

export function ChannelsCatalog({
  realChannels,
  workspaceId,
  mockEnabled = false,
  metaConfig,
  metaSession,
  metaError,
  whatsappConfig,
  tiktokConfig,
  gmailConfig,
  gmailConnected,
  gmailError,
}: {
  realChannels: RealChannel[];
  workspaceId?: string;
  mockEnabled?: boolean;
  metaConfig?: MetaConfigView;
  metaSession?: { id: string; provider: "facebook" | "instagram" } | null;
  metaError?: string | null;
  whatsappConfig?: WhatsAppConfigView;
  tiktokConfig?: TikTokConfigView;
  gmailConfig?: GmailConfigView;
  gmailConnected?: string | null;
  gmailError?: string | null;
}) {
  const router = useRouter();
  const [selected, setSelected] = useState<Provider | null>(null);
  const [mockBusy, setMockBusy] = useState(false);
  const [mockError, setMockError] = useState<string | null>(null);
  const [disconnectingId, setDisconnectingId] = useState<string | null>(null);
  const [disconnectError, setDisconnectError] = useState<string | null>(null);
  const [waConnectSignal, setWaConnectSignal] = useState(0);
  const [waEditSignal, setWaEditSignal] = useState(0);
  const [waEditChannelId, setWaEditChannelId] = useState<string | null>(null);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [deleteError, setDeleteError] = useState<string | null>(null);
  const [disconnectTarget, setDisconnectTarget] = useState<RealChannel | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<RealChannel | null>(null);

  function openWhatsAppConnect() {
    setWaConnectSignal((signal) => signal + 1);
  }

  function openWhatsAppEdit(channelId: string) {
    setWaEditChannelId(channelId);
    setWaEditSignal((signal) => signal + 1);
  }

  const [tgConnectSignal, setTgConnectSignal] = useState(0);
  const [tgEditSignal, setTgEditSignal] = useState(0);
  const [tgEditChannelId, setTgEditChannelId] = useState<string | null>(null);

  function openTelegramConnect() {
    setTgConnectSignal((signal) => signal + 1);
  }

  function openTelegramEdit(channelId: string) {
    setTgEditChannelId(channelId);
    setTgEditSignal((signal) => signal + 1);
  }

  const [webCreateSignal, setWebCreateSignal] = useState(0);
  const [webEditSignal, setWebEditSignal] = useState(0);
  const [webEditChannelId, setWebEditChannelId] = useState<string | null>(null);
  const [webSnippetSignal, setWebSnippetSignal] = useState(0);
  const [webSnippetChannelId, setWebSnippetChannelId] = useState<string | null>(null);

  function openWebsiteCreate() {
    setWebCreateSignal((signal) => signal + 1);
  }

  function openWebsiteEdit(channelId: string) {
    setWebEditChannelId(channelId);
    setWebEditSignal((signal) => signal + 1);
  }

  function openWebsiteSnippet(channelId: string) {
    setWebSnippetChannelId(channelId);
    setWebSnippetSignal((signal) => signal + 1);
  }
  const connectedCount = realChannels.filter((c) => c.status === "CONNECTED").length;
  const connectedProviders = new Set(
    realChannels.filter((c) => c.status === "CONNECTED").map((c) => c.provider),
  );
  const mockConnected = connectedProviders.has("MOCK");

  async function confirmDisconnect() {
    const channel = disconnectTarget;
    if (!workspaceId || !channel) return;
    setDisconnectingId(channel.id);
    setDisconnectError(null);
    try {
      const res = await fetch(`/api/workspaces/${workspaceId}/channels/${channel.id}`, {
        method: "DELETE",
      });
      if (!res.ok) {
        const body = (await res.json().catch(() => null)) as {
          error?: { message?: string };
        } | null;
        throw new Error(body?.error?.message ?? `Disconnect failed (${res.status})`);
      }
      router.refresh();
    } catch (error) {
      setDisconnectError(error instanceof Error ? error.message : "Could not disconnect");
    } finally {
      setDisconnectingId(null);
      setDisconnectTarget(null);
    }
  }

  async function confirmDelete() {
    const channel = deleteTarget;
    if (!workspaceId || !channel) return;
    setDeletingId(channel.id);
    setDeleteError(null);
    try {
      const res = await fetch(
        `/api/workspaces/${workspaceId}/channels/${channel.id}?permanent=true`,
        { method: "DELETE" },
      );
      if (!res.ok) {
        const body = (await res.json().catch(() => null)) as {
          error?: { message?: string };
        } | null;
        throw new Error(body?.error?.message ?? `Delete failed (${res.status})`);
      }
      router.refresh();
    } catch (error) {
      setDeleteError(error instanceof Error ? error.message : "Could not delete the channel");
    } finally {
      setDeletingId(null);
      setDeleteTarget(null);
    }
  }

  async function connectMock() {
    if (!workspaceId) return;
    setMockBusy(true);
    setMockError(null);
    try {
      const res = await fetch(`/api/workspaces/${workspaceId}/channels/mock-connect`, {
        method: "POST",
      });
      if (!res.ok) {
        const body = (await res.json().catch(() => null)) as {
          error?: { message?: string };
        } | null;
        throw new Error(body?.error?.message ?? `Request failed (${res.status})`);
      }
      router.refresh();
    } catch (error) {
      setMockError(error instanceof Error ? error.message : "Could not connect the mock channel");
    } finally {
      setMockBusy(false);
    }
  }

  return (
    <div className="flex w-full flex-col gap-8">
      {/* Hero — gradient block (restored at Jeet's request,
          2026-11-26; the light Connected Accounts panel was reverted). */}
      <section className="relative overflow-hidden rounded-3xl bg-gradient-to-br from-indigo-600 via-violet-600 to-fuchsia-600 px-6 py-8 text-white sm:px-8">
        <div
          aria-hidden
          className="pointer-events-none absolute -top-24 -right-16 size-64 rounded-full bg-white/10 blur-2xl"
        />
        <div
          aria-hidden
          className="pointer-events-none absolute -bottom-28 left-1/3 size-56 rounded-full bg-fuchsia-300/20 blur-3xl"
        />
        <div className="relative flex flex-wrap items-end justify-between gap-4">
          <div className="max-w-xl">
            <p className="flex items-center gap-2 text-xs font-semibold tracking-widest text-indigo-100 uppercase">
              <PlugZap className="size-4" /> Channels
            </p>
            <h2 className="pt-2 text-3xl font-bold tracking-tight">
              Every conversation, one inbox
            </h2>
            <p className="pt-2 text-sm leading-relaxed text-indigo-100">
              Connect your messaging accounts and reply to customers from a single place.
              Messenger and Instagram connect through Meta&apos;s official sign-in — you
              always approve access on the platform itself.
            </p>
          </div>
          <div className="flex items-center gap-2">
            <span className="inline-flex items-center gap-1.5 rounded-full bg-white/15 px-3 py-1.5 text-sm font-medium ring-1 ring-white/25 backdrop-blur">
              <span className="relative flex size-2">
                <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-emerald-300 opacity-75" />
                <span className="relative inline-flex size-2 rounded-full bg-emerald-300" />
              </span>
              {connectedCount} connected
            </span>
            <span className="inline-flex items-center rounded-full bg-white/15 px-3 py-1.5 text-sm font-medium ring-1 ring-white/25 backdrop-blur">
              {PROVIDER_ORDER.length} channels available
            </span>
          </div>
        </div>
      </section>

      {metaError ? (
        <p className="flex items-start gap-2 rounded-md bg-red-50 p-3 text-sm text-red-700">
          <TriangleAlert className="mt-0.5 size-4 shrink-0" />
          Meta connection failed: {metaError}
        </p>
      ) : null}

      {gmailError ? (
        <p className="flex items-start gap-2 rounded-md bg-red-50 p-3 text-sm text-red-700">
          <TriangleAlert className="mt-0.5 size-4 shrink-0" />
          Gmail connection failed: {gmailError}
        </p>
      ) : null}

      {gmailConnected ? (
        <p className="rounded-md bg-green-50 p-3 text-sm text-green-700">
          Gmail connected: <strong>{gmailConnected}</strong>. New mail will appear in the unified
          inbox within about a minute.
        </p>
      ) : null}

      {metaSession && workspaceId ? (
        <MetaConnectionPanel
          workspaceId={workspaceId}
          sessionId={metaSession.id}
          provider={metaSession.provider}
        />
      ) : null}

      {whatsappConfig && workspaceId ? (
        <WhatsAppConnectPanel
          workspaceId={workspaceId}
          whatsappConfig={whatsappConfig}
          connectedChannels={realChannels}
          openSignal={waConnectSignal}
          editSignal={waEditSignal}
          editChannelId={waEditChannelId}
        />
      ) : null}

      {workspaceId ? (
        <WhatsAppTemplatesPanel workspaceId={workspaceId} connectedChannels={realChannels} />
      ) : null}

      {workspaceId ? (
        <TelegramConnectPanel
          workspaceId={workspaceId}
          connectedChannels={realChannels}
          openSignal={tgConnectSignal}
          editSignal={tgEditSignal}
          editChannelId={tgEditChannelId}
        />
      ) : null}

      {workspaceId ? (
        <WebsiteConnectPanel
          workspaceId={workspaceId}
          connectedChannels={realChannels}
          createSignal={webCreateSignal}
          editSignal={webEditSignal}
          editChannelId={webEditChannelId}
          snippetSignal={webSnippetSignal}
          snippetChannelId={webSnippetChannelId}
        />
      ) : null}

      <AlertDialog
        open={disconnectTarget !== null}
        onOpenChange={(open) => {
          if (!open && disconnectingId === null) setDisconnectTarget(null);
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Disconnect {disconnectTarget?.displayName}?</AlertDialogTitle>
            <AlertDialogDescription>
              The stored access token will be deleted and messages will stop arriving.
              Conversation history is kept.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={disconnectingId !== null}>Cancel</AlertDialogCancel>
            <AlertDialogAction
              disabled={disconnectingId !== null}
              onClick={(event) => {
                event.preventDefault();
                void confirmDisconnect();
              }}
            >
              {disconnectingId !== null ? "Disconnecting…" : "Disconnect"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <AlertDialog
        open={deleteTarget !== null}
        onOpenChange={(open) => {
          if (!open && deletingId === null) setDeleteTarget(null);
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete {deleteTarget?.displayName} permanently?</AlertDialogTitle>
            <AlertDialogDescription>
              This removes the channel AND all of its conversations and messages from this
              workspace. This cannot be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={deletingId !== null}>Cancel</AlertDialogCancel>
            <AlertDialogAction
              className="bg-destructive text-white hover:bg-destructive/90"
              disabled={deletingId !== null}
              onClick={(event) => {
                event.preventDefault();
                void confirmDelete();
              }}
            >
              {deletingId !== null ? "Deleting…" : "Delete permanently"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {mockEnabled && workspaceId ? (
        <Card className="border-dashed">
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <FlaskConical className="size-5 text-zinc-500" />
              Mock channel — dev only
              <Badge variant={mockConnected ? "success" : "muted"}>
                {mockConnected ? "Connected" : "Not connected"}
              </Badge>
            </CardTitle>
            <CardDescription>
              Simulated channel for development and testing. It is <strong>not</strong> a real
              platform — no external account is connected and no real social messages are sent or
              received. Use it to exercise the inbox, queues and realtime end-to-end, e.g. with{" "}
              <code>npm run simulate:inbound</code>.
            </CardDescription>
          </CardHeader>
          <CardContent className="flex flex-col items-start gap-2">
            <Button variant="outline" onClick={() => void connectMock()} disabled={mockBusy}>
              {mockBusy
                ? "Connecting…"
                : mockConnected
                  ? "Reconnect mock channel (dev only)"
                  : "Connect mock channel (dev only)"}
            </Button>
            {mockError ? <p className="text-sm text-red-600">{mockError}</p> : null}
          </CardContent>
        </Card>
      ) : null}

      {realChannels.length > 0 ? (
        <section>
          <Card className="overflow-hidden py-0">
            <ul className="divide-y">
              {realChannels.map((channel) => {
                const meta = PROVIDER_META[channel.provider];
                const oauthHref =
                  channel.provider === "FACEBOOK" && metaConfig?.facebookConfigured && workspaceId
                    ? `/api/workspaces/${workspaceId}/channels/facebook/connect`
                    : channel.provider === "INSTAGRAM" &&
                        metaConfig?.instagramConfigured &&
                        workspaceId
                      ? `/api/workspaces/${workspaceId}/channels/instagram/connect`
                      : channel.provider === "GMAIL" && gmailConfig?.configured && workspaceId
                        ? `/api/workspaces/${workspaceId}/channels/gmail/connect`
                        : null;
                const hasReconnect =
                  oauthHref !== null ||
                  channel.provider === "WHATSAPP" ||
                  channel.provider === "TELEGRAM";
                const openReconnect = () => {
                  if (channel.provider === "WHATSAPP") openWhatsAppEdit(channel.id);
                  else if (channel.provider === "TELEGRAM") openTelegramEdit(channel.id);
                };
                const statusLabel =
                  channel.status === "CONNECTED"
                    ? "Connected"
                    : channel.status === "DISCONNECTED"
                      ? "Disconnected"
                      : channel.status === "EXPIRED"
                        ? "Expired"
                        : channel.status === "ERROR"
                          ? "Error"
                          : channel.status;
                return (
                  <li
                    key={channel.id}
                    className="flex flex-wrap items-center gap-x-4 gap-y-3 px-5 py-4 transition-colors hover:bg-muted/40"
                  >
                    <div className="flex min-w-0 flex-1 items-center gap-3.5">
                      <span
                        className="flex size-12 shrink-0 items-center justify-center rounded-xl"
                        style={{ backgroundColor: `${meta.color}1a` }}
                      >
                        <ChannelIcon provider={channel.provider} size="md" />
                      </span>
                      <span className="min-w-0 leading-tight">
                        <span className="block truncate text-[15px] font-semibold">
                          {channel.displayName}
                        </span>
                        <span className="text-muted-foreground block pt-0.5 text-[13px]">
                          {CONNECTED_SUBLABELS[channel.provider] ?? meta.label}
                          {channel.config?.displayPhoneNumber
                            ? ` · ${channel.config.displayPhoneNumber}`
                            : ""}
                        </span>
                        {channel.status === "ERROR" && channel.config?.lastError ? (
                          <span className="block pt-0.5 text-xs text-red-600">
                            {channel.config.lastError} Reconnect to fix it.
                          </span>
                        ) : null}
                      </span>
                    </div>

                    <Badge
                      variant={
                        channel.status === "CONNECTED"
                          ? "success"
                          : channel.status === "ERROR"
                            ? "destructive"
                            : channel.status === "EXPIRED"
                              ? "warning"
                              : "muted"
                      }
                      className="gap-1.5"
                    >
                      <span
                        className={cn(
                          "size-1.5 rounded-full",
                          channel.status === "CONNECTED"
                            ? "bg-emerald-500"
                            : channel.status === "ERROR"
                              ? "bg-white"
                              : channel.status === "EXPIRED"
                                ? "bg-amber-500"
                                : "bg-zinc-400",
                        )}
                      />
                      {statusLabel}
                    </Badge>

                    <DropdownMenu>
                      <DropdownMenuTrigger asChild>
                        <Button
                          variant="ghost"
                          size="icon"
                          className="size-8 shrink-0"
                          aria-label={`Actions for ${channel.displayName}`}
                        >
                          <MoreVertical className="size-4" />
                        </Button>
                      </DropdownMenuTrigger>
                      <DropdownMenuContent align="end" className="w-48">
                        {channel.provider === "WEBSITE" && workspaceId ? (
                          <>
                            <DropdownMenuItem onClick={() => openWebsiteSnippet(channel.id)}>
                              <Code2 /> Embed code
                            </DropdownMenuItem>
                            <DropdownMenuItem onClick={() => openWebsiteEdit(channel.id)}>
                              <Settings /> Settings
                            </DropdownMenuItem>
                          </>
                        ) : null}
                        {channel.status === "CONNECTED" && hasReconnect ? (
                          oauthHref ? (
                            <DropdownMenuItem asChild>
                              <a href={oauthHref}>
                                <RefreshCw /> Reconnect
                              </a>
                            </DropdownMenuItem>
                          ) : (
                            <DropdownMenuItem onClick={openReconnect}>
                              <RefreshCw /> Reconnect
                            </DropdownMenuItem>
                          )
                        ) : null}
                        {channel.status !== "CONNECTED" && hasReconnect ? (
                          oauthHref ? (
                            <DropdownMenuItem asChild>
                              <a href={oauthHref}>
                                <Plug />{" "}
                                {channel.status === "DISCONNECTED" ? "Connect" : "Reconnect"}
                              </a>
                            </DropdownMenuItem>
                          ) : (
                            <DropdownMenuItem onClick={openReconnect}>
                              <Plug />{" "}
                              {channel.status === "DISCONNECTED" ? "Connect" : "Reconnect"}
                            </DropdownMenuItem>
                          )
                        ) : null}
                        {channel.status === "CONNECTED" ? (
                          <DropdownMenuItem
                            onClick={() => setDisconnectTarget(channel)}
                            disabled={disconnectingId !== null}
                          >
                            <Unplug /> Disconnect
                          </DropdownMenuItem>
                        ) : null}
                        <DropdownMenuSeparator />
                        <DropdownMenuItem
                          variant="destructive"
                          onClick={() => setDeleteTarget(channel)}
                          disabled={deletingId !== null}
                        >
                          <Trash2 /> Delete
                        </DropdownMenuItem>
                      </DropdownMenuContent>
                    </DropdownMenu>

                  </li>
                );
              })}
            </ul>
            {disconnectError ? (
              <p className="px-5 pb-3 text-sm text-red-600">{disconnectError}</p>
            ) : null}
            {deleteError ? <p className="px-5 pb-3 text-sm text-red-600">{deleteError}</p> : null}
          </Card>
        </section>
      ) : null}

      <section id="all-channels" className="flex scroll-mt-6 flex-col gap-3">
        <div>
          <h3 className="text-base font-semibold tracking-tight">All channels</h3>
          <p className="text-muted-foreground pt-0.5 text-xs">
            Pick a platform to connect it to this workspace.
          </p>
        </div>
        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
          {PROVIDER_ORDER.map((provider) => {
            const meta = PROVIDER_META[provider];
            const isConnected = connectedProviders.has(provider);
            return (
              <Card
                key={provider}
                className={cn(
                  "group gap-0 overflow-hidden py-0 transition duration-300 hover:border-indigo-300 dark:hover:border-indigo-500/40",
                  isConnected && "ring-2 ring-emerald-400/50",
                )}
              >
                <div
                  className="relative flex h-24 items-center justify-center"
                  style={{
                    background: `linear-gradient(135deg, ${meta.color}30 0%, ${meta.color}0f 70%)`,
                  }}
                >
                  <span className="rounded-full ring-4 ring-white/70 transition duration-300 group-hover:scale-110">
                    <ChannelIcon provider={provider} size="lg" />
                  </span>
                  <span className="absolute top-3 right-3">
                    {provider === "TIKTOK" && !isConnected ? (
                      <Badge variant="warning" className="bg-white/85 backdrop-blur">
                        Access restricted by TikTok
                      </Badge>
                    ) : (
                      <Badge
                        variant={isConnected ? "success" : "muted"}
                        className="gap-1.5 bg-white/85 backdrop-blur"
                      >
                        <span
                          className={cn(
                            "size-1.5 rounded-full",
                            isConnected ? "bg-emerald-500" : "bg-zinc-400",
                          )}
                        />
                        {isConnected ? "Connected" : "Not connected"}
                      </Badge>
                    )}
                  </span>
                </div>
                <div className="flex flex-1 flex-col items-center gap-1.5 px-5 pt-4 pb-5 text-center">
                  <p className="text-[15px] font-semibold tracking-tight">{meta.label}</p>
                  <p className="text-muted-foreground line-clamp-2 min-h-10 text-[13px] leading-snug">
                    {meta.description}
                  </p>
                  <p className="text-muted-foreground/80 pb-2 text-[11px] font-medium tracking-wide uppercase">
                    {meta.phase}
                  </p>
                  {provider === "TIKTOK" ? (
                    <Button variant="outline" className="w-full" onClick={() => setSelected(provider)}>
                      Access requirements
                    </Button>
                  ) : provider === "GMAIL" && gmailConfig?.configured && workspaceId && !isConnected ? (
                    <Button className="w-full" asChild>
                      <a href={`/api/workspaces/${workspaceId}/channels/gmail/connect`}>
                        Connect now
                      </a>
                    </Button>
                  ) : provider === "GMAIL" && isConnected ? (
                    <Button variant="outline" className="w-full" disabled>
                      Mailbox connected
                    </Button>
                  ) : provider === "WHATSAPP" && workspaceId && !isConnected ? (
                    <Button className="w-full" onClick={openWhatsAppConnect}>
                      Connect now
                    </Button>
                  ) : provider === "WHATSAPP" && isConnected ? (
                    <Button variant="outline" className="w-full" disabled>
                      Number connected
                    </Button>
                  ) : provider === "TELEGRAM" && workspaceId && !isConnected ? (
                    <Button className="w-full" onClick={openTelegramConnect}>
                      Connect now
                    </Button>
                  ) : provider === "TELEGRAM" && workspaceId && isConnected ? (
                    <Button variant="outline" className="w-full" onClick={openTelegramConnect}>
                      Connect another bot
                    </Button>
                  ) : provider === "WEBSITE" && workspaceId && !isConnected ? (
                    <Button className="w-full" onClick={openWebsiteCreate}>
                      Add to your website
                    </Button>
                  ) : provider === "WEBSITE" && workspaceId && isConnected ? (
                    <Button variant="outline" className="w-full" onClick={openWebsiteCreate}>
                      Add another website
                    </Button>
                  ) : provider === "FACEBOOK" && metaConfig?.facebookConfigured && workspaceId ? (
                    <Button className="w-full" asChild>
                      <a href={`/api/workspaces/${workspaceId}/channels/facebook/connect`}>
                        Connect now
                      </a>
                    </Button>
                  ) : provider === "INSTAGRAM" && metaConfig?.instagramConfigured && workspaceId ? (
                    <Button className="w-full" asChild>
                      <a href={`/api/workspaces/${workspaceId}/channels/instagram/connect`}>
                        Connect now
                      </a>
                    </Button>
                  ) : (
                    <Button
                      variant={isConnected ? "outline" : "default"}
                      className="w-full"
                      onClick={() => setSelected(provider)}
                    >
                      Connect now
                    </Button>
                  )}
                </div>
              </Card>
            );
          })}
        </div>
      </section>

      <Dialog open={selected !== null} onOpenChange={(open) => !open && setSelected(null)}>
        <DialogContent>
          {selected === "FACEBOOK" && metaConfig ? (
            <>
              <DialogHeader>
                <DialogTitle className="flex items-center gap-3">
                  <ChannelIcon provider="FACEBOOK" size="md" />
                  Connect Facebook Messenger
                </DialogTitle>
                <DialogDescription>
                  This deployment is not configured for Meta yet — no account can be connected until
                  the server environment is set up. Nothing has been connected.
                </DialogDescription>
              </DialogHeader>
              <div className="flex flex-col gap-3 text-sm">
                <p>
                  Set these environment variables on the server and restart the app:{" "}
                  <code>META_APP_ID</code>, <code>META_APP_SECRET</code>,{" "}
                  <code>META_WEBHOOK_VERIFY_TOKEN</code>.
                </p>
                <p>
                  In the Meta app, register this OAuth redirect URI (Facebook Login → Valid OAuth
                  Redirect URIs):
                  <br />
                  <code className="break-all">{metaConfig.facebookRedirectUri}</code>
                </p>
                <p>
                  Webhook callback URL:{" "}
                  <code className="break-all">{metaConfig.facebookWebhookUrl}</code> (verify token =
                  your <code>META_WEBHOOK_VERIFY_TOKEN</code>).
                </p>
                <p className="text-muted-foreground">
                  Note: connecting Pages you don&apos;t administer requires Meta App Review
                  (Advanced Access for pages_messaging, pages_manage_metadata,
                  pages_read_engagement, pages_show_list) and Business Verification. In Development
                  mode only Pages of users with a role on the app can connect. See
                  docs/META-APP-REVIEW.md.
                </p>
              </div>
            </>
          ) : selected === "INSTAGRAM" && metaConfig ? (
            <>
              <DialogHeader>
                <DialogTitle className="flex items-center gap-3">
                  <ChannelIcon provider="INSTAGRAM" size="md" />
                  Connect Instagram
                </DialogTitle>
                <DialogDescription>
                  This deployment is not configured for Instagram yet — no account can be connected
                  until the server environment is set up. Nothing has been connected.
                </DialogDescription>
              </DialogHeader>
              <div className="flex flex-col gap-3 text-sm">
                <p>
                  This app connects Instagram through <strong>Facebook Login</strong> — the only
                  option Meta offers newer apps (Instagram Login is no longer available to them).
                  Set these environment variables on the server and restart the app:{" "}
                  <code>META_APP_ID</code>, <code>META_APP_SECRET</code> — the same Meta app
                  credentials used for Facebook; no separate Instagram credentials exist.{" "}
                  <code>INSTAGRAM_WEBHOOK_VERIFY_TOKEN</code> is optional and falls back to{" "}
                  <code>META_WEBHOOK_VERIFY_TOKEN</code>.
                </p>
                <p>
                  In Facebook Login for Business settings, register this OAuth redirect URI:
                  <br />
                  <code className="break-all">{metaConfig.instagramRedirectUri}</code>
                </p>
                <p>
                  Webhook callback URL:{" "}
                  <code className="break-all">{metaConfig.instagramWebhookUrl}</code>.
                </p>
                <p className="text-muted-foreground">
                  The Instagram account must be a professional (Business/Creator) account{" "}
                  <em>linked to a Facebook Page you manage</em> — after logging in with Facebook
                  you pick which Page&apos;s Instagram account to connect. Messaging accounts
                  beyond users with a role on the app requires Advanced Access for
                  instagram_manage_messages via App Review. See docs/META-APP-REVIEW.md.
                </p>
              </div>
            </>
          ) : selected === "TIKTOK" && tiktokConfig ? (
            <>
              <DialogHeader>
                <DialogTitle className="flex items-center gap-3">
                  <ChannelIcon provider="TIKTOK" size="md" />
                  TikTok — access restricted by TikTok
                </DialogTitle>
                <DialogDescription>
                  TikTok&apos;s Business Messaging API is not self-serve. No TikTok account can be
                  connected here yet, and no messages will be sent or received — this is a
                  restriction on TikTok&apos;s side, not a missing setting.
                </DialogDescription>
              </DialogHeader>
              <div className="flex flex-col gap-3 text-sm">
                <p>
                  Before any TikTok account can connect, TikTok must approve <em>this app</em>{" "}
                  through its <strong>Data Security &amp; Privacy Review</strong> — a manual,
                  company-level review started from TikTok&apos;s intake form (TikTok begins
                  processing within ~10 working days). Serving accounts signed up in the US also
                  requires the <strong>US Data Security Review</strong> and a signed USDS
                  Addendum. Until TikTok approves us, its API rejects messaging calls even for
                  accounts that authorize the app.
                </p>
                <p>
                  Even after approval, only TikTok accounts with <strong>Advanced Access</strong>{" "}
                  or <strong>Verified Business Account</strong> status can use Business
                  Messaging, and accounts signed up in the EEA, Switzerland or the UK are not
                  supported at all.
                </p>
                <p>
                  {tiktokConfig.configured ? (
                    <>
                      This deployment <strong>does</strong> have TikTok developer credentials
                      configured (<code>TIKTOK_CLIENT_KEY</code> /{" "}
                      <code>TIKTOK_CLIENT_SECRET</code>) — credentials alone do not grant access;
                      TikTok&apos;s review approval is still required before connecting is
                      possible.
                    </>
                  ) : (
                    <>
                      This deployment does not yet have TikTok developer credentials configured (
                      <code>TIKTOK_CLIENT_KEY</code>, <code>TIKTOK_CLIENT_SECRET</code>) — and
                      credentials alone would not grant access either; TikTok&apos;s review
                      approval is the real gate.
                    </>
                  )}
                </p>
                <p>
                  For the future application, register this OAuth redirect URI in the TikTok
                  developer app:
                  <br />
                  <code className="break-all">{tiktokConfig.redirectUri}</code>
                </p>
                <p>
                  Webhook callback URL:{" "}
                  <code className="break-all">{tiktokConfig.webhookUrl}</code>
                </p>
                <p className="text-muted-foreground">
                  Full step-by-step approval guide: docs/TIKTOK-ACCESS.md. Research and sources:
                  docs/TIKTOK-RESEARCH.md.
                </p>
              </div>
            </>
          ) : selected === "GMAIL" && gmailConfig ? (
            <>
              <DialogHeader>
                <DialogTitle className="flex items-center gap-3">
                  <ChannelIcon provider="GMAIL" size="md" />
                  Connect Gmail
                </DialogTitle>
                <DialogDescription>
                  This deployment is not configured for Gmail yet — no mailbox can be connected
                  until the server environment is set up. Nothing has been connected.
                </DialogDescription>
              </DialogHeader>
              <div className="flex flex-col gap-3 text-sm">
                <p>
                  Gmail connects through Google&apos;s official OAuth sign-in: create a Google
                  Cloud project, enable the <strong>Gmail API</strong>, configure the OAuth
                  consent screen, and create a <strong>Web application</strong> OAuth client.
                </p>
                <p>
                  Set these environment variables on the server and restart the app:{" "}
                  <code>GOOGLE_CLIENT_ID</code>, <code>GOOGLE_CLIENT_SECRET</code> — the OAuth
                  client credentials (on the web app AND the worker, which polls for new mail
                  and sends replies).
                </p>
                <p>
                  On the OAuth client, register this Authorized redirect URI (exact match
                  required):
                  <br />
                  <code className="break-all">{gmailConfig.redirectUri}</code>
                </p>
                <p className="text-muted-foreground">
                  Each workspace connects its own mailbox (scope: read, compose and send mail).
                  New mail polls in about once a minute and email has no reply window. While the
                  Google consent screen is in Testing mode only listed test users can connect and
                  refresh tokens expire after 7 days; publishing the app (with Google&apos;s
                  OAuth verification for Gmail scopes) is required before selling it publicly.
                  Full setup: docs/GMAIL-SETUP.md.
                </p>
              </div>
            </>
          ) : selected ? (
            <>
              <DialogHeader>
                <DialogTitle className="flex items-center gap-3">
                  <ChannelIcon provider={selected} size="md" />
                  Connect {PROVIDER_META[selected].label}
                </DialogTitle>
                <DialogDescription>
                  This integration is not live yet — it arrives in{" "}
                  <strong>{PROVIDER_META[selected].phase}</strong> of the build plan. No account has
                  been connected and no messages will be sent or received until the adapter ships
                  and you complete its sign-in flow here.
                </DialogDescription>
              </DialogHeader>
              <p className="text-muted-foreground text-sm">
                When it lands, connecting will open the provider&apos;s official authorization flow,
                store its tokens encrypted, and start delivering conversations into your inbox in
                real time.
              </p>
            </>
          ) : null}
        </DialogContent>
      </Dialog>
    </div>
  );
}
