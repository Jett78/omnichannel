"use client";

import { usePathname } from "next/navigation";
import { useEffect, useState, type ReactNode } from "react";

import {
  Header,
  type HeaderNotification,
  type HeaderSearchContact,
  type HeaderSearchConversation,
} from "@/components/layout/header";
import { Sidebar } from "@/components/layout/sidebar";
import type { WorkspaceOption } from "@/components/layout/workspace-switcher";
import { cn } from "@/lib/utils";

export function AppShell({
  children,
  user,
  workspaces = [],
  activeWorkspaceId = null,
  notifications = [],
  inboxOpenCount = 0,
  searchContacts = [],
  searchConversations = [],
}: {
  children: ReactNode;
  user?: { name: string; email: string };
  workspaces?: WorkspaceOption[];
  activeWorkspaceId?: string | null;
  notifications?: HeaderNotification[];
  inboxOpenCount?: number;
  searchContacts?: HeaderSearchContact[];
  searchConversations?: HeaderSearchConversation[];
}) {
  const pathname = usePathname();
  const [mobileOpen, setMobileOpen] = useState(false);
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  const fullBleed = pathname === "/inbox";

  // Desktop sidebar collapse (icon rail) persists across reloads.
  useEffect(() => {
    try {
      if (window.localStorage.getItem("omnichannel:sidebar-collapsed") === "1") {
        // eslint-disable-next-line react-hooks/set-state-in-effect
        setSidebarCollapsed(true);
      }
    } catch {
      // Storage unavailable (private mode) — sidebar just stays expanded.
    }
  }, []);

  function toggleSidebar() {
    setSidebarCollapsed((value) => {
      try {
        window.localStorage.setItem("omnichannel:sidebar-collapsed", value ? "0" : "1");
      } catch {
        // Non-fatal: the choice simply won't persist.
      }
      return !value;
    });
  }

  return (
    <div className="flex min-h-screen w-full">
      <Sidebar
        workspaces={workspaces}
        activeWorkspaceId={activeWorkspaceId}
        user={user}
        inboxOpenCount={inboxOpenCount}
        collapsed={sidebarCollapsed}
        onToggleCollapse={toggleSidebar}
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
            inboxOpenCount={inboxOpenCount}
            className="absolute inset-y-0 left-0 shadow-xl"
            onNavigate={() => setMobileOpen(false)}
          />
        </div>
      ) : null}
      <div className="bg-muted/40 flex min-w-0 flex-1 flex-col">
        <Header
          user={user}
          notifications={notifications}
          searchContacts={searchContacts}
          searchConversations={searchConversations}
          onMenuClick={() => setMobileOpen(true)}
        />
        <main className={cn("min-w-0 flex-1", fullBleed ? "" : "px-4 py-5 sm:px-6 sm:py-6 lg:px-8")}>
          {children}
        </main>
      </div>
    </div>
  );
}
