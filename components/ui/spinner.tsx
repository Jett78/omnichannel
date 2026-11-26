import { Loader2 } from "lucide-react";

import { cn } from "@/lib/utils";

/**
 * The one loading indicator (Jeet, 2026-11-26): a proper spinner,
 * never a "Loading…" text. Visually text-free; the role/aria-label
 * keep it accessible.
 */
export function Spinner({ className }: { className?: string }) {
  return (
    <span role="status" aria-label="Loading" className="inline-flex items-center justify-center">
      <Loader2 className={cn("text-muted-foreground size-5 animate-spin", className)} />
    </span>
  );
}
