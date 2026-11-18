"use client";

import { useRouter } from "next/navigation";
import {
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  Line,
  LineChart,
  Pie,
  PieChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";

import { PROVIDER_META } from "@/components/channel-icon";
import { PageHeader } from "@/components/layout/page-header";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import type { AnalyticsRange, RealAnalyticsData } from "@/features/analytics/real-data";
import { cn } from "@/lib/utils";

const RANGE_OPTIONS: Array<{ value: AnalyticsRange; label: string }> = [
  { value: "7", label: "7D" },
  { value: "30", label: "30D" },
  { value: "90", label: "90D" },
];

function formatMinutes(minutes: number | null): string {
  if (minutes === null) return "—";
  if (minutes < 60) return `${minutes} min`;
  const hours = Math.floor(minutes / 60);
  return `${hours}h ${Math.round(minutes % 60)}m`;
}

export function AnalyticsDashboard({
  data,
  range,
}: {
  data: RealAnalyticsData;
  range: AnalyticsRange;
}) {
  const router = useRouter();
  const tickInterval = range === "7" ? 0 : range === "30" ? 4 : 14;
  const hasData = data.totals.conversationsInRange > 0;

  const stats: Array<{ label: string; value: string; dot: string }> = [
    { label: "Open now", value: String(data.totals.openNow), dot: "bg-indigo-500" },
    { label: "Unassigned", value: String(data.totals.unassignedNow), dot: "bg-amber-500" },
    {
      label: "Conversations",
      value: String(data.totals.conversationsInRange),
      dot: "bg-violet-500",
    },
    { label: "Messages", value: String(data.totals.messagesInRange), dot: "bg-sky-500" },
    { label: "Resolved", value: String(data.totals.resolvedInRange), dot: "bg-emerald-500" },
    {
      label: "Avg first response",
      value: formatMinutes(data.totals.avgResponseMinutes),
      dot: "bg-slate-400",
    },
  ];

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title="Analytics"
        description="Volume, response times and team output across every channel — computed live from this workspace's real conversations."
        actions={
          <div
            className="bg-muted/70 flex rounded-lg p-0.5"
            role="tablist"
            aria-label="Date range"
          >
            {RANGE_OPTIONS.map((option) => (
              <button
                key={option.value}
                type="button"
                role="tab"
                aria-selected={range === option.value}
                title={`Last ${option.value} days`}
                onClick={() => router.push(`/analytics?range=${option.value}`)}
                className={cn(
                  "rounded-md px-3 py-1.5 text-xs font-medium transition-all",
                  range === option.value
                    ? "bg-background text-foreground shadow-sm"
                    : "text-muted-foreground hover:text-foreground",
                )}
              >
                {option.label}
              </button>
            ))}
          </div>
        }
      />

      {!hasData ? (
        <p className="text-muted-foreground rounded-lg border border-dashed px-4 py-6 text-center text-sm">
          No conversations in this workspace for the selected period yet. Once customers start
          messaging your connected channels, real numbers will appear here.
        </p>
      ) : null}

      <div className="grid grid-cols-2 gap-3 sm:gap-4 md:grid-cols-3 xl:grid-cols-6">
        {stats.map((stat) => (
          <Card key={stat.label} className="gap-0 py-4 transition-shadow hover:shadow-md">
            <CardContent className="px-4">
              <p className="text-[26px] leading-none font-bold tracking-tight">{stat.value}</p>
              <p className="text-muted-foreground flex items-center gap-1.5 pt-2 text-xs">
                <span className={cn("size-2 shrink-0 rounded-full", stat.dot)} />
                {stat.label}
              </p>
            </CardContent>
          </Card>
        ))}
      </div>

      <div className="grid gap-4 xl:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle>Conversation trend</CardTitle>
            <CardDescription>Conversations started and resolved per day</CardDescription>
          </CardHeader>
          <CardContent>
            <div className="h-60" role="img" aria-label="Line chart: conversation trend">
              <ResponsiveContainer width="100%" height="100%">
                <LineChart data={data.trend} margin={{ top: 8, right: 8, left: -16, bottom: 0 }}>
                  <CartesianGrid strokeDasharray="3 3" vertical={false} className="stroke-border" />
                  <XAxis dataKey="day" tickLine={false} axisLine={false} tick={{ fontSize: 12 }} interval={tickInterval} />
                  <YAxis tickLine={false} axisLine={false} tick={{ fontSize: 12 }} allowDecimals={false} />
                  <Tooltip />
                  <Line type="monotone" dataKey="conversations" name="Conversations" stroke="var(--chart-1)" strokeWidth={2} dot={false} />
                  <Line type="monotone" dataKey="resolved" name="Resolved" stroke="var(--chart-3)" strokeWidth={2} dot={false} />
                </LineChart>
              </ResponsiveContainer>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Conversations by channel</CardTitle>
            <CardDescription>Share of conversations started in the selected period</CardDescription>
          </CardHeader>
          <CardContent>
            {data.channelShare.length === 0 ? (
              <p className="text-muted-foreground py-10 text-center text-sm">
                No conversations in this period.
              </p>
            ) : (
              <div className="flex flex-wrap items-center gap-4">
                <div className="h-52 w-52 shrink-0" role="img" aria-label="Pie chart: conversations by channel">
                  <ResponsiveContainer width="100%" height="100%">
                    <PieChart>
                      <Tooltip />
                      <Pie
                        data={data.channelShare.map((entry) => ({
                          ...entry,
                          label: PROVIDER_META[entry.provider].shortLabel,
                        }))}
                        dataKey="conversations"
                        nameKey="label"
                        innerRadius={55}
                        outerRadius={85}
                        paddingAngle={2}
                      >
                        {data.channelShare.map((entry) => (
                          <Cell
                            key={entry.provider}
                            fill={PROVIDER_META[entry.provider].color}
                          />
                        ))}
                      </Pie>
                    </PieChart>
                  </ResponsiveContainer>
                </div>
                <ul className="min-w-44 flex-1 space-y-2 text-sm">
                  {data.channelShare.map((entry) => (
                    <li key={entry.provider} className="flex items-center gap-2">
                      <span
                        className="size-2.5 rounded-full"
                        style={{ backgroundColor: PROVIDER_META[entry.provider].color }}
                      />
                      <span className="flex-1">{PROVIDER_META[entry.provider].shortLabel}</span>
                      <span className="font-medium">{entry.conversations}</span>
                    </li>
                  ))}
                </ul>
              </div>
            )}
          </CardContent>
        </Card>
      </div>

      <div className="grid gap-4 xl:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle>First response time</CardTitle>
            <CardDescription>
              Average minutes from a customer&apos;s first message to the first agent reply
            </CardDescription>
          </CardHeader>
          <CardContent>
            <div className="h-52" role="img" aria-label="Bar chart: first response time">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={data.trend} margin={{ top: 8, right: 8, left: -16, bottom: 0 }}>
                  <CartesianGrid strokeDasharray="3 3" vertical={false} className="stroke-border" />
                  <XAxis dataKey="day" tickLine={false} axisLine={false} tick={{ fontSize: 12 }} interval={tickInterval} />
                  <YAxis tickLine={false} axisLine={false} tick={{ fontSize: 12 }} />
                  <Tooltip />
                  <Bar dataKey="responseMinutes" name="Avg response (min)" fill="var(--chart-4)" radius={[4, 4, 0, 0]} />
                </BarChart>
              </ResponsiveContainer>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Agent leaderboard</CardTitle>
            <CardDescription>Assignments, resolutions and speed in the selected period</CardDescription>
          </CardHeader>
          <CardContent>
            <div className="overflow-x-auto">
              <table className="w-full min-w-[420px] text-sm">
                <thead>
                  <tr className="text-muted-foreground border-b text-left text-xs">
                    <th className="pb-2 font-medium">Agent</th>
                    <th className="pb-2 font-medium">Assigned</th>
                    <th className="pb-2 font-medium">Resolved</th>
                    <th className="pb-2 font-medium">Avg first response</th>
                  </tr>
                </thead>
                <tbody className="divide-y">
                  {data.leaderboard.map((row) => (
                    <tr key={row.agentId}>
                      <td className="py-2.5 font-medium">{row.agent}</td>
                      <td className="py-2.5">{row.assigned}</td>
                      <td className="py-2.5">{row.resolved}</td>
                      <td className="py-2.5">{formatMinutes(row.avgResponseMinutes)}</td>
                    </tr>
                  ))}
                  {data.leaderboard.length === 0 ? (
                    <tr>
                      <td colSpan={4} className="text-muted-foreground py-6 text-center">
                        No agent activity in this period.
                      </td>
                    </tr>
                  ) : null}
                </tbody>
              </table>
            </div>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
