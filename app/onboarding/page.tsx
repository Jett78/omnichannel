import { redirect } from "next/navigation";

import { OnboardingWizard } from "@/features/workspaces/onboarding-wizard";
import { getCurrentUser } from "@/lib/auth";
import { workspaceService } from "@/services/workspace.service";

/**
 * First-run onboarding — deliberately OUTSIDE the (dashboard) group so
 * the app sidebar/header never render here: a standalone, step-by-step
 * setup flow (workspace → invite team → connect a channel).
 */
export default async function OnboardingPage() {
  const user = await getCurrentUser();
  if (!user) redirect("/api/session-expired");
  const workspaces = await workspaceService.listWorkspacesForUser(user.id);
  if (workspaces.length > 0) redirect("/dashboard");

  return <OnboardingWizard userName={user.name} />;
}
