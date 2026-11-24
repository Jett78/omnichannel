"use client";

import { useState } from "react";
import { Store, Trash2 } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

export interface StoreConnectionView {
  baseUrl: string;
  name: string | null;
  enabled: boolean;
  updatedAt: string;
}

interface StoreConnectionCardProps {
  workspaceId: string;
  initialConnection: StoreConnectionView | null;
  canManage: boolean;
}

type Notice = { kind: "ok" | "error"; text: string } | null;

export function StoreConnectionCard({
  workspaceId,
  initialConnection,
  canManage,
}: StoreConnectionCardProps) {
  const [connection, setConnection] = useState<StoreConnectionView | null>(initialConnection);
  const [baseUrl, setBaseUrl] = useState(initialConnection?.baseUrl ?? "");
  const [name, setName] = useState(initialConnection?.name ?? "");
  const [notice, setNotice] = useState<Notice>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [confirmRemove, setConfirmRemove] = useState(false);

  async function call(action: string, fn: () => Promise<Response>): Promise<unknown> {
    setBusy(action);
    setNotice(null);
    try {
      const response = await fn();
      const data = (await response.json().catch(() => null)) as Record<string, unknown> | null;
      if (!response.ok) {
        throw new Error(typeof data?.error === "string" ? data.error : "Something went wrong.");
      }
      return data;
    } catch (error) {
      setNotice({
        kind: "error",
        text: error instanceof Error ? error.message : "Something went wrong.",
      });
      return null;
    } finally {
      setBusy(null);
    }
  }

  async function save() {
    const data = (await call("save", () =>
      fetch(`/api/workspaces/${workspaceId}/store-connection`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ baseUrl: baseUrl.trim(), name: name.trim() || undefined }),
      }),
    )) as { connection?: StoreConnectionView } | null;
    if (data?.connection) {
      setConnection(data.connection);
      setBaseUrl(data.connection.baseUrl);
      setName(data.connection.name ?? "");
      setNotice({ kind: "ok", text: "Store connected. The AI now answers product questions from your live store." });
    }
  }

  async function test() {
    const data = (await call("test", () =>
      fetch(`/api/workspaces/${workspaceId}/store-connection/test`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ baseUrl: baseUrl.trim() }),
      }),
    )) as { ok?: boolean; message?: string } | null;
    if (data) {
      setNotice({ kind: data.ok ? "ok" : "error", text: data.message ?? "Test finished." });
    }
  }

  async function remove() {
    const data = await call("remove", () =>
      fetch(`/api/workspaces/${workspaceId}/store-connection`, { method: "DELETE" }),
    );
    if (data) {
      setConnection(null);
      setBaseUrl("");
      setName("");
      setConfirmRemove(false);
      setNotice({ kind: "ok", text: "Store disconnected." });
    }
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Store className="h-5 w-5" />
          Store connection — live products
          {connection ? <Badge variant="secondary">Connected</Badge> : null}
        </CardTitle>
        <CardDescription>
          Connect your ecommerce store&apos;s API so the AI answers product questions (price,
          sizes, stock) from live store data — and the AI auto-reply can send the
          product&apos;s photo with its answer. Product policies (delivery, exchange) still
          come from the knowledge base above.
        </CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-4">
        {connection && !canManage ? (
          <p className="text-sm">
            Connected to <span className="font-medium">{connection.name || connection.baseUrl}</span>
            <span className="text-muted-foreground"> ({connection.baseUrl})</span>
          </p>
        ) : null}

        {canManage ? (
          <>
            <div className="flex flex-col gap-2">
              <Label htmlFor="store-name">Store name (optional)</Label>
              <Input
                id="store-name"
                value={name}
                onChange={(event) => setName(event.target.value)}
                placeholder="e.g. Nimble Bazaar"
              />
            </div>
            <div className="flex flex-col gap-2">
              <Label htmlFor="store-url">Store API address</Label>
              <Input
                id="store-url"
                value={baseUrl}
                onChange={(event) => setBaseUrl(event.target.value)}
                placeholder="https://ecommerce-api.yourstore.com"
                inputMode="url"
              />
              <p className="text-muted-foreground text-xs">
                The address of your store&apos;s API — the AI reads{" "}
                <code className="text-[11px]">/products</code> from it. Nothing is ever
                written to your store.
              </p>
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <Button onClick={save} disabled={busy !== null || baseUrl.trim() === ""}>
                {busy === "save" ? "Saving…" : connection ? "Save changes" : "Connect store"}
              </Button>
              <Button
                variant="outline"
                onClick={test}
                disabled={busy !== null || baseUrl.trim() === ""}
              >
                {busy === "test" ? "Testing…" : "Test connection"}
              </Button>
              {connection ? (
                confirmRemove ? (
                  <>
                    <Button variant="destructive" onClick={remove} disabled={busy !== null}>
                      {busy === "remove" ? "Removing…" : "Confirm disconnect"}
                    </Button>
                    <Button
                      variant="ghost"
                      onClick={() => setConfirmRemove(false)}
                      disabled={busy !== null}
                    >
                      Cancel
                    </Button>
                  </>
                ) : (
                  <Button
                    variant="ghost"
                    className="text-destructive"
                    onClick={() => setConfirmRemove(true)}
                    disabled={busy !== null}
                  >
                    <Trash2 className="mr-1 h-4 w-4" />
                    Disconnect
                  </Button>
                )
              ) : null}
            </div>
          </>
        ) : null}

        {notice ? (
          <p className={notice.kind === "ok" ? "text-sm text-emerald-600" : "text-sm text-red-600"}>
            {notice.text}
          </p>
        ) : null}
      </CardContent>
    </Card>
  );
}
