import { FlaskConical } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";

/**
 * REQUIRED wherever sample/preview data is rendered. Sample data lives
 * in features/<module>/sample-data.ts, is never written to the database
 * and must never be presented as real — this badge keeps that honest.
 */
export function SampleBadge({ className }: { className?: string }) {
  return (
    <Badge variant="warning" className={cn("gap-1", className)}>
      <FlaskConical />
      Sample preview
    </Badge>
  );
}
