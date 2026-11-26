import { ArrowRight, CheckCheck, Clock, Inbox, MessagesSquare, Plug, TriangleAlert, UserX } from "lucide-react";
import Link from "next/link";
import { redirect } from "next/navigation";

import { AvatarWithBadge } from "@/components/avatar-with-badge";
import { ChannelIcon, PROVIDER_META } from "@/components/channel-icon";
import { EmptyState } from "@/components/empty-state";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { formatLastActive } from "@/features/contacts/real-data";
import { StatCard } from "@/features/dashboard/stat-card";
import { TeamPerformanceChart } from "@/features/dashboard/team-performance-chart";
import { VolumeChart } from "@/features/dashboard/volume-chart";
import { getActiveWorkspace } from "@/lib/active-workspace";
import { getCurrentUser } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { analyticsService } from "@/services/analytics.service";
import { conversationService } from "@/services/conversation.service";
import { workspaceService } from "@/services/workspace.service";

function formatMinutes(minutes: number | null): string {
  if (minutes == null) return "—";
  if (minutes < 1) return "<1 min";
  if (minutes < 60) return `${Math.round(minutes)} min`;
  const hours = Math.floor(minutes / 60);
  const rest = Math.round(minutes % 60);
  return rest > 0 ? `${hours}h ${rest}m` : `${hours}h`;
}

