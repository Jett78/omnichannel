import type { Provider } from "@/generated/prisma/client";

/**
 * Serialized analytics shapes passed from the server page to the
 * client dashboard. Every value is aggregated from real workspace
 * data by services/analytics.service — there is no sample data.
 */
export type AnalyticsRange = "7" | "30" | "90";

export interface RealTrendPoint {
  day: string;
  conversations: number;
  resolved: number;
  responseMinutes: number | null;
}

export interface RealAnalyticsData {
  rangeDays: number;
  totals: {
    openNow: number;
    unassignedNow: number;
    conversationsInRange: number;
    messagesInRange: number;
    incomingMessages: number;
    outgoingMessages: number;
    resolvedInRange: number;
    avgResponseMinutes: number | null;
    avgResolutionMinutes: number | null;
  };
  trend: RealTrendPoint[];
  channelShare: Array<{ provider: Provider; conversations: number }>;
  leaderboard: Array<{
    agentId: string;
    agent: string;
    assigned: number;
    resolved: number;
    avgResponseMinutes: number | null;
  }>;
}
