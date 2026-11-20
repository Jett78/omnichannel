import { inAutomation } from "@/lib/automation-context";
import type { AutomationTrigger } from "@/services/automation.service";

/**
 * Phase 13B — the ONLY automation entry the messaging/conversation
 * services call. Lazily imports the engine (which itself imports those
 * services — a static import here would be circular), is guarded
 * against automation-caused recursion, and never throws into the
 * caller: automations must not break message ingest or agent actions.
 */
export async function fireAutomationEvent(
  workspaceId: string,
  trigger: AutomationTrigger,
  context: { conversationId: string },
): Promise<void> {
  if (inAutomation()) return;
  try {
    const { automationEngine } = await import("@/services/automation.service");
    await automationEngine.handleEvent(workspaceId, trigger, context);
  } catch (error) {
    console.error("[automation] hook failed", error);
  }
}
