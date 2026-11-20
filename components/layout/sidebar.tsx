"use client";

import {
  BarChart3,
  Bot,
  Cable,
  CircleHelp,
  Inbox,
  LayoutDashboard,
  Settings,
  Users,
  X,
} from "lucide-react";
import Link from "next/link";
import { usePathname } from "next/navigation";

import { AvatarWithBadge } from "@/components/avatar-with-badge";
import { LogoutButton } from "@/components/layout/logout-button";
import { WorkspaceSwitcher, type WorkspaceOption } from "@/components/layout/workspace-switcher";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";

const NAV_ITEMS = [
  { href: "/dashboard", label: "Overview", icon: LayoutDashboard },
  { href: "/inbox", label: "Inbox", icon: Inbox, badge: "inbox" as const },
  { href: "/contacts", label: "Contacts", icon: Users },
  { href: "/channels", label: "Channels", icon: Cable },
  { href: "/automation", label: "Automation", icon: Bot },
  { href: "/team", label: "Team", icon: Users },
  { href: "/analytics", label: "Analytics", icon: BarChart3 },
  { href: "/settings", label: "Settings", icon: Settings },
] as const;

export function Sidebar({
  workspaces = [],
  activeWorkspaceId = null,
  user,
  inboxOpenCount = 0,
  className,
  onNavigate,
}: {
  workspaces?: WorkspaceOption[];
  activeWorkspaceId?: string | null;
  user?: { name: string; email: string };
  /** Real count of OPEN conversations in the active workspace. */
  inboxOpenCount?: number;
  className?: string;
  onNavigate?: () => void;
}) {
  const pathname = usePathname();
  return (
    <aside
      className={cn(
        "bg-sidebar text-sidebar-foreground flex w-64 shrink-0 flex-col border-r",
        className,
      )}
    >
      <div className="flex h-14 items-center gap-2 border-b px-4">
        <span className="flex size-8 shrink-0 items-center justify-center rounded-lg bg-gradient-to-br from-indigo-500 to-violet-600 text-sm font-bold text-white shadow-sm">
          U
        </span>
        <div className="min-w-0 flex-1 leading-tight">
          <p className="truncate text-sm font-semibold">Unified Inbox</p>
          <p className="text-muted-foreground truncate text-xs">Omnichannel workspace</p>
        </div>
        {onNavigate ? (
          <button
            type="button"
            onClick={onNavigate}
            aria-label="Close menu"
            className="hover:bg-accent rounded-md p-1.5 lg:hidden"
          >
            <X className="size-4" />
          </button>
        ) : null}
      </div>

      <div className="border-b px-3 py-3">
        <p className="text-muted-foreground px-1 pb-1.5 text-[11px] font-medium tracking-wide uppercase">
          Workspace
        </p>
        <WorkspaceSwitcher workspaces={workspaces} activeWorkspaceId={activeWorkspaceId} />
      </div>

      <nav className="flex flex-col gap-0.5 overflow-y-auto p-3" aria-label="Main navigation">
        {NAV_ITEMS.map((item) => {
          const active = pathname === item.href || pathname.startsWith(`${item.href}/`);
          const Icon = item.icon;
          return (
            <Link
              key={item.href}
              href={item.href}
              onClick={onNavigate}
              className={cn(
                "relative flex items-center gap-3 rounded-lg px-3 py-2 text-sm font-medium transition-colors",
                active
                  ? "bg-sidebar-accent text-sidebar-accent-foreground font-semibold before:absolute before:inset-y-1.5 before:left-0 before:w-[3px] before:rounded-full before:bg-indigo-500"
                  : "text-muted-foreground hover:bg-sidebar-accent hover:text-sidebar-accent-foreground",
              )}
            >
              <Icon className="size-4 shrink-0" />
              <span className="flex-1">{item.label}</span>
              {"badge" in item && item.badge === "inbox" && inboxOpenCount > 0 ? (
                <Badge variant="info" className="px-1.5" title="Open conversations">
                  {inboxOpenCount}
                </Badge>
              ) : null}
            </Link>
          );
        })}
      </nav>

      <div className="mt-auto border-t p-3">
        <Link
          href="/settings"
          onClick={onNavigate}
          className="text-muted-foreground hover:bg-sidebar-accent hover:text-sidebar-accent-foreground flex items-center gap-3 rounded-md px-3 py-2 text-sm font-medium"
        >
          <CircleHelp className="size-4" />
          Help &amp; docs
        </Link>
        {user ? (
          <div className="flex items-center gap-2.5 px-2 pt-3">
            <AvatarWithBadge name={user.name || user.email} size="sm" />
            <div className="min-w-0 flex-1 leading-tight">
              <p className="truncate text-sm font-medium">{user.name}</p>
              <p className="text-muted-foreground truncate text-xs">{user.email}</p>
            </div>
            <LogoutButton iconOnly />
          </div>
        ) : null}
      </div>
    </aside>
  );
}
