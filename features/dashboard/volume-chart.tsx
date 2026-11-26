"use client";

import {
  Area,
  AreaChart,
  CartesianGrid,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";

export interface VolumePoint {
  day: string;
  conversations: number;
  resolved: number;
}

/** Real conversation volume (new + resolved per day) from the analytics service. */
export function VolumeChart({ data }: { data: VolumePoint[] }) {
  return (
    <div className="h-64 w-full" role="img" aria-label="Conversation volume, last 14 days">
      <ResponsiveContainer width="100%" height="100%">
        <AreaChart data={data} margin={{ top: 8, right: 8, left: -16, bottom: 0 }}>
          <defs>
            <linearGradient id="volumeFill" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor="var(--chart-1)" stopOpacity={0.28} />
              <stop offset="100%" stopColor="var(--chart-1)" stopOpacity={0.02} />
            </linearGradient>
          </defs>
          <CartesianGrid strokeDasharray="3 3" vertical={false} className="stroke-border" />
          <XAxis dataKey="day" tickLine={false} axisLine={false} tick={{ fontSize: 12 }} />
          <YAxis tickLine={false} axisLine={false} tick={{ fontSize: 12 }} />
          <Tooltip />
          <Area
            type="monotone"
            dataKey="conversations"
            name="Conversations"
            stroke="var(--chart-1)"
            strokeWidth={2}
            fill="url(#volumeFill)"
          />
          <Area
            type="monotone"
            dataKey="resolved"
            name="Resolved"
            stroke="var(--chart-3)"
            strokeWidth={2}
            fill="transparent"
          />
        </AreaChart>
      </ResponsiveContainer>
    </div>
  );
}
