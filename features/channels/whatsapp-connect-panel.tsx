"use client";

import { MessageCircle, TriangleAlert } from "lucide-react";
import { useRouter } from "next/navigation";
import { useRef, useState } from "react";

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
import { MetaConnectionPanel } from "@/features/channels/meta-connection-panel";
import type { RealChannel } from "@/features/channels/channels-catalog";

/**
 * WhatsApp connect/edit dialogs (Phase 6). Nothing renders on the page
 * itself — the Channels catalog opens these dialogs:
 *
 *  - Connect (catalog "Connect now", only while the workspace has no
 *    WhatsApp channel — one number per workspace): two official paths.
 *    1. Embedded Signup: loads Meta's Facebook JS SDK on demand (only
 *       when the button is clicked — the SDK is not in the base bundle),
 *       opens the FB.login popup with the deployment's Facebook Login
 *       for Business configuration id, captures the WA_EMBEDDED_SIGNUP
 *       session-info message (waba_id / phone_number_id), and POSTs the
 *       returned code to our server, which exchanges + verifies it and
 *       returns a number-selection session (tokens never come back to
 *       the browser).
 *    2. Manual connect: a permanent system-user token + WABA id + phone
 *       number id, validated server-side against the real WABA before
 *       the token is stored (encrypted).
 *  - Edit (connected list's Edit/Reconnect for a WhatsApp channel):
 *    shows the channel's WABA id and phone number id (fixed — changing
 *    the number means disconnect + connect) and replaces the stored
 *    system-user token. Stored tokens are never readable, so the token
 *    field always starts empty; saving verifies the new token against
 *    the WABA/number before replacing the old one. The same dialog hosts
 *    phone-number registration (6-digit PIN).
 */

export interface WhatsAppConfigView {
  embeddedSignupReady: boolean;
  manualReady: boolean;
}

interface FbLoginResponse {
  authResponse?: { code?: string } | null;
  status?: string;
}

interface FbSdk {
  init: (options: { appId: string; autoLogAppEvents: boolean; xfbml: boolean; version: string }) => void;
  login: (
    callback: (response: FbLoginResponse) => void,
    options: Record<string, unknown>,
  ) => void;
}

declare global {
  interface Window {
    FB?: FbSdk;
  }
}

interface EmbeddedSignupData {
  wabaId?: string;
  phoneNumberId?: string;
}

function loadFacebookSdk(): Promise<FbSdk> {
  if (window.FB) return Promise.resolve(window.FB);
  return new Promise<FbSdk>((resolve, reject) => {
    const existing = document.getElementById("facebook-jssdk");
    if (!existing) {
      const script = document.createElement("script");
      script.id = "facebook-jssdk";
      script.src = "https://connect.facebook.net/en_US/sdk.js";
      script.async = true;
      script.defer = true;
      script.crossOrigin = "anonymous";
      script.onerror = () => reject(new Error("The Facebook SDK could not be loaded."));
      document.body.appendChild(script);
    }
    const startedAt = Date.now();
    const timer = window.setInterval(() => {
      if (window.FB) {
        window.clearInterval(timer);
        resolve(window.FB);
      } else if (Date.now() - startedAt > 15_000) {
        window.clearInterval(timer);
        reject(
          new Error(
            "The Facebook SDK did not load (it may be blocked by an ad-blocker or network policy). Use manual connect instead.",
          ),
        );
      }
    }, 200);
  });
}

