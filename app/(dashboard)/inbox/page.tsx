import { redirect } from "next/navigation";

import { InboxShell } from "@/features/inbox/inbox-shell";
import { getCurrentUser } from "@/lib/auth";

export default async function InboxPage() {
  const user = await getCurrentUser();
  if (!user) redirect("/login");

  return <InboxShell currentUserName={user.name} />;
}
