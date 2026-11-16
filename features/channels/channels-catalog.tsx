"use client";

import { FlaskConical } from "lucide-react";
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
import type { Provider } from "@/generated/prisma/client";

export interface RealChannel {
  id: string;
  provider: Provider;
  displayName: string;
  status: string;
}

export function ChannelsCatalog({
  realChannels,
  workspaceId,
  mockEnabled = false,
}: {
  realChannels: RealChannel[];
  workspaceId?: string;
  mockEnabled?: boolean;
}) {
  const router = useRouter();
  const [selected, setSelected] = useState<Provider | null>(null);
  const [mockBusy, setMockBusy] = useState(false);
  const [mockError, setMockError] = useState<string | null>(null);
  const connectedProviders = new Set(realChannels.map((c) => c.provider));
  const mockConnected = connectedProviders.has("MOCK");

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
        description="Connect a messaging account per provider. Each adapter implements the same IMessagingProvider contract. Real adapters arrive phase by phase; the mock channel below is available for development."
      />

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
                </li>
              ))}
            </ul>
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
                <Button variant="outline" onClick={() => setSelected(provider)}>
                  Connect now
                </Button>
              </CardContent>
            </Card>
          );
        })}
      </div>

      <Dialog open={selected !== null} onOpenChange={(open) => !open && setSelected(null)}>
        <DialogContent>
          {selected ? (
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
