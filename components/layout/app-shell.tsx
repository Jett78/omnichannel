"use client";

import { usePathname } from "next/navigation";
import { useState, type ReactNode } from "react";

import { Header, type HeaderNotification } from "@/components/layout/header";
import { Sidebar } from "@/components/layout/sidebar";
import type { WorkspaceOption } from "@/components/layout/workspace-switcher";
import { cn } from "@/lib/utils";

export function AppShell({
  children,
  user,
  workspaces = [],
  activeWorkspaceId = null,
  notifications = [],
}: {
  children: ReactNode;
  user?: { name: string; email: string };
  workspaces?: WorkspaceOption[];
  activeWorkspaceId?: string | null;
  notifications?: HeaderNotification[];
}) {
  const pathname = usePathname();
  const [mobileOpen, setMobileOpen] = useState(false);
  const fullBleed = pathname === "/inbox";

  return (
    <div className="flex min-h-screen w-full">
      <Sidebar
        workspaces={workspaces}
        activeWorkspaceId={activeWorkspaceId}
        user={user}
        className="sticky top-0 hidden h-screen lg:flex"
      />
      {mobileOpen ? (
        <div className="fixed inset-0 z-40 lg:hidden">
          <button
            type="button"
            aria-label="Close menu"
            className="absolute inset-0 bg-black/50"
            onClick={() => setMobileOpen(false)}
          />
          <Sidebar
            workspaces={workspaces}
            activeWorkspaceId={activeWorkspaceId}
            user={user}
            className="absolute inset-y-0 left-0 shadow-xl"
            onNavigate={() => setMobileOpen(false)}
          />
        </div>
      ) : null}
      <div className="flex min-w-0 flex-1 flex-col">
        <Header user={user} notifications={notifications} onMenuClick={() => setMobileOpen(true)} />
        <main className={cn("min-w-0 flex-1", fullBleed ? "" : "px-6 py-6")}>{children}</main>
      </div>
    </div>
  );
}
