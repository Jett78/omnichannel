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
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import type { AnalyticsRange, RealAnalyticsData } from "@/features/analytics/real-data";

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

  const stats: Array<{ label: string; value: string }> = [
    { label: "Open now", value: String(data.totals.openNow) },
    { label: "Unassigned", value: String(data.totals.unassignedNow) },
    { label: "Conversations", value: String(data.totals.conversationsInRange) },
    { label: "Messages", value: String(data.totals.messagesInRange) },
    { label: "Resolved", value: String(data.totals.resolvedInRange) },
    { label: "Avg first response", value: formatMinutes(data.totals.avgResponseMinutes) },
  ];

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title="Analytics"
        description="Volume, response times and team output across every channel — computed live from this workspace's real conversations."
        actions={
          <Select
            value={range}
            onValueChange={(value) => router.push(`/analytics?range=${value}`)}
          >
            <SelectTrigger className="w-[150px]" aria-label="Date range">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="7">Last 7 days</SelectItem>
              <SelectItem value="30">Last 30 days</SelectItem>
              <SelectItem value="90">Last 90 days</SelectItem>
            </SelectContent>
          </Select>
        }
      />

      {!hasData ? (
        <p className="text-muted-foreground rounded-lg border border-dashed px-4 py-6 text-center text-sm">
          No conversations in this workspace for the selected period yet. Once customers start
          messaging your connected channels, real numbers will appear here.
        </p>
      ) : null}

      <div className="grid grid-cols-2 gap-4 md:grid-cols-3 xl:grid-cols-6">
        {stats.map((stat) => (
          <Card key={stat.label} className="shadow-none">
            <CardContent className="pt-4">
              <p className="text-2xl font-semibold tracking-tight">{stat.value}</p>
              <p className="text-muted-foreground pt-1 text-xs">{stat.label}</p>
            </CardContent>
          </Card>
        ))}
      </div>

      <div className="grid gap-4 xl:grid-cols-2">
        <Card className="shadow-none">
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

        <Card className="shadow-none">
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
        <Card className="shadow-none">
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

        <Card className="shadow-none">
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
