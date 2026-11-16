"use client";

import { Bar, BarChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";

import { SAMPLE_TEAM_PERFORMANCE } from "@/features/dashboard/sample-data";

export function TeamPerformanceChart() {
  return (
    <div className="flex flex-col gap-4">
      <div
        className="h-44 w-full"
        role="img"
        aria-label="Sample chart: resolved conversations per agent"
      >
        <ResponsiveContainer width="100%" height="100%">
          <BarChart data={SAMPLE_TEAM_PERFORMANCE} margin={{ top: 8, right: 8, left: -16, bottom: 0 }}>
            <CartesianGrid strokeDasharray="3 3" vertical={false} className="stroke-border" />
            <XAxis
              dataKey="agent"
              tickLine={false}
              axisLine={false}
              tick={{ fontSize: 11 }}
              tickFormatter={(value: string) => value.split(" ")[0] ?? value}
            />
            <YAxis tickLine={false} axisLine={false} tick={{ fontSize: 12 }} />
            <Tooltip />
            <Bar dataKey="resolved" name="Resolved" fill="var(--chart-1)" radius={[4, 4, 0, 0]} />
          </BarChart>
        </ResponsiveContainer>
      </div>
      <ul className="divide-y">
        {SAMPLE_TEAM_PERFORMANCE.map((row) => (
          <li key={row.agent} className="flex items-center justify-between py-2 text-sm">
            <span className="font-medium">{row.agent}</span>
            <span className="text-muted-foreground">
              {row.resolved} resolved · avg first response {row.avgResponseMinutes} min
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
}
