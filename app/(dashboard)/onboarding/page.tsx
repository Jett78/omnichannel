import Link from "next/link";
import { redirect } from "next/navigation";

import { Card, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { CreateWorkspaceForm } from "@/features/workspaces/create-workspace-form";
import { requireCurrentUser } from "@/lib/auth";
import { workspaceService } from "@/services/workspace.service";

const NEXT_STEPS = [
  { title: "Invite your team", body: "Add agents with Owner / Admin / Agent / Viewer roles from Settings." },
  {
    title: "Connect a channel",
    body: "Telegram first, then Messenger, Instagram and WhatsApp — adapters arrive in later phases.",
  },
] as const;

export default async function OnboardingPage() {
  const user = await requireCurrentUser();
  const workspaces = await workspaceService.listWorkspacesForUser(user.id);
  if (workspaces.length > 0) redirect("/dashboard");

  return (
    <div className="mx-auto flex max-w-2xl flex-col gap-6">
      <div>
        <h2 className="text-2xl font-semibold tracking-tight">
          Welcome, {user.name} — let&apos;s set up
        </h2>
        <p className="text-muted-foreground text-sm">
          Create your first workspace to start using the unified inbox.
        </p>
      </div>
      <CreateWorkspaceForm />
      {NEXT_STEPS.map((step, i) => (
        <Card key={step.title}>
          <CardHeader>
            <CardTitle>
              {i + 2} · {step.title}
            </CardTitle>
            <CardDescription>{step.body}</CardDescription>
          </CardHeader>
        </Card>
      ))}
      <p className="text-muted-foreground text-sm">
        Were you invited to a workspace? Open the invite link from your email, or{" "}
        <Link href="/accept-invite" className="underline underline-offset-4">
          paste it here
        </Link>
        .
      </p>
    </div>
  );
}
