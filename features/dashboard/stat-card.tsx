import type { LucideIcon } from "lucide-react";

import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { cn } from "@/lib/utils";

export type StatCardTone = "indigo" | "violet" | "sky" | "amber" | "emerald" | "slate";

const TONE_CLASSES: Record<StatCardTone, string> = {
  indigo: "bg-indigo-50 text-indigo-600 dark:bg-indigo-500/10 dark:text-indigo-400",
  violet: "bg-violet-50 text-violet-600 dark:bg-violet-500/10 dark:text-violet-400",
  sky: "bg-sky-50 text-sky-600 dark:bg-sky-500/10 dark:text-sky-400",
  amber: "bg-amber-50 text-amber-600 dark:bg-amber-500/10 dark:text-amber-400",
  emerald: "bg-emerald-50 text-emerald-600 dark:bg-emerald-500/10 dark:text-emerald-400",
  slate: "bg-slate-100 text-slate-600 dark:bg-slate-500/10 dark:text-slate-400",
};

export function StatCard({
  label,
  value,
  note,
  icon: Icon,
  tone = "indigo",
  className,
}: {
  label: string;
  value: string;
  note: string;
  icon: LucideIcon;
  tone?: StatCardTone;
  className?: string;
}) {
  return (
    <Card className={cn("gap-0 py-5 transition-shadow hover:shadow-md", className)}>
      <CardHeader className="px-5 pb-2">
        <div className="flex items-center justify-between gap-2">
          <p className="text-muted-foreground text-[13px] font-medium">{label}</p>
          <span
            className={cn(
              "flex size-10 shrink-0 items-center justify-center rounded-xl",
              TONE_CLASSES[tone],
            )}
          >
            <Icon className="size-5" />
          </span>
        </div>
      </CardHeader>
      <CardContent className="px-5">
        <p className="text-3xl font-bold tracking-tight">{value}</p>
        <p className="text-muted-foreground mt-1 text-xs">{note}</p>
      </CardContent>
    </Card>
  );
}
