import { MessagesSquare, ShieldCheck, Sparkles } from "lucide-react";
import Link from "next/link";
import type { ReactNode } from "react";

import { ProviderGlyph } from "@/components/channel-icon";
import type { Provider } from "@/generated/prisma/client";

const FEATURES = [
  {
    icon: MessagesSquare,
    title: "All channels, one inbox",
    text: "Every DM and email lands in a single shared team queue.",
  },
  {
    icon: Sparkles,
    title: "AI replies and automations",
    text: "Suggested replies, auto-answers and smart assignment built in.",
  },
  {
    icon: ShieldCheck,
    title: "Official APIs only",
    text: "Meta, Google and Telegram integrations — no scraping, no bans.",
  },
];

const CHANNELS: Provider[] = ["WHATSAPP", "FACEBOOK", "INSTAGRAM", "TELEGRAM", "GMAIL", "WEBSITE"];

/**
 * The split-screen frame shared by all auth pages: dark brand panel
 * on the left (desktop), the form on a soft gradient on the right.
 * Session behaviour (e.g. bouncing signed-in users into the app)
 * lives in the route-group layouts that use this shell — the
 * reset-password group deliberately skips that bounce so an email
 * link always reaches the new-password form.
 */
export function AuthShell({ children }: { children: ReactNode }) {
  return (
    <div className="grid min-h-screen lg:grid-cols-[1.05fr_1fr]">
      {/* Brand panel (desktop) */}
      <aside className="relative hidden flex-col justify-between overflow-hidden bg-indigo-950 p-12 text-white lg:flex">
        <div
          aria-hidden
          className="absolute -top-32 -left-32 size-96 rounded-full bg-indigo-500/30 blur-3xl"
        />
        <div
          aria-hidden
          className="absolute -right-24 -bottom-32 size-96 rounded-full bg-amber-500/20 blur-3xl"
        />
        <div className="relative flex items-center gap-3">
          <span className="flex size-11 items-center justify-center rounded-2xl bg-gradient-to-br from-indigo-400 to-violet-500 text-lg font-bold">
            U
          </span>
          <div>
            <p className="leading-tight font-semibold">Unified Inbox</p>
            <p className="text-xs text-indigo-300">Unified Omnichannel Inbox</p>
          </div>
        </div>

        <div className="relative flex flex-col gap-10">
          <div>
            <h1 className="text-4xl leading-tight font-bold">
              Every customer conversation,
              <br />
              in one place.
            </h1>
            <p className="mt-4 max-w-md text-[15px] leading-relaxed text-indigo-200">
              WhatsApp, Messenger, Instagram, Telegram and Gmail — answered from a single team
              inbox, with AI and automations doing the busywork.
            </p>
          </div>
          <ul className="flex flex-col gap-5">
            {FEATURES.map((feature) => (
              <li key={feature.title} className="flex items-start gap-3.5">
                <span className="flex size-10 shrink-0 items-center justify-center rounded-xl bg-white/10 ring-1 ring-white/15">
                  <feature.icon className="size-5 text-indigo-100" />
                </span>
                <span>
                  <span className="block text-sm font-medium">{feature.title}</span>
                  <span className="mt-0.5 block text-sm text-indigo-300">{feature.text}</span>
                </span>
              </li>
            ))}
          </ul>
        </div>

        <div className="relative">
          <div className="flex items-center gap-2.5">
            {CHANNELS.map((provider) => (
              <span
                key={provider}
                className="flex size-9 items-center justify-center rounded-full bg-white"
              >
                <ProviderGlyph provider={provider} className="size-4.5" />
              </span>
            ))}
          </div>
          <p className="mt-4 text-xs text-indigo-300">
            Built for online sellers in Nepal — and teams everywhere.
          </p>
        </div>
      </aside>

      {/* Form side */}
      <main className="relative flex flex-col items-center justify-center gap-6 overflow-hidden bg-gradient-to-br from-indigo-50 via-white to-amber-50 p-6 sm:p-10 dark:from-indigo-950/40 dark:via-neutral-950 dark:to-amber-950/30">
        <div className="relative flex flex-col items-center gap-2 text-center lg:hidden">
          <span className="flex size-11 items-center justify-center rounded-2xl bg-gradient-to-br from-indigo-500 to-violet-600 text-lg font-bold text-white">
            U
          </span>
          <span className="text-lg font-semibold">Unified Inbox</span>
          <span className="text-muted-foreground -mt-1 text-sm">
            Every customer conversation, in one place.
          </span>
        </div>
        <div className="relative w-full max-w-lg">{children}</div>
        <p className="text-muted-foreground relative flex gap-4 text-xs">
          <Link href="/privacy" className="underline-offset-4 hover:underline">
            Privacy Policy
          </Link>
          <Link href="/terms" className="underline-offset-4 hover:underline">
            Terms of Service
          </Link>
        </p>
      </main>
    </div>
  );
}
