import type { ReactNode } from "react";

import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";

/**
 * Shared visual language for the auth forms (2026-11-26 restyle):
 * a gradient hairline frame around a soft card, a centered brand
 * mark and title, taller rounded inputs on a muted tint that light
 * up on focus, and a gradient pill submit button. The app is
 * shadow-free by design — depth comes from the frame and tints.
 */
export const authInputClass =
  "h-12 rounded-xl border-input/70 bg-muted/40 pr-3 pl-11 text-[15px] transition-all placeholder:text-muted-foreground/70 hover:border-input focus-visible:bg-background";

export const authIconClass =
  "pointer-events-none absolute top-1/2 left-3.5 size-[18px] -translate-y-1/2 text-muted-foreground transition-colors group-focus-within:text-primary";

export const authButtonClass =
  "h-12 w-full rounded-full bg-gradient-to-r from-indigo-600 to-violet-600 text-[15px] font-semibold text-white transition-all hover:from-indigo-500 hover:to-violet-500 active:scale-[0.99]";

export function AuthCard({
  title,
  description,
  children,
}: {
  title: string;
  description: ReactNode;
  children: ReactNode;
}) {
  return (
    <div className="w-full rounded-[2rem] bg-gradient-to-br from-indigo-300/80 via-indigo-100/50 to-amber-300/70 p-px dark:from-indigo-400/30 dark:via-white/10 dark:to-amber-400/25">
      <Card className="gap-5 rounded-[calc(2rem-1px)] border-0 bg-card/95 py-10 backdrop-blur">
        <CardHeader className="justify-items-center px-10 text-center">
          <span className="flex size-12 items-center justify-center rounded-2xl bg-gradient-to-br from-indigo-500 to-violet-600 text-xl font-bold text-white ring-4 ring-indigo-500/10">
            U
          </span>
          <CardTitle className="mt-1 text-2xl font-bold tracking-tight">{title}</CardTitle>
          <CardDescription className="text-balance">{description}</CardDescription>
        </CardHeader>
        <CardContent className="px-10">{children}</CardContent>
      </Card>
    </div>
  );
}
