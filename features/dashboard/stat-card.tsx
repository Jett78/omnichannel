import type { LucideIcon } from "lucide-react";

import { Card, CardContent, CardHeader } from "@/components/ui/card";

export function StatCard({
  label,
  value,
  note,
  icon: Icon,
}: {
  label: string;
  value: string;
  note: string;
  icon: LucideIcon;
}) {
  return (
    <Card className="gap-0 py-5 shadow-none">
      <CardHeader className="px-5 pb-2">
        <div className="flex items-center justify-between">
          <p className="text-muted-foreground text-sm font-medium">{label}</p>
          <span className="bg-accent text-primary flex size-8 items-center justify-center rounded-lg">
            <Icon className="size-4" />
          </span>
        </div>
      </CardHeader>
      <CardContent className="px-5">
        <p className="text-3xl font-semibold tracking-tight">{value}</p>
        <p className="text-muted-foreground mt-1 text-xs">{note}</p>
      </CardContent>
    </Card>
  );
}
