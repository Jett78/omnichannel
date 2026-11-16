"use client";

import { useState } from "react";
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

import { PageHeader } from "@/components/layout/page-header";
import { SampleBadge } from "@/components/sample-badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  SAMPLE_CHANNEL_SHARE,
  SAMPLE_LEADERBOARD,
  SAMPLE_TRENDS,
  type AnalyticsRange,
} from "@/features/analytics/sample-data";

export function AnalyticsDashboard() {
  const [range, setRange] = useState<AnalyticsRange>("30");
  const trend = SAMPLE_TRENDS[range];
  const tickInterval = range === "7" ? 0 : range === "30" ? 4 : 14;

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title="Analytics"
        description="Volume, response times and team output across every channel."
        actions={
          <>
            <SampleBadge />
            <Select value={range} onValueChange={(value) => setRange(value as AnalyticsRange)}>
              <SelectTrigger className="w-[150px]" aria-label="Date range">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="7">Last 7 days</SelectItem>
                <SelectItem value="30">Last 30 days</SelectItem>
                <SelectItem value="90">Last 90 days</SelectItem>
              </SelectContent>
            </Select>
          </>
        }
      />

      <div className="grid gap-4 xl:grid-cols-2">
        <Card className="shadow-none">
          <CardHeader>
            <CardTitle>Conversation trend</CardTitle>
            <CardDescription>Conversations started per day</CardDescription>
          </CardHeader>
          <CardContent>
            <div className="h-60" role="img" aria-label="Sample line chart: conversation trend">
              <ResponsiveContainer width="100%" height="100%">
                <LineChart data={trend} margin={{ top: 8, right: 8, left: -16, bottom: 0 }}>
                  <CartesianGrid strokeDasharray="3 3" vertical={false} className="stroke-border" />
                  <XAxis dataKey="day" tickLine={false} axisLine={false} tick={{ fontSize: 12 }} interval={tickInterval} />
                  <YAxis tickLine={false} axisLine={false} tick={{ fontSize: 12 }} />
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
            <CardDescription>Share of total volume in the selected period</CardDescription>
          </CardHeader>
          <CardContent>
            <div className="flex flex-wrap items-center gap-4">
              <div className="h-52 w-52 shrink-0" role="img" aria-label="Sample pie chart: conversations by channel">
                <ResponsiveContainer width="100%" height="100%">
                  <PieChart>
                    <Tooltip />
                    <Pie
                      data={SAMPLE_CHANNEL_SHARE}
                      dataKey="conversations"
                      nameKey="label"
                      innerRadius={55}
                      outerRadius={85}
                      paddingAngle={2}
                    >
                      {SAMPLE_CHANNEL_SHARE.map((entry) => (
                        <Cell key={entry.provider} fill={entry.color} />
                      ))}
                    </Pie>
                  </PieChart>
                </ResponsiveContainer>
              </div>
              <ul className="min-w-44 flex-1 space-y-2 text-sm">
                {SAMPLE_CHANNEL_SHARE.map((entry) => (
                  <li key={entry.provider} className="flex items-center gap-2">
                    <span className="size-2.5 rounded-full" style={{ backgroundColor: entry.color }} />
                    <span className="flex-1">{entry.label}</span>
                    <span className="font-medium">{entry.conversations}</span>
                  </li>
                ))}
              </ul>
            </div>
          </CardContent>
        </Card>
      </div>

      <div className="grid gap-4 xl:grid-cols-2">
        <Card className="shadow-none">
          <CardHeader>
            <CardTitle>First response time</CardTitle>
            <CardDescription>Average minutes to first reply</CardDescription>
          </CardHeader>
          <CardContent>
            <div className="h-52" role="img" aria-label="Sample bar chart: first response time">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={trend} margin={{ top: 8, right: 8, left: -16, bottom: 0 }}>
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
            <CardDescription>Resolution rate and speed per agent</CardDescription>
          </CardHeader>
          <CardContent>
            <div className="overflow-x-auto">
              <table className="w-full min-w-[420px] text-sm">
                <thead>
                  <tr className="text-muted-foreground border-b text-left text-xs">
                    <th className="pb-2 font-medium">Agent</th>
                    <th className="pb-2 font-medium">Resolved</th>
                    <th className="pb-2 font-medium">Rate</th>
                    <th className="pb-2 font-medium">Avg response</th>
                  </tr>
                </thead>
                <tbody className="divide-y">
                  {SAMPLE_LEADERBOARD.map((row) => (
                    <tr key={row.agent}>
                      <td className="py-2.5 font-medium">{row.agent}</td>
                      <td className="py-2.5">
                        {row.resolved} / {row.conversations}
                      </td>
                      <td className="py-2.5">{row.resolutionRate}%</td>
                      <td className="py-2.5">{row.avgResponseMinutes} min</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
