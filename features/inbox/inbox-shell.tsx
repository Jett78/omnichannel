"use client";

import { Inbox, Plug } from "lucide-react";
import Link from "next/link";

import { ProviderGlyph } from "@/components/channel-icon";
import { Button } from "@/components/ui/button";
import type { RealInboxData } from "@/features/inbox/real-data";
import { RealInboxShell } from "@/features/inbox/real-inbox-shell";
import type { Provider } from "@/generated/prisma/client";

const CHANNEL_ROW: Provider[] = ["WHATSAPP", "FACEBOOK", "INSTAGRAM", "TELEGRAM", "GMAIL", "WEBSITE"];

/**
 * Inbox entry point:
 * - The active workspace HAS real conversations → the real inbox
 *   (API-backed, Socket.IO live updates).
 * - Otherwise → an honest empty state. (The Phase 3 sample preview
 *   was removed at the owner's request — no fake conversations.)
 */
export function InboxShell({
  currentUserName,
  realData,
}: {
  currentUserName: string;
  realData?: RealInboxData;
  initialView?: string;
}) {
  if (realData && realData.conversations.length > 0) {
    return <RealInboxShell currentUserName={currentUserName} data={realData} />;
  }
  return (
    <div className="flex h-full min-h-0 w-full items-center justify-center p-6">
      <div className="flex max-w-md flex-col items-center text-center">
        <span className="bg-accent text-primary flex size-16 items-center justify-center rounded-full">
          <Inbox className="size-8" />
        </span>
        <h2 className="pt-5 text-lg font-bold tracking-tight">No conversations yet</h2>
        <p className="text-muted-foreground pt-1.5 text-sm leading-relaxed">
          When a customer messages one of your connected channels, the conversation will appear
          here — replies, assignments, notes and AI help included.
        </p>
        <div className="flex items-center gap-3 pt-5" aria-hidden="true">
          {CHANNEL_ROW.map((provider) => (
            <ProviderGlyph key={provider} provider={provider} className="size-6" />
          ))}
        </div>
        <Button asChild className="mt-6 rounded-full px-5">
          <Link href="/channels">
            <Plug className="size-4" /> Connect a channel
          </Link>
        </Button>
      </div>
    </div>
  );
}
