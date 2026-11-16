import { AtSign, Camera, MessageCircle, Music2, Phone, Send, type LucideIcon } from "lucide-react";

import { cn } from "@/lib/utils";
import type { Provider } from "@/generated/prisma/client";

export interface ProviderMeta {
  provider: Provider;
  label: string;
  shortLabel: string;
  description: string;
  /** Phase in which the real adapter arrives (Phase 0 plan). */
  phase: string;
  /** Brand colour used for the small badge / icon tile only. */
  color: string;
  icon: LucideIcon;
}

export const PROVIDER_META: Record<Provider, ProviderMeta> = {
  WHATSAPP: {
    provider: "WHATSAPP",
    label: "WhatsApp Business",
    shortLabel: "WhatsApp",
    description: "Reply to WhatsApp Business chats from the unified inbox.",
    phase: "Phase 6",
    color: "#25d366",
    icon: Phone,
  },
  TELEGRAM: {
    provider: "TELEGRAM",
    label: "Telegram",
    shortLabel: "Telegram",
    description: "Connect a Telegram bot — the first adapter, no app review needed.",
    phase: "Phase 4",
    color: "#229ed9",
    icon: Send,
  },
  FACEBOOK: {
    provider: "FACEBOOK",
    label: "Facebook Messenger",
    shortLabel: "Messenger",
    description: "Manage Facebook Page conversations alongside every other channel.",
    phase: "Phase 5",
    color: "#1877f2",
    icon: MessageCircle,
  },
  INSTAGRAM: {
    provider: "INSTAGRAM",
    label: "Instagram",
    shortLabel: "Instagram",
    description: "Answer Instagram DMs without switching apps.",
    phase: "Phase 5",
    color: "#e1306c",
    icon: Camera,
  },
  X: {
    provider: "X",
    label: "X (Twitter)",
    shortLabel: "X",
    description: "Direct messages on X — paid/restricted API, spike pending.",
    phase: "Phase 7 spike",
    color: "#0f1419",
    icon: AtSign,
  },
  TIKTOK: {
    provider: "TIKTOK",
    label: "TikTok",
    shortLabel: "TikTok",
    description: "TikTok business messages — partner/invite-only API, spike pending.",
    phase: "Phase 7 spike",
    color: "#161823",
    icon: Music2,
  },
};

export const PROVIDER_ORDER: Provider[] = [
  "TELEGRAM",
  "FACEBOOK",
  "INSTAGRAM",
  "WHATSAPP",
  "X",
  "TIKTOK",
];

/** Circular brand tile for a provider (channels grid, lists). */
export function ChannelIcon({
  provider,
  size = "md",
  className,
}: {
  provider: Provider;
  size?: "sm" | "md" | "lg";
  className?: string;
}) {
  const meta = PROVIDER_META[provider];
  const Icon = meta.icon;
  const sizes = {
    sm: "size-7 [&_svg]:size-3.5",
    md: "size-10 [&_svg]:size-5",
    lg: "size-12 [&_svg]:size-6",
  } as const;
  return (
    <span
      aria-label={meta.label}
      title={meta.label}
      className={cn(
        "inline-flex shrink-0 items-center justify-center rounded-full text-white",
        sizes[size],
        className,
      )}
      style={{ backgroundColor: meta.color }}
    >
      <Icon />
    </span>
  );
}

/** Tiny channel badge meant to overlay an avatar's bottom-right corner. */
export function ChannelBadge({ provider, className }: { provider: Provider; className?: string }) {
  const meta = PROVIDER_META[provider];
  const Icon = meta.icon;
  return (
    <span
      aria-label={meta.label}
      title={meta.label}
      className={cn(
        "ring-background absolute right-0 bottom-0 inline-flex size-4 items-center justify-center rounded-full text-white ring-2 [&_svg]:size-2.5",
        className,
      )}
      style={{ backgroundColor: meta.color }}
    >
      <Icon />
    </span>
  );
}
