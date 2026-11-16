import { redirect } from "next/navigation";
import type { ReactNode } from "react";

import { getCurrentUser } from "@/lib/auth";

export default async function AuthLayout({ children }: { children: ReactNode }) {
  const user = await getCurrentUser();
  if (user) redirect("/dashboard");

  return (
    <div className="bg-muted/40 flex min-h-screen flex-col items-center justify-center gap-6 p-6">
      <div className="flex items-center gap-2">
        <span className="bg-primary text-primary-foreground flex size-9 items-center justify-center rounded-md text-base font-bold">
          U
        </span>
        <span className="text-lg font-semibold">Unified Omnichannel Inbox</span>
      </div>
      {children}
    </div>
  );
}