export default async function DashboardPage() {
  const user = await getCurrentUser();
  if (!user) redirect("/api/session-expired");

  const workspaces = await workspaceService.listWorkspacesForUser(user.id);
  if (workspaces.length === 0) redirect("/onboarding");

  const active = await getActiveWorkspace(user.id);
  if (!active) redirect("/onboarding");

  const [total, open, unassigned, resolved, channels, activeMembership, analytics, recentList] =
    await Promise.all([
      prisma.conversation.count({ where: { workspaceId: active.id } }),
      prisma.conversation.count({ where: { workspaceId: active.id, status: "OPEN" } }),
      prisma.conversation.count({
        where: { workspaceId: active.id, status: "OPEN", assigneeId: null },
      }),
      prisma.conversation.count({ where: { workspaceId: active.id, status: "RESOLVED" } }),
      prisma.channel.findMany({
        where: { workspaceId: active.id },
        orderBy: { createdAt: "asc" },
      }),
      prisma.workspaceMember.findUnique({
        where: { workspaceId_userId: { workspaceId: active.id, userId: user.id } },
        select: { role: true },
      }),
      analyticsService.getAnalytics(user.id, active.id, 30),
      conversationService.listConversations(user.id, active.id, { limit: 5 }),
    ]);

  const recent = recentList.items;
  const firstName = user.name.split(" ")[0] || user.name;
  const hourRaw = Number(
    new Intl.DateTimeFormat("en-US", {
      hour: "numeric",
      hour12: false,
      timeZone: active.timezone,
    }).format(new Date()),
  );
  const hourInTz = Number.isNaN(hourRaw) ? 12 : hourRaw % 24;
  const greeting = hourInTz < 12 ? "Good morning" : hourInTz < 17 ? "Good afternoon" : "Good evening";
  const todayLabel = new Intl.DateTimeFormat("en-GB", {
    weekday: "long",
    day: "numeric",
    month: "long",
    timeZone: active.timezone,
  }).format(new Date());
  const connectedCount = channels.filter((c) => c.status === "CONNECTED").length;
  const attention: Array<{ text: string; href: string; cta: string }> = [];
  if (unassigned > 0) {
    attention.push({
      text: `${unassigned} unassigned conversation${unassigned === 1 ? "" : "s"} waiting for an agent`,
      href: "/inbox?view=unassigned",
      cta: "Open unassigned",
    });
  }
  for (const channel of channels) {
    if (channel.status !== "CONNECTED" && attention.length < 3) {
      attention.push({
        text: `${channel.displayName} (${PROVIDER_META[channel.provider].label}) is ${channel.status.toLowerCase()}`,
        href: "/channels",
        cta: "Open Channels",
      });
    }
  }
  const canConnect = activeMembership?.role === "OWNER" || activeMembership?.role === "ADMIN";

  const noDataNote = total === 0 ? "Connect a channel to get started" : "All time";

  return (
    <div className="flex flex-col gap-6">
      {/* Greeting hero — gradient, matching the Channels hero language */}
      <section className="relative overflow-hidden rounded-3xl bg-gradient-to-br from-indigo-600 via-violet-600 to-fuchsia-600 px-6 py-7 text-white sm:px-8">
        <div
          aria-hidden
          className="pointer-events-none absolute -top-24 -right-16 size-64 rounded-full bg-white/10 blur-2xl"
        />
        <div
          aria-hidden
          className="pointer-events-none absolute -bottom-28 left-1/3 size-56 rounded-full bg-fuchsia-300/20 blur-3xl"
        />
        <div className="relative flex flex-wrap items-end justify-between gap-6">
          <div className="max-w-xl">
            <p className="text-xs font-semibold tracking-widest text-indigo-100 uppercase">
              {todayLabel} · {active.name}
            </p>
            <h2 className="pt-2 text-3xl font-bold tracking-tight">
              {greeting}, {firstName}
            </h2>
            <p className="pt-2 text-sm leading-relaxed text-indigo-100">
              {open > 0
                ? `You have ${open} open conversation${open === 1 ? "" : "s"}${
                    unassigned > 0 ? `, and ${unassigned} of them still need an agent` : ""
                  }.`
                : "All caught up — no open conversations right now."}
            </p>
            <div className="flex flex-wrap gap-2 pt-4">
              <Button asChild className="bg-white text-indigo-700 hover:bg-indigo-50">
                <Link href="/inbox">
                  Open inbox <ArrowRight className="size-4" />
                </Link>
              </Button>
              {canConnect ? (
                <Button
                  asChild
                  variant="outline"
                  className="border-white/40 bg-white/10 text-white hover:bg-white/20 hover:text-white"
                >
                  <Link href="/channels">Connect a channel</Link>
                </Button>
              ) : null}
            </div>
          </div>
          <div className="flex flex-wrap gap-2.5">
            {[
              { label: "Open now", value: open },
              { label: "Unassigned", value: unassigned },
              { label: "Channels live", value: `${connectedCount}/${channels.length}` },
            ].map((tile) => (
              <div
                key={tile.label}
                className="rounded-2xl bg-white/10 px-4 py-3 ring-1 ring-white/25 backdrop-blur"
              >
                <p className="text-2xl font-bold">{tile.value}</p>
                <p className="text-[11px] tracking-wide text-indigo-100 uppercase">{tile.label}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {attention.length > 0 ? (
        <section className="flex flex-col gap-2 rounded-2xl border border-amber-200 bg-amber-50 p-4 dark:border-amber-500/25 dark:bg-amber-500/10">
          <p className="flex items-center gap-2 text-sm font-semibold text-amber-800 dark:text-amber-300">
            <TriangleAlert className="size-4" /> Needs your attention
          </p>
          <ul className="flex flex-col gap-1.5">
            {attention.map((item) => (
              <li
                key={item.text}
                className="flex flex-wrap items-center justify-between gap-2 text-sm text-amber-900 dark:text-amber-200"
              >
                <span>{item.text}</span>
                <Link href={item.href} className="font-medium underline underline-offset-4">
                  {item.cta}
                </Link>
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      <div className="grid grid-cols-2 gap-3 sm:gap-4 xl:grid-cols-5">
        <StatCard
          label="Total conversations"
          value={String(total)}
          note={noDataNote}
          icon={MessagesSquare}
          tone="violet"
        />
        <StatCard
          label="Open conversations"
          value={String(open)}
          note={noDataNote}
          icon={Inbox}
          tone="indigo"
        />
        <StatCard
          label="Unassigned"
          value={String(unassigned)}
          note="Waiting for an agent"
          icon={UserX}
          tone="amber"
        />
        <StatCard
          label="Resolved"
          value={String(resolved)}
          note={noDataNote}
          icon={CheckCheck}
          tone="emerald"
        />
        <StatCard
          label="Avg. response time"
          value={formatMinutes(analytics.totals.avgResponseMinutes)}
          note={
            analytics.totals.avgResponseMinutes == null
              ? "No replies in the last 30 days"
              : "First reply · last 30 days"
          }
          icon={Clock}
          tone="sky"
          className="col-span-2 xl:col-span-1"
        />
      </div>

      <div className="grid gap-4 xl:grid-cols-2">
        <Card className="min-w-0">
          <CardHeader>
            <div>
              <CardTitle>Conversation volume</CardTitle>
              <CardDescription>New and resolved conversations · last 14 days</CardDescription>
            </div>
          </CardHeader>
          <CardContent>
            {analytics.totals.conversationsInRange === 0 ? (
              <p className="text-muted-foreground py-8 text-center text-sm">
                No conversations in the last 14 days.
              </p>
            ) : (
              <VolumeChart
                data={analytics.trend.slice(-14).map((point) => ({
                  day: point.day,
                  conversations: point.conversations,
                  resolved: point.resolved,
                }))}
              />
            )}
          </CardContent>
        </Card>
        <Card className="min-w-0">
          <CardHeader>
            <div>
              <CardTitle>Team performance</CardTitle>
              <CardDescription>Resolved conversations per agent · last 30 days</CardDescription>
            </div>
          </CardHeader>
          <CardContent>
            <TeamPerformanceChart data={analytics.leaderboard} />
          </CardContent>
        </Card>
      </div>

      <div className="grid gap-4 xl:grid-cols-2">
        <Card className="min-w-0">
          <CardHeader>
            <CardTitle>Recent conversations</CardTitle>
            <CardDescription>Latest activity across your channels.</CardDescription>
          </CardHeader>
          <CardContent>
            {recent.length === 0 ? (
              <EmptyState
                icon={Inbox}
                title="No conversations yet"
                description="Conversations appear here as soon as a customer messages one of your connected channels."
              />
            ) : (
              <ul className="divide-y">
                {recent.map((conversation) => (
                  <li key={conversation.id}>
                    <Link
                      href={`/inbox?c=${conversation.id}`}
                      className="hover:bg-accent/60 -mx-2 flex items-center gap-3 rounded-md px-2 py-2.5"
                    >
                      <AvatarWithBadge
                        name={conversation.contact.displayName}
                        image={conversation.contact.avatarUrl}
                        provider={conversation.channel.provider}
                        size="sm"
                      />
                      <span className="min-w-0 flex-1">
                        <span className="block truncate text-sm font-medium">
                          {conversation.contact.displayName}
                        </span>
                        <span className="text-muted-foreground block truncate text-xs">
                          {conversation.preview ?? "No messages yet"}
                        </span>
                      </span>
                      {conversation.unreadCount > 0 ? (
                        <Badge variant="info">{conversation.unreadCount} new</Badge>
                      ) : null}
                      <span className="text-muted-foreground shrink-0 text-xs">
                        {formatLastActive(conversation.lastMessageAt?.toISOString() ?? null)}
                      </span>
                    </Link>
                  </li>
                ))}
              </ul>
            )}
          </CardContent>
        </Card>

        <Card className="min-w-0">
          <CardHeader>
            <CardTitle>Channel health</CardTitle>
            <CardDescription>
              Live status of this workspace&apos;s connected channels.
            </CardDescription>
          </CardHeader>
          <CardContent>
            {channels.length === 0 ? (
              <EmptyState
                icon={Plug}
                title="No channels connected yet"
                description="Connect Telegram, Messenger, Instagram or WhatsApp to start receiving conversations here."
                action={
                  <Button variant="outline" size="sm" asChild className="mt-2">
                    <Link href="/channels">Browse channels</Link>
                  </Button>
                }
              />
            ) : (
              <ul className="divide-y">
                {channels.map((channel) => (
                  <li key={channel.id} className="flex items-center gap-3 py-2.5">
                    <ChannelIcon provider={channel.provider} size="sm" />
                    <span className="min-w-0 flex-1 truncate text-sm font-medium">
                      {channel.displayName}
                    </span>
                    <span className="text-muted-foreground hidden text-xs min-[480px]:block">
                      {PROVIDER_META[channel.provider].label}
                    </span>
                    <span className="flex shrink-0 items-center gap-1.5">
                      <span
                        className={
                          channel.status === "CONNECTED"
                            ? "size-2 rounded-full bg-emerald-500"
                            : "size-2 rounded-full bg-amber-500"
                        }
                      />
                      <Badge variant={channel.status === "CONNECTED" ? "success" : "warning"}>
                        {channel.status}
                      </Badge>
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Your workspaces</CardTitle>
          <CardDescription>
            Every workspace is fully isolated — members, channels, contacts.
          </CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col gap-2">
          {workspaces.map((workspace) => (
            <div
              key={workspace.id}
              className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1 rounded-lg px-2 py-1.5 text-sm hover:bg-accent/50"
            >
              <span>
                <span className="font-medium">{workspace.name}</span>{" "}
                <span className="text-muted-foreground">/{workspace.slug}</span>
                {workspace.id === active.id ? (
                  <Badge variant="secondary" className="ml-2">
                    Active
                  </Badge>
                ) : null}
              </span>
              <span className="text-muted-foreground">
                {workspace.members[0]?.role ?? ""} · {workspace.timezone}
              </span>
            </div>
          ))}
          <Link href="/team" className="text-primary text-sm underline-offset-4 hover:underline">
            Manage team members
          </Link>
        </CardContent>
      </Card>
    </div>
  );
}
