import { redirect } from "next/navigation";

import { AnalyticsDashboard } from "@/features/analytics/analytics-dashboard";
import type { AnalyticsRange } from "@/features/analytics/real-data";
import { getActiveWorkspace } from "@/lib/active-workspace";
import { getCurrentUser } from "@/lib/auth";
import { analyticsService } from "@/services/analytics.service";

/**
 * Analytics page — fully real data. Aggregated server-side from the
 * active workspace's conversations, messages, assignments and audit
 * log by services/analytics.service; the range comes from ?range=.
 */
export default async function AnalyticsPage({
  searchParams,
}: {
  searchParams: Promise<{ range?: string }>;
}) {
  const user = await getCurrentUser();
  if (!user) redirect("/api/session-expired");

  const active = await getActiveWorkspace(user.id);
  if (!active) redirect("/onboarding");

  const { range: rangeParam } = await searchParams;
  const range: AnalyticsRange = rangeParam === "7" || rangeParam === "90" ? rangeParam : "30";
  const data = await analyticsService.getAnalytics(
    user.id,
    active.id,
    Number(range) as 7 | 30 | 90,
  );

  return <AnalyticsDashboard data={data} range={range} />;
}
