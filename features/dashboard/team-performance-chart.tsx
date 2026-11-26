"use client";

import { Bar, BarChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";

export interface TeamPerformanceRow {
  agentId: string;
  agent: string;
  resolved: number;
  avgResponseMinutes: number | null;
}

/** Real per-agent resolved counts + first-response times (analytics service). */
export function TeamPerformanceChart({ data }: { data: TeamPerformanceRow[] }) {
  if (data.length === 0) {
    return (
      <p className="text-muted-foreground py-8 text-center text-sm">
        No agent activity in the last 30 days yet.
      </p>
    );
  }
  return (
    <div className="flex flex-col gap-4">
      <div
        className="h-44 w-full"
        role="img"
        aria-label="Resolved conversations per agent, last 30 days"
      >
        <ResponsiveContainer width="100%" height="100%">
          <BarChart data={data} margin={{ top: 8, right: 8, left: -16, bottom: 0 }}>
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
        {data.map((row) => (
          <li key={row.agentId} className="flex items-center justify-between py-2 text-sm">
            <span className="font-medium">{row.agent}</span>
            <span className="text-muted-foreground">
              {row.resolved} resolved · avg first response{" "}
              {row.avgResponseMinutes != null ? `${Math.round(row.avgResponseMinutes)} min` : "—"}
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
}
