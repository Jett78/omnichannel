import {
  Camera,
  FlaskConical,
  Globe,
  Mail,
  MessageCircle,
  Music2,
  Phone,
  Send,
  type LucideIcon,
} from "lucide-react";

import { BRAND_GRADIENTS, BrandGlyph } from "@/components/brand-icons";
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
    phase: "Meta Cloud API",
    color: "#25d366",
    icon: Phone,
  },
  TELEGRAM: {
    provider: "TELEGRAM",
    label: "Telegram",
    shortLabel: "Telegram",
    description: "Connect a Telegram bot with its BotFather token — no app review needed.",
    phase: "Phase 10 — live",
    color: "#229ed9",
    icon: Send,
  },
  FACEBOOK: {
    provider: "FACEBOOK",
    label: "Facebook Messenger",
    shortLabel: "Messenger",
    description: "Manage Facebook Page conversations alongside every other channel.",
    phase: "Phase 5 — live",
    color: "#1877f2",
    icon: MessageCircle,
  },
  INSTAGRAM: {
    provider: "INSTAGRAM",
    label: "Instagram",
    shortLabel: "Instagram",
    description: "Answer Instagram DMs without switching apps.",
    phase: "Phase 5 — live",
    color: "#e1306c",
    icon: Camera,
  },
  TIKTOK: {
    provider: "TIKTOK",
    label: "TikTok",
    shortLabel: "TikTok",
    description:
      "TikTok business messages — access is restricted by TikTok pending its Data Security & Privacy Review approval.",
    phase: "Phase 7 — access gated",
    color: "#161823",
    icon: Music2,
  },
  GMAIL: {
    provider: "GMAIL",
    label: "Gmail",
    shortLabel: "Gmail",
    description:
      "A shared Gmail mailbox in the inbox — official Gmail API, new mail polls in about once a minute, no reply window.",
    phase: "Phase 9 — live",
    color: "#ea4335",
    icon: Mail,
  },
  WEBSITE: {
    provider: "WEBSITE",
    label: "Website live chat",
    shortLabel: "Website",
    description:
      "A chat bubble on your own website — visitors chat without any account, you reply from this inbox.",
    phase: "Phase 11 — live",
    color: "#6366f1",
    icon: Globe,
  },
  MOCK: {
    provider: "MOCK",
    label: "Mock (dev only)",
    shortLabel: "Mock",
    description: "Simulated channel for development and testing — not a real platform.",
    phase: "Phase 4 (dev only)",
    color: "#6b7280",
    icon: FlaskConical,
  },
};

export const PROVIDER_ORDER: Provider[] = [
  "TELEGRAM",
  "FACEBOOK",
  "INSTAGRAM",
  "WHATSAPP",
  "GMAIL",
  "WEBSITE",
  "TIKTOK",
];

/**
 * Brand tile for a provider (channels grid, lists): a squircle in the
 * brand colour / gradient carrying the ACCURATE brand glyph in white
 * (providers without a brand mark fall back to their Lucide icon).
 */
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
    sm: { tile: "size-7", glyph: "size-4" },
    md: { tile: "size-10", glyph: "size-5" },
    lg: { tile: "size-12", glyph: "size-6" },
  } as const;
  const gradient = BRAND_GRADIENTS[provider];
  return (
    <span
      aria-label={meta.label}
      title={meta.label}
      className={cn(
        "inline-flex shrink-0 items-center justify-center rounded-[30%] text-white",
        sizes[size].tile,
        className,
      )}
      style={
        gradient ? { backgroundImage: gradient } : { backgroundColor: meta.color }
      }
    >
      <BrandGlyph provider={provider} tone="white" className={sizes[size].glyph} />
      {/* BrandGlyph renders nothing for WEBSITE / MOCK — use the Lucide icon there. */}
      {provider === "WEBSITE" || provider === "MOCK" ? (
        <Icon className={sizes[size].glyph} />
      ) : null}
    </span>
  );
}

/**
 * A standalone provider glyph at any size: the accurate brand mark in
 * its brand colour where one exists, otherwise the provider's Lucide
 * icon tinted with the brand colour. Used in tables, chips and rows
 * where a full tile would be too heavy.
 */
export function ProviderGlyph({
  provider,
  className,
}: {
  provider: Provider;
  className?: string;
}) {
  const meta = PROVIDER_META[provider];
  const Icon = meta.icon;
  if (provider === "WEBSITE" || provider === "MOCK") {
    return <Icon className={className} style={{ color: meta.color }} aria-label={meta.label} />;
  }
  return <BrandGlyph provider={provider} className={className} />;
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
        "ring-background absolute right-0 bottom-0 inline-flex size-4 items-center justify-center rounded-full text-white ring-2",
        className,
      )}
      style={{ backgroundColor: meta.color }}
    >
      <BrandGlyph provider={provider} tone="white" className="size-2.5" />
      {provider === "WEBSITE" || provider === "MOCK" ? <Icon className="size-2.5" /> : null}
    </span>
  );
}
