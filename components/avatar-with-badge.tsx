import { ChannelBadge } from "@/components/channel-icon";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { cn } from "@/lib/utils";
import type { Provider } from "@/generated/prisma/client";

export function initialsOf(name: string): string {
  return name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part.charAt(0).toUpperCase())
    .join("");
}

const FALLBACK_TONES = [
  "bg-indigo-100 text-indigo-700",
  "bg-emerald-100 text-emerald-700",
  "bg-amber-100 text-amber-700",
  "bg-rose-100 text-rose-700",
  "bg-sky-100 text-sky-700",
  "bg-violet-100 text-violet-700",
] as const;

function toneFor(name: string): string {
  let hash = 0;
  for (let i = 0; i < name.length; i += 1) hash = (hash * 31 + name.charCodeAt(i)) >>> 0;
  return FALLBACK_TONES[hash % FALLBACK_TONES.length] ?? FALLBACK_TONES[0];
}

/** Avatar with initials fallback and an optional channel badge overlay. */
export function AvatarWithBadge({
  name,
  image,
  provider,
  size = "md",
  className,
}: {
  name: string;
  image?: string | null;
  provider?: Provider;
  size?: "sm" | "md" | "lg" | "xl";
  className?: string;
}) {
  const sizes = {
    sm: "size-8 text-[11px]",
    md: "size-10 text-xs",
    lg: "size-12 text-sm",
    xl: "size-[72px] text-xl",
  } as const;
  return (
    <span className={cn("relative inline-flex shrink-0", className)}>
      <Avatar className={sizes[size]}>
        {image ? <AvatarImage src={image} alt={name} /> : null}
        <AvatarFallback className={toneFor(name)}>{initialsOf(name)}</AvatarFallback>
      </Avatar>
      {provider ? <ChannelBadge provider={provider} /> : null}
    </span>
  );
}
