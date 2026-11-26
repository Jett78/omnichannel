"use client";

import { CheckCircle2, TriangleAlert } from "lucide-react";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";

import { ChannelIcon } from "@/components/channel-icon";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Spinner } from "@/components/ui/spinner";
import type { Provider } from "@/generated/prisma/client";

interface SessionAccount {
  externalAccountId: string;
  displayName: string;
  detail?: string;
  eligible: boolean;
  ineligibleReason?: string;
  instagramAccount?: { id: string; username?: string };
}

interface SessionResponse {
  session: {
    id: string;
    provider: Provider;
    accounts: SessionAccount[];
  };
}

/**
 * Account picker shown after a Meta OAuth callback redirects back to
 * /channels?meta_session=… — lists the Pages / Instagram accounts Meta
 * returned for the authorization (sanitized server-side; no tokens
 * ever reach this component) and connects the chosen one.
 */
export function MetaConnectionPanel({
  workspaceId,
  sessionId,
  provider,
}: {
  workspaceId: string;
  sessionId: string;
  provider: "facebook" | "instagram" | "whatsapp";
}) {
  const router = useRouter();
  const [accounts, setAccounts] = useState<SessionAccount[] | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [selectingId, setSelectingId] = useState<string | null>(null);
  const [selectError, setSelectError] = useState<string | null>(null);
  const [warning, setWarning] = useState<string | null>(null);
  const [connectedName, setConnectedName] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const res = await fetch(`/api/workspaces/${workspaceId}/channel-connections/${sessionId}`);
        const body = (await res.json().catch(() => null)) as
          SessionResponse | { error?: { message?: string } } | null;
        if (!res.ok) {
          throw new Error(
            (body as { error?: { message?: string } } | null)?.error?.message ??
              `Could not load the connection session (${res.status})`,
          );
        }
        if (!cancelled) setAccounts((body as SessionResponse).session.accounts);
      } catch (error) {
        if (!cancelled) {
          setLoadError(
            error instanceof Error ? error.message : "Could not load the connection session",
          );
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [workspaceId, sessionId]);

  function finish() {
    router.replace("/channels");
    router.refresh();
  }

  async function select(account: SessionAccount) {
    setSelectingId(account.externalAccountId);
    setSelectError(null);
    try {
      const res = await fetch(
        `/api/workspaces/${workspaceId}/channel-connections/${sessionId}/select`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ externalAccountId: account.externalAccountId }),
        },
      );
      const body = (await res.json().catch(() => null)) as {
        subscriptionWarning?: string;
        error?: { message?: string };
      } | null;
      if (!res.ok) {
        throw new Error(body?.error?.message ?? `Connect failed (${res.status})`);
      }
      if (body?.subscriptionWarning) {
        setConnectedName(account.displayName);
        setWarning(body.subscriptionWarning);
        return;
      }
      finish();
    } catch (error) {
      setSelectError(error instanceof Error ? error.message : "Could not connect that account");
    } finally {
      setSelectingId(null);
    }
  }

  const providerEnum: Provider =
    provider === "facebook" ? "FACEBOOK" : provider === "instagram" ? "INSTAGRAM" : "WHATSAPP";
  const title =
    provider === "facebook"
      ? "Choose the Facebook Page to connect"
      : provider === "instagram"
        ? "Connect your Instagram account"
        : "Choose the WhatsApp number to connect";

  return (
    <Card className="border-indigo-200">
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <ChannelIcon provider={providerEnum} size="sm" />
          {title}
        </CardTitle>
        <CardDescription>
          {provider === "facebook"
            ? "Meta returned these Pages for your authorization. Only Pages your user can manage for Messenger can be connected."
            : provider === "instagram"
              ? "Meta returned this account for your authorization. Only professional (Business/Creator) accounts can use Instagram messaging."
              : "Embedded Signup returned these phone numbers for the WhatsApp Business Account. Only connected/verified numbers can be connected."}
        </CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-3">
        {warning ? (
          <div className="flex flex-col gap-2">
            <p className="flex items-start gap-2 text-sm text-emerald-700">
              <CheckCircle2 className="mt-0.5 size-4 shrink-0" />
              {connectedName} is connected.
            </p>
            <p className="flex items-start gap-2 rounded-md bg-amber-50 p-3 text-sm text-amber-800">
              <TriangleAlert className="mt-0.5 size-4 shrink-0" />
              Connected, but the webhook subscription failed: {warning} Incoming messages may not
              arrive until the subscription is fixed in the Meta app (see docs/META-APP-REVIEW.md).
            </p>
            <div>
              <Button onClick={finish}>Done</Button>
            </div>
          </div>
        ) : loadError ? (
          <p className="text-sm text-red-600">{loadError}</p>
        ) : accounts === null ? (
          <div className="flex justify-center py-6">
            <Spinner />
          </div>
        ) : accounts.length === 0 ? (
          <p className="text-muted-foreground text-sm">
            Meta did not return any accounts for this authorization. If you expected a Page or
            account here, check that your Meta user has the required role and try connecting again.
          </p>
        ) : (
          <ul className="divide-y">
            {accounts.map((account) => (
              <li key={account.externalAccountId} className="flex items-center gap-3 py-3">
                <div className="flex flex-1 flex-col">
                  <span className="text-sm font-medium">{account.displayName}</span>
                  {account.detail ? (
                    <span className="text-muted-foreground text-xs">{account.detail}</span>
                  ) : null}
                  {account.instagramAccount?.username ? (
                    <span className="text-muted-foreground text-xs">
                      Instagram: @{account.instagramAccount.username}
                    </span>
                  ) : null}
                  {!account.eligible && account.ineligibleReason ? (
                    <span className="text-xs text-amber-700">{account.ineligibleReason}</span>
                  ) : null}
                </div>
                {account.eligible ? (
                  <Button
                    variant="outline"
                    onClick={() => void select(account)}
                    disabled={selectingId !== null}
                  >
                    {selectingId === account.externalAccountId ? "Connecting…" : "Connect"}
                  </Button>
                ) : (
                  <Badge variant="warning">Not eligible</Badge>
                )}
              </li>
            ))}
          </ul>
        )}
        {selectError ? <p className="text-sm text-red-600">{selectError}</p> : null}
      </CardContent>
    </Card>
  );
}
