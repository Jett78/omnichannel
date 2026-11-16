/**
 * SAMPLE DATA — UI preview only. Automation rules are fictional and
 * toggling them changes local UI state only; the automation builder
 * arrives after channels (Phase 7 in the Phase 0 plan).
 */
export interface SampleAutomationRule {
  id: string;
  name: string;
  trigger: string;
  action: string;
  enabled: boolean;
  runsLabel: string;
}

export const SAMPLE_AUTOMATION_RULES: SampleAutomationRule[] = [
  {
    id: "ar-1",
    name: "Welcome message on Telegram",
    trigger: "First message on Telegram",
    action: "Send greeting + collect order number",
    enabled: true,
    runsLabel: "128 runs this week",
  },
  {
    id: "ar-2",
    name: "Assign refunds to Support team",
    trigger: "Message contains “refund”",
    action: "Assign to Support team and tag “Refund”",
    enabled: true,
    runsLabel: "34 runs this week",
  },
  {
    id: "ar-3",
    name: "After-hours auto-reply",
    trigger: "Message outside 9:00–18:00 NPT",
    action: "Reply with opening hours and expected response time",
    enabled: false,
    runsLabel: "Not run yet",
  },
  {
    id: "ar-4",
    name: "Unassigned reminder",
    trigger: "Conversation unassigned for 30 minutes",
    action: "Notify workspace admins",
    enabled: true,
    runsLabel: "12 runs this week",
  },
];
