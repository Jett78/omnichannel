/**
 * SAMPLE DATA — UI preview only. Chart series for the dashboard are
 * fictional and clearly labeled "Sample preview" in the UI; the stat
 * cards above them use real database counts.
 */
export interface VolumePoint {
  day: string;
  conversations: number;
  resolved: number;
}

export const SAMPLE_VOLUME_14D: VolumePoint[] = [
  { day: "Nov 3", conversations: 42, resolved: 35 },
  { day: "Nov 4", conversations: 55, resolved: 44 },
  { day: "Nov 5", conversations: 48, resolved: 41 },
  { day: "Nov 6", conversations: 63, resolved: 50 },
  { day: "Nov 7", conversations: 71, resolved: 58 },
  { day: "Nov 8", conversations: 39, resolved: 33 },
  { day: "Nov 9", conversations: 34, resolved: 29 },
  { day: "Nov 10", conversations: 58, resolved: 47 },
  { day: "Nov 11", conversations: 66, resolved: 55 },
  { day: "Nov 12", conversations: 74, resolved: 61 },
  { day: "Nov 13", conversations: 69, resolved: 57 },
  { day: "Nov 14", conversations: 81, resolved: 68 },
  { day: "Nov 15", conversations: 52, resolved: 44 },
  { day: "Nov 16", conversations: 47, resolved: 31 },
];

export interface TeamPerformanceRow {
  agent: string;
  resolved: number;
  avgResponseMinutes: number;
}

export const SAMPLE_TEAM_PERFORMANCE: TeamPerformanceRow[] = [
  { agent: "Anisha Sharma", resolved: 132, avgResponseMinutes: 4 },
  { agent: "Rohan Karki", resolved: 118, avgResponseMinutes: 6 },
  { agent: "Priya Singh", resolved: 104, avgResponseMinutes: 5 },
  { agent: "Bibek Tamang", resolved: 87, avgResponseMinutes: 8 },
];
