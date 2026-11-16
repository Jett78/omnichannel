"use client";

import { FlaskConical, TriangleAlert } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState } from "react";

import { ChannelIcon, PROVIDER_META, PROVIDER_ORDER } from "@/components/channel-icon";
import { PageHeader } from "@/components/layout/page-header";
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
import { MetaConnectionPanel } from "@/features/channels/meta-connection-panel";
import {
  WhatsAppConnectPanel,
  type WhatsAppConfigView,
} from "@/features/channels/whatsapp-connect-panel";
import type { Provider } from "@/generated/prisma/client";

/** Client-safe subset of Channel.config (never contains tokens). */
export interface RealChannelConfig {
  displayPhoneNumber?: string;
  verifiedName?: string;
  connectionMethod?: string;
  qualityRating?: string;
  webhookSubscription?: { status?: string; error?: string };
}

export interface RealChannel {
  id: string;
  provider: Provider;
  displayName: string;
  status: string;
  config?: RealChannelConfig;
}

/** Public Meta setup facts (no secrets) passed from the server page. */
export interface MetaConfigView {
  facebookConfigured: boolean;
  instagramConfigured: boolean;
  facebookRedirectUri: string;
  instagramRedirectUri: string;
  facebookWebhookUrl: string;
  instagramWebhookUrl: string;
}

export function ChannelsCatalog({
  realChannels,
  workspaceId,
  mockEnabled = false,
  metaConfig,
  metaSession,
  metaError,
  whatsappConfig,
}: {
  realChannels: RealChannel[];
  workspaceId?: string;
  mockEnabled?: boolean;
  metaConfig?: MetaConfigView;
  metaSession?: { id: string; provider: "facebook" | "instagram" } | null;
  metaError?: string | null;
  whatsappConfig?: WhatsAppConfigView;
}) {
  const router = useRouter();
  const [selected, setSelected] = useState<Provider | null>(null);
  const [mockBusy, setMockBusy] = useState(false);
  const [mockError, setMockError] = useState<string | null>(null);
  const [disconnectingId, setDisconnectingId] = useState<string | null>(null);
  const [disconnectError, setDisconnectError] = useState<string | null>(null);
  const connectedProviders = new Set(
    realChannels.filter((c) => c.status === "CONNECTED").map((c) => c.provider),
  );
  const mockConnected = connectedProviders.has("MOCK");

  async function disconnectChannel(channel: RealChannel) {
    if (!workspaceId) return;
    if (
      !window.confirm(
        `Disconnect ${channel.displayName}? The stored access token will be deleted and messages will stop arriving. Conversation history is kept.`,
      )
    ) {
      return;
    }
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
    <div className="flex flex-col gap-6">
      <PageHeader
        title="Channels"
        description="Connect a messaging account per provider. Each adapter implements the same IMessagingProvider contract. Facebook Messenger and Instagram connect through Meta's official OAuth flows; the mock channel below is available for development."
      />

      {metaError ? (
        <p className="flex items-start gap-2 rounded-md bg-red-50 p-3 text-sm text-red-700">
          <TriangleAlert className="mt-0.5 size-4 shrink-0" />
          Meta connection failed: {metaError}
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
        />
      ) : null}

      {mockEnabled && workspaceId ? (
        <Card className="border-dashed shadow-none">
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
        <Card className="shadow-none">
          <CardHeader>
            <CardTitle>Connected in this workspace</CardTitle>
            <CardDescription>Channels stored in the database for this workspace.</CardDescription>
          </CardHeader>
          <CardContent>
            <ul className="divide-y">
              {realChannels.map((channel) => (
                <li key={channel.id} className="flex items-center gap-3 py-2.5">
                  <ChannelIcon provider={channel.provider} size="sm" />
                  <span className="flex-1 text-sm font-medium">{channel.displayName}</span>
                  <Badge variant={channel.status === "CONNECTED" ? "success" : "warning"}>
                    {channel.status}
                  </Badge>
                  {(channel.provider === "FACEBOOK" ||
                    channel.provider === "INSTAGRAM" ||
                    channel.provider === "WHATSAPP") &&
                  channel.status === "CONNECTED" ? (
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => void disconnectChannel(channel)}
                      disabled={disconnectingId !== null}
                    >
                      {disconnectingId === channel.id ? "Disconnecting…" : "Disconnect"}
                    </Button>
                  ) : null}
                </li>
              ))}
            </ul>
            {disconnectError ? (
              <p className="pt-2 text-sm text-red-600">{disconnectError}</p>
            ) : null}
          </CardContent>
        </Card>
      ) : null}

      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
        {PROVIDER_ORDER.map((provider) => {
          const meta = PROVIDER_META[provider];
          const isConnected = connectedProviders.has(provider);
          return (
            <Card key={provider} className="items-center text-center shadow-none">
              <CardHeader className="items-center">
                <ChannelIcon provider={provider} size="lg" className="mx-auto" />
                <CardTitle className="pt-1">{meta.label}</CardTitle>
                <CardDescription>{meta.description}</CardDescription>
              </CardHeader>
              <CardContent className="flex flex-col items-center gap-3">
                <Badge variant={isConnected ? "success" : "muted"}>
                  {isConnected ? "Connected" : "Not connected"}
                </Badge>
                {provider === "WHATSAPP" && workspaceId ? (
                  <Button variant="outline" asChild>
                    <a href="#whatsapp-connect">Connect now</a>
                  </Button>
                ) : provider === "FACEBOOK" && metaConfig?.facebookConfigured && workspaceId ? (
                  <Button variant="outline" asChild>
                    <a href={`/api/workspaces/${workspaceId}/channels/facebook/connect`}>
                      Connect now
                    </a>
                  </Button>
                ) : provider === "INSTAGRAM" && metaConfig?.instagramConfigured && workspaceId ? (
                  <Button variant="outline" asChild>
                    <a href={`/api/workspaces/${workspaceId}/channels/instagram/connect`}>
                      Connect now
                    </a>
                  </Button>
                ) : (
                  <Button variant="outline" onClick={() => setSelected(provider)}>
                    Connect now
                  </Button>
                )}
              </CardContent>
            </Card>
          );
        })}
      </div>

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
                  Set these environment variables on the server and restart the app:{" "}
                  <code>INSTAGRAM_APP_ID</code>, <code>INSTAGRAM_APP_SECRET</code> (the Instagram
                  product&apos;s own app id/secret from the Meta dashboard — not the Facebook app
                  secret). <code>INSTAGRAM_WEBHOOK_VERIFY_TOKEN</code> is optional and falls back to{" "}
                  <code>META_WEBHOOK_VERIFY_TOKEN</code>.
                </p>
                <p>
                  In the Meta app&apos;s Instagram product settings, register this OAuth redirect
                  URI:
                  <br />
                  <code className="break-all">{metaConfig.instagramRedirectUri}</code>
                </p>
                <p>
                  Webhook callback URL:{" "}
                  <code className="break-all">{metaConfig.instagramWebhookUrl}</code>.
                </p>
                <p className="text-muted-foreground">
                  This uses the Instagram API with Instagram Login: only professional
                  (Business/Creator) accounts are eligible, and no Facebook Page is required.
                  Messaging accounts beyond your app&apos;s test users requires Advanced Access for
                  instagram_business_manage_messages via App Review. See docs/META-APP-REVIEW.md.
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
