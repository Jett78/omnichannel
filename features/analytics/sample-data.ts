import type { Provider } from "@/generated/prisma/client";

/**
 * SAMPLE DATA — UI preview only. Analytics series are fictional,
 * deterministic (computed from fixed formulas, never random at render)
 * and labeled "Sample preview" wherever they appear.
 */
export type AnalyticsRange = "7" | "30" | "90";

export interface TrendPoint {
  day: string;
  conversations: number;
  responseMinutes: number;
  resolved: number;
}

function buildTrend(days: number): TrendPoint[] {
  const points: TrendPoint[] = [];
  for (let i = days - 1; i >= 0; i -= 1) {
    const wave = Math.sin((days - i) / 3.1) * 12;
    const base = 52 + wave + ((days - i) % 7 === 0 ? -14 : 0);
    const conversations = Math.max(12, Math.round(base));
    points.push({
      day: `Day ${days - i}`,
      conversations,
      responseMinutes: Math.max(3, Math.round(9 - wave / 6)),
      resolved: Math.round(conversations * 0.82),
    });
  }
  return points;
}

export const SAMPLE_TRENDS: Record<AnalyticsRange, TrendPoint[]> = {
  "7": buildTrend(7),
  "30": buildTrend(30),
  "90": buildTrend(90),
};

export interface ChannelShare {
  provider: Provider;
  label: string;
  conversations: number;
  color: string;
}

export const SAMPLE_CHANNEL_SHARE: ChannelShare[] = [
  { provider: "WHATSAPP", label: "WhatsApp", conversations: 486, color: "#25d366" },
  { provider: "FACEBOOK", label: "Messenger", conversations: 312, color: "#1877f2" },
  { provider: "TELEGRAM", label: "Telegram", conversations: 148, color: "#229ed9" },
  { provider: "INSTAGRAM", label: "Instagram", conversations: 121, color: "#e1306c" },
];

export interface LeaderboardRow {
  agent: string;
  conversations: number;
  resolved: number;
  resolutionRate: number;
  avgResponseMinutes: number;
}

export const SAMPLE_LEADERBOARD: LeaderboardRow[] = [
  { agent: "Anisha Sharma", conversations: 214, resolved: 198, resolutionRate: 93, avgResponseMinutes: 4 },
  { agent: "Rohan Karki", conversations: 196, resolved: 174, resolutionRate: 89, avgResponseMinutes: 6 },
  { agent: "Priya Singh", conversations: 171, resolved: 155, resolutionRate: 91, avgResponseMinutes: 5 },
  { agent: "Bibek Tamang", conversations: 143, resolved: 121, resolutionRate: 85, avgResponseMinutes: 8 },
];
