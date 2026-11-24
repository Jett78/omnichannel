"use client";

import { useState } from "react";
import { ChevronDown, ChevronRight, Store, Trash2 } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

export interface StoreApiShape {
  productsPath: string;
  searchParam: string | null;
  limitParam: string | null;
  responsePath: string | null;
  nameField: string;
  priceField: string;
  stockField: string;
  imageField: string;
}

export interface StoreConnectionView {
  baseUrl: string;
  name: string | null;
  enabled: boolean;
  updatedAt: string;
  shape: StoreApiShape;
}

const DEFAULT_SHAPE: StoreApiShape = {
  productsPath: "/products",
  searchParam: "search",
  limitParam: "take",
  responsePath: "data",
  nameField: "name",
  priceField: "price",
  stockField: "stock",
  imageField: "images",
};

interface StoreConnectionCardProps {
  workspaceId: string;
  initialConnection: StoreConnectionView | null;
  canManage: boolean;
}

type Notice = { kind: "ok" | "error"; text: string } | null;

const SHAPE_FIELDS: {
  key: keyof StoreApiShape;
  label: string;
  help: string;
  placeholder: string;
}[] = [
  {
    key: "productsPath",
    label: "Products endpoint",
    help: "Path added to the address above.",
    placeholder: "/products",
  },
  {
    key: "searchParam",
    label: "Search parameter",
    help: "Query parameter for the search text. Empty = the API has none.",
    placeholder: "search",
  },
  {
    key: "limitParam",
    label: "Page-size parameter",
    help: "Query parameter for how many products to fetch. Empty = don't send.",
    placeholder: "take",
  },
  {
    key: "responsePath",
    label: "Product list location",
    help: "Where the product array sits in the JSON reply. Empty = the reply IS the array.",
    placeholder: "data",
  },
  {
    key: "nameField",
    label: "Name field",
    help: "Product field holding the display name.",
    placeholder: "name",
  },
  {
    key: "priceField",
    label: "Price field",
    help: "Product field holding the price (when there are no variants).",
    placeholder: "price",
  },
  {
    key: "stockField",
    label: "Stock field",
    help: "Product field holding the stock count, or an in-stock true/false.",
    placeholder: "stock",
  },
  {
    key: "imageField",
    label: "Image field",
    help: "Product field holding the photo: a URL, a list, or an object with a url.",
    placeholder: "images",
  },
];

export function StoreConnectionCard({
  workspaceId,
  initialConnection,
  canManage,
}: StoreConnectionCardProps) {
  const [connection, setConnection] = useState<StoreConnectionView | null>(initialConnection);
  const [baseUrl, setBaseUrl] = useState(initialConnection?.baseUrl ?? "");
  const [name, setName] = useState(initialConnection?.name ?? "");
  const [shape, setShape] = useState<StoreApiShape>(initialConnection?.shape ?? DEFAULT_SHAPE);
  const [showAdvanced, setShowAdvanced] = useState(false);
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

  function shapePayload(): Record<string, string> {
    return {
      productsPath: shape.productsPath,
      searchParam: shape.searchParam ?? "",
      limitParam: shape.limitParam ?? "",
      responsePath: shape.responsePath ?? "",
      nameField: shape.nameField,
      priceField: shape.priceField,
      stockField: shape.stockField,
      imageField: shape.imageField,
    };
  }

  async function save() {
    const data = (await call("save", () =>
      fetch(`/api/workspaces/${workspaceId}/store-connection`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          baseUrl: baseUrl.trim(),
          name: name.trim() || undefined,
          ...shapePayload(),
        }),
      }),
    )) as { connection?: StoreConnectionView } | null;
    if (data?.connection) {
      setConnection(data.connection);
      setBaseUrl(data.connection.baseUrl);
      setName(data.connection.name ?? "");
      setShape(data.connection.shape);
      setNotice({ kind: "ok", text: "Store connected. The AI now answers product questions from your live store." });
    }
  }

  async function test() {
    const data = (await call("test", () =>
      fetch(`/api/workspaces/${workspaceId}/store-connection/test`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ baseUrl: baseUrl.trim(), ...shapePayload() }),
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
      setShape(DEFAULT_SHAPE);
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
                The address of your store&apos;s API — the AI reads products from it
                (endpoint and fields under Advanced). Nothing is ever written to your
                store.
              </p>
            </div>

            <div className="flex flex-col gap-2">
              <Button
                type="button"
                variant="ghost"
                className="h-auto justify-start gap-1 px-0 py-1 text-sm font-medium"
                onClick={() => setShowAdvanced((open) => !open)}
              >
                {showAdvanced ? (
                  <ChevronDown className="h-4 w-4" />
                ) : (
                  <ChevronRight className="h-4 w-4" />
                )}
                Advanced — custom API shape
              </Button>
              {showAdvanced ? (
                <div className="flex flex-col gap-3 rounded-lg border p-3">
                  <p className="text-muted-foreground text-xs">
                    The defaults match common storefront APIs (including yours). Only
                    change these when connecting a <strong>different</strong> API whose
                    endpoint, parameters or field names differ — then use Test
                    connection: it shows the first product exactly as the AI will read
                    it.
                  </p>
                  <div className="grid gap-3 sm:grid-cols-2">
                    {SHAPE_FIELDS.map((field) => (
                      <div key={field.key} className="flex flex-col gap-1">
                        <Label htmlFor={`shape-${field.key}`}>{field.label}</Label>
                        <Input
                          id={`shape-${field.key}`}
                          value={shape[field.key] ?? ""}
                          onChange={(event) =>
                            setShape((current) => ({
                              ...current,
                              [field.key]: event.target.value,
                            }))
                          }
                          placeholder={field.placeholder}
                        />
                        <p className="text-muted-foreground text-[11px]">{field.help}</p>
                      </div>
                    ))}
                  </div>
                </div>
              ) : null}
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