export function WhatsAppConnectPanel({
  workspaceId,
  whatsappConfig,
  connectedChannels,
  openSignal = 0,
  editSignal = 0,
  editChannelId = null,
}: {
  workspaceId: string;
  whatsappConfig: WhatsAppConfigView;
  connectedChannels: RealChannel[];
  /** Incremented by the catalog when its WhatsApp "Connect now" is clicked. */
  openSignal?: number;
  /** Incremented by the catalog when a WhatsApp channel's Edit/Reconnect is clicked. */
  editSignal?: number;
  editChannelId?: string | null;
}) {
  const router = useRouter();
  const [dialogOpen, setDialogOpen] = useState(false);
  const [dialogMode, setDialogMode] = useState<"connect" | "edit">("connect");
  const [editChannel, setEditChannel] = useState<RealChannel | null>(null);

  const [signupBusy, setSignupBusy] = useState(false);
  const [signupError, setSignupError] = useState<string | null>(null);
  const [sessionId, setSessionId] = useState<string | null>(null);
  const [signupWarning, setSignupWarning] = useState<string | null>(null);
  const signupDataRef = useRef<EmbeddedSignupData>({});

  const [manual, setManual] = useState(() => {
    const connected = connectedChannels.find(
      (channel) => channel.provider === "WHATSAPP" && channel.status === "CONNECTED",
    );
    return {
      wabaId: connected?.config?.wabaId ?? "",
      phoneNumberId: connected?.externalAccountId ?? "",
      accessToken: "",
    };
  });
  const [manualBusy, setManualBusy] = useState(false);
  const [manualError, setManualError] = useState<string | null>(null);
  const [manualWarning, setManualWarning] = useState<string | null>(null);

  const [editToken, setEditToken] = useState("");
  const [editBusy, setEditBusy] = useState(false);
  const [editError, setEditError] = useState<string | null>(null);
  const [editWarning, setEditWarning] = useState<string | null>(null);
  const [editNotice, setEditNotice] = useState<string | null>(null);

  const [registerTarget, setRegisterTarget] = useState<RealChannel | null>(null);
  const [pin, setPin] = useState("");
  const [registerBusy, setRegisterBusy] = useState(false);
  const [registerError, setRegisterError] = useState<string | null>(null);
  const [registerNotice, setRegisterNotice] = useState<string | null>(null);

  const whatsappChannels = connectedChannels.filter(
    (channel) => channel.provider === "WHATSAPP" && channel.status === "CONNECTED",
  );

  // Open the dialogs whenever the catalog buttons bump their signals
  // (state adjusted during render, per React's prev-prop pattern).
  const [handledOpenSignal, setHandledOpenSignal] = useState(openSignal);
  if (openSignal !== handledOpenSignal) {
    setHandledOpenSignal(openSignal);
    if (openSignal > 0) {
      setDialogMode("connect");
      setDialogOpen(true);
    }
  }
  const [handledEditSignal, setHandledEditSignal] = useState(editSignal);
  if (editSignal !== handledEditSignal) {
    setHandledEditSignal(editSignal);
    if (editSignal > 0 && editChannelId) {
      const channel = connectedChannels.find((candidate) => candidate.id === editChannelId);
      if (channel) {
        setEditChannel(channel);
        setEditToken("");
        setEditError(null);
        setEditWarning(null);
        setEditNotice(null);
        setRegisterNotice(null);
        setDialogMode("edit");
        setDialogOpen(true);
      }
    }
  }

  // If a WhatsApp channel appears in the props (e.g. right after connecting
  // and the page refreshes), fill any still-empty manual id fields from it.
  const [filledForChannelId, setFilledForChannelId] = useState<string | null>(null);
  const firstConnected = whatsappChannels[0];
  if (firstConnected && filledForChannelId !== firstConnected.id) {
    setFilledForChannelId(firstConnected.id);
    setManual((prev) => ({
      wabaId: prev.wabaId || (firstConnected.config?.wabaId ?? ""),
      phoneNumberId: prev.phoneNumberId || (firstConnected.externalAccountId ?? ""),
      accessToken: prev.accessToken,
    }));
  }

  async function startEmbeddedSignup() {
    setSignupBusy(true);
    setSignupError(null);
    setSignupWarning(null);
    signupDataRef.current = {};
    try {
      const configRes = await fetch(
        `/api/workspaces/${workspaceId}/channels/whatsapp/embedded-signup-config`,
      );
      const configBody = (await configRes.json().catch(() => null)) as {
        appId?: string;
        configId?: string;
        graphVersion?: string;
        error?: { message?: string };
      } | null;
      if (!configRes.ok || !configBody?.appId || !configBody?.configId) {
        throw new Error(
          configBody?.error?.message ??
            "Embedded Signup is not configured on this deployment. Use manual connect instead.",
        );
      }

      const onMessage = (event: MessageEvent) => {
        if (!event.origin.endsWith("connect.facebook.net")) return;
        let data: unknown = event.data;
        if (typeof data === "string") {
          try {
            data = JSON.parse(data) as unknown;
          } catch {
            return;
          }
        }
        if (!data || typeof data !== "object") return;
        const record = data as { type?: string; data?: Record<string, unknown> };
        if (record.type !== "WA_EMBEDDED_SIGNUP" || !record.data) return;
        const wabaId = record.data.waba_id;
        const phoneNumberId = record.data.phone_number_id;
        signupDataRef.current = {
          ...(typeof wabaId === "string" ? { wabaId } : {}),
          ...(typeof phoneNumberId === "string" ? { phoneNumberId } : {}),
        };
      };
      window.addEventListener("message", onMessage);

      try {
        const FB = await loadFacebookSdk();
        FB.init({
          appId: configBody.appId,
          autoLogAppEvents: true,
          xfbml: true,
          version: configBody.graphVersion ?? "v25.0",
        });
        const code = await new Promise<string>((resolve, reject) => {
          FB.login(
            (response) => {
              const authCode = response.authResponse?.code;
              if (authCode) resolve(authCode);
              else
                reject(
                  new Error(
                    "Embedded Signup was cancelled or the popup was blocked. Allow popups for this site and try again, or use manual connect.",
                  ),
                );
            },
            {
              config_id: configBody.configId,
              response_type: "code",
              override_default_response_type: true,
              extras: { setup: {} },
            },
          );
        });

        // The session-info message can land just after the login callback.
        const deadline = Date.now() + 3000;
        while (!signupDataRef.current.wabaId && Date.now() < deadline) {
          await new Promise((resolve) => setTimeout(resolve, 150));
        }
        const { wabaId, phoneNumberId } = signupDataRef.current;
        if (!wabaId) {
          throw new Error(
            "Embedded Signup finished without returning a WhatsApp Business Account. Try again and make sure the correct business account is selected in the popup.",
          );
        }
        const res = await fetch(`/api/workspaces/${workspaceId}/channels/whatsapp/embedded-signup`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ code, wabaId, ...(phoneNumberId ? { phoneNumberId } : {}) }),
        });
        const body = (await res.json().catch(() => null)) as {
          sessionId?: string;
          subscriptionWarning?: string;
          error?: { message?: string };
        } | null;
        if (!res.ok || !body?.sessionId) {
          throw new Error(body?.error?.message ?? `Embedded Signup failed (${res.status})`);
        }
        if (body.subscriptionWarning) setSignupWarning(body.subscriptionWarning);
        setSessionId(body.sessionId);
      } finally {
        window.removeEventListener("message", onMessage);
      }
    } catch (error) {
      setSignupError(error instanceof Error ? error.message : "Embedded Signup failed");
    } finally {
      setSignupBusy(false);
    }
  }

  async function connectManually() {
    setManualBusy(true);
    setManualError(null);
    setManualWarning(null);
    try {
      const res = await fetch(`/api/workspaces/${workspaceId}/channels/whatsapp/manual`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(manual),
      });
      const body = (await res.json().catch(() => null)) as {
        subscriptionWarning?: string;
        error?: { message?: string };
      } | null;
      if (!res.ok) {
        throw new Error(body?.error?.message ?? `Manual connect failed (${res.status})`);
      }
      if (body?.subscriptionWarning) {
        setManualWarning(
          `Connected, but the webhook subscription failed: ${body.subscriptionWarning}`,
        );
      } else {
        setDialogOpen(false);
      }
      // Keep the ids for next time; only the token is cleared (it is never
      // stored in the browser).
      setManual((prev) => ({ ...prev, accessToken: "" }));
      router.refresh();
    } catch (error) {
      setManualError(error instanceof Error ? error.message : "Manual connect failed");
    } finally {
      setManualBusy(false);
    }
  }

  async function saveEditedCredentials() {
    if (!editChannel) return;
    setEditBusy(true);
    setEditError(null);
    setEditWarning(null);
    setEditNotice(null);
    try {
      const res = await fetch(
        `/api/workspaces/${workspaceId}/channels/${editChannel.id}/credentials`,
        {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ accessToken: editToken }),
        },
      );
      const body = (await res.json().catch(() => null)) as {
        subscriptionWarning?: string;
        error?: { message?: string };
      } | null;
      if (!res.ok) {
        throw new Error(body?.error?.message ?? `Updating credentials failed (${res.status})`);
      }
      setEditToken("");
      if (body?.subscriptionWarning) {
        setEditWarning(
          `Credentials updated, but the webhook subscription failed: ${body.subscriptionWarning}`,
        );
      } else {
        setEditNotice("Credentials updated — the new token is now stored for this number.");
      }
      router.refresh();
    } catch (error) {
      setEditError(error instanceof Error ? error.message : "Updating credentials failed");
    } finally {
      setEditBusy(false);
    }
  }

  async function registerNumber() {
    if (!registerTarget) return;
    setRegisterBusy(true);
    setRegisterError(null);
    try {
      const res = await fetch(
        `/api/workspaces/${workspaceId}/channels/${registerTarget.id}/register`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ pin }),
        },
      );
      const body = (await res.json().catch(() => null)) as {
        error?: { message?: string };
      } | null;
      if (!res.ok) {
        throw new Error(body?.error?.message ?? `Registration failed (${res.status})`);
      }
      setRegisterNotice(`${registerTarget.displayName} is registered with the Cloud API.`);
      setRegisterTarget(null);
      setPin("");
      router.refresh();
    } catch (error) {
      setRegisterError(error instanceof Error ? error.message : "Registration failed");
    } finally {
      setRegisterBusy(false);
    }
  }

  return (
    <>
      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent className="max-h-[85vh] overflow-y-auto sm:max-w-lg">
          {dialogMode === "edit" && editChannel ? (
            <>
              <DialogHeader>
                <DialogTitle className="flex items-center gap-2">
                  <MessageCircle className="size-5 text-[#25d366]" />
                  Edit WhatsApp connection
                </DialogTitle>
                <DialogDescription>
                  {editChannel.displayName}
                  {editChannel.config?.displayPhoneNumber
                    ? ` · ${editChannel.config.displayPhoneNumber}`
                    : ""}
                  . Update the stored credentials for this number.
                </DialogDescription>
              </DialogHeader>

              <div className="flex flex-col gap-6">
                <section className="flex flex-col gap-3">
                  <div className="grid gap-3 sm:grid-cols-2">
                    <div className="flex flex-col gap-1.5">
                      <Label htmlFor="wa-edit-waba-id">WhatsApp Business Account ID</Label>
                      <Input
                        id="wa-edit-waba-id"
                        value={editChannel.config?.wabaId ?? ""}
                        disabled
                        autoComplete="off"
                      />
                    </div>
                    <div className="flex flex-col gap-1.5">
                      <Label htmlFor="wa-edit-phone-id">Phone number ID</Label>
                      <Input
                        id="wa-edit-phone-id"
                        value={editChannel.externalAccountId ?? ""}
                        disabled
                        autoComplete="off"
                      />
                    </div>
                  </div>
                  <p className="text-muted-foreground text-sm">
                    The number itself can&apos;t be changed here — only one WhatsApp number is
                    allowed per workspace. To use a different number, disconnect this one first,
                    then connect the new one.
                  </p>
                  <div className="flex flex-col gap-1.5">
                    <Label htmlFor="wa-edit-token">System-user access token</Label>
                    <Input
                      id="wa-edit-token"
                      type="password"
                      value={editToken}
                      onChange={(event) => setEditToken(event.target.value)}
                      placeholder="Paste a new token to replace the stored one"
                      autoComplete="off"
                    />
                    <p className="text-muted-foreground text-xs">
                      The stored token is never shown — not even here. Paste a new permanent
                      system-user token only if you want to replace it; it is verified against
                      this account and number before it is saved.
                    </p>
                  </div>
                  <div>
                    <Button
                      onClick={() => void saveEditedCredentials()}
                      disabled={editBusy || !editToken.trim()}
                    >
                      {editBusy ? "Verifying…" : "Update credentials"}
                    </Button>
                  </div>
                  {editError ? <p className="text-sm text-red-600">{editError}</p> : null}
                  {editWarning ? <p className="text-sm text-amber-700">{editWarning}</p> : null}
                  {editNotice ? <p className="text-sm text-emerald-700">{editNotice}</p> : null}
                </section>

                <section className="flex flex-col gap-2 border-t pt-5">
                  <h3 className="text-sm font-semibold">Phone number registration</h3>
                  <p className="text-muted-foreground text-sm">
                    A number must be registered with the Cloud API (6-digit PIN, two-step
                    verification) before it can send and receive. Registering a number that is
                    actively used in the WhatsApp Business app can affect that usage — check
                    Meta&apos;s coexistence rules in docs/WHATSAPP-SETUP.md first.
                  </p>
                  {registerNotice ? (
                    <p className="text-sm text-emerald-700">{registerNotice}</p>
                  ) : null}
                  <div>
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => {
                        setRegisterError(null);
                        setPin("");
                        setRegisterTarget(editChannel);
                      }}
                    >
                      Register number
                    </Button>
                  </div>
                </section>
              </div>
            </>
          ) : (
            <>
              <DialogHeader>
                <DialogTitle className="flex items-center gap-2">
                  <MessageCircle className="size-5 text-[#25d366]" />
                  Connect WhatsApp Business
                </DialogTitle>
                <DialogDescription>
                  Two official ways to connect. Embedded Signup is Meta&apos;s standard flow for
                  businesses; manual connect is for numbers you manage yourself with a system-user
                  token in Meta Business Settings. A workspace can hold one WhatsApp number.
                </DialogDescription>
              </DialogHeader>

              <div className="flex flex-col gap-6">
                <section className="flex flex-col items-start gap-2">
                  <h3 className="text-sm font-semibold">Embedded Signup (recommended)</h3>
                  {whatsappConfig.embeddedSignupReady ? (
                    <>
                      <p className="text-muted-foreground text-sm">
                        Opens Meta&apos;s official signup popup: log in, pick your business and
                        number, and grant this app messaging access. Note: Meta currently requires
                        the platform&apos;s business verification before a signup can finish.
                      </p>
                      <Button onClick={() => void startEmbeddedSignup()} disabled={signupBusy}>
                        {signupBusy ? "Opening signup…" : "Connect with Embedded Signup"}
                      </Button>
                    </>
                  ) : (
                    <p className="flex items-start gap-2 rounded-md bg-amber-50 p-3 text-sm text-amber-800">
                      <TriangleAlert className="mt-0.5 size-4 shrink-0" />
                      Embedded Signup is not configured on this deployment. Set META_APP_ID,
                      META_APP_SECRET and WHATSAPP_EMBEDDED_SIGNUP_CONFIG_ID (a Facebook Login for
                      Business configuration id) on the server — see docs/WHATSAPP-SETUP.md. Manual
                      connect below still works.
                    </p>
                  )}
                  {signupError ? <p className="text-sm text-red-600">{signupError}</p> : null}
                  {signupWarning ? (
                    <p className="text-sm text-amber-700">
                      Signup completed, but the webhook subscription failed: {signupWarning}
                    </p>
                  ) : null}
                </section>

                {sessionId ? (
                  <MetaConnectionPanel workspaceId={workspaceId} sessionId={sessionId} provider="whatsapp" />
                ) : null}

                <section className="flex flex-col gap-3 border-t pt-5">
                  <h3 className="text-sm font-semibold">Connect manually (system-user token)</h3>
                  <p className="text-muted-foreground text-sm">
                    For numbers managed in Meta Business Settings: create a system user, assign it
                    the WhatsApp Business Account and phone number assets with
                    whatsapp_business_messaging + whatsapp_business_management, and paste its
                    permanent token here. The token is checked against the WABA before it is
                    stored.
                  </p>
                  {!whatsappConfig.manualReady ? (
                    <p className="flex items-start gap-2 rounded-md bg-amber-50 p-3 text-sm text-amber-800">
                      <TriangleAlert className="mt-0.5 size-4 shrink-0" />
                      Neither WHATSAPP_APP_SECRET nor META_APP_SECRET is set on this deployment, so
                      incoming webhook signatures cannot be verified yet. You can connect now, but
                      set a secret before relying on incoming messages.
                    </p>
                  ) : null}
                  <div className="grid gap-3 sm:grid-cols-2">
                    <div className="flex flex-col gap-1.5">
                      <Label htmlFor="wa-waba-id">WhatsApp Business Account ID</Label>
                      <Input
                        id="wa-waba-id"
                        value={manual.wabaId}
                        onChange={(event) => setManual((prev) => ({ ...prev, wabaId: event.target.value }))}
                        placeholder="e.g. 123456789012345"
                        autoComplete="off"
                      />
                    </div>
                    <div className="flex flex-col gap-1.5">
                      <Label htmlFor="wa-phone-id">Phone number ID</Label>
                      <Input
                        id="wa-phone-id"
                        value={manual.phoneNumberId}
                        onChange={(event) =>
                          setManual((prev) => ({ ...prev, phoneNumberId: event.target.value }))
                        }
                        placeholder="e.g. 109876543210987"
                        autoComplete="off"
                      />
                    </div>
                    <div className="flex flex-col gap-1.5 sm:col-span-2">
                      <Label htmlFor="wa-token">System-user access token</Label>
                      <Input
                        id="wa-token"
                        type="password"
                        value={manual.accessToken}
                        onChange={(event) =>
                          setManual((prev) => ({ ...prev, accessToken: event.target.value }))
                        }
                        placeholder="Permanent system-user token"
                        autoComplete="off"
                      />
                    </div>
                  </div>
                  <div>
                    <Button
                      variant="outline"
                      onClick={() => void connectManually()}
                      disabled={
                        manualBusy || !manual.wabaId.trim() || !manual.phoneNumberId.trim() || !manual.accessToken.trim()
                      }
                    >
                      {manualBusy ? "Validating…" : "Connect manually"}
                    </Button>
                  </div>
                  {manualError ? <p className="text-sm text-red-600">{manualError}</p> : null}
                  {manualWarning ? <p className="text-sm text-amber-700">{manualWarning}</p> : null}
                </section>
              </div>
            </>
          )}
        </DialogContent>
      </Dialog>

      <Dialog open={registerTarget !== null} onOpenChange={(open) => !open && setRegisterTarget(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Register {registerTarget?.displayName}</DialogTitle>
            <DialogDescription>
              Enter the number&apos;s 6-digit two-step verification PIN. If the number is currently
              used in the WhatsApp Business app, registering it with the Cloud API can interrupt
              that usage — see Meta&apos;s coexistence guidance before continuing.
            </DialogDescription>
          </DialogHeader>
          <div className="flex flex-col gap-3">
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="wa-pin">6-digit PIN</Label>
              <Input
                id="wa-pin"
                inputMode="numeric"
                autoComplete="off"
                maxLength={6}
                value={pin}
                onChange={(event) => setPin(event.target.value.replace(/\D/g, ""))}
                placeholder="••••••"
              />
            </div>
            {registerError ? <p className="text-sm text-red-600">{registerError}</p> : null}
            <div className="flex justify-end gap-2">
              <Button variant="outline" onClick={() => setRegisterTarget(null)}>
                Cancel
              </Button>
              <Button onClick={() => void registerNumber()} disabled={registerBusy || pin.length !== 6}>
                {registerBusy ? "Registering…" : "Register"}
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </>
  );
}
