import { CheckCheck, Clock, Inbox, MessagesSquare, Plug, UserX } from "lucide-react";
import Link from "next/link";
import { redirect } from "next/navigation";

import { AvatarWithBadge } from "@/components/avatar-with-badge";
import { ChannelIcon, PROVIDER_META } from "@/components/channel-icon";
import { EmptyState } from "@/components/empty-state";
import { PageHeader } from "@/components/layout/page-header";
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
  const noDataNote = total === 0 ? "Connect a channel to get started" : "All time";

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title={`Overview — ${active.name}`}
        description={`Signed in as ${user.name} (${user.email})${user.emailVerified ? "" : " — email not verified yet"}${activeMembership ? ` · your role: ${activeMembership.role}` : ""}.`}
        actions={
          <Button asChild>
            <Link href="/channels">Connect a channel</Link>
          </Button>
        }
      />

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
        <Card>
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
        <Card>
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
        <Card>
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

        <Card>
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
                    <span className="flex-1 text-sm font-medium">{channel.displayName}</span>
                    <span className="text-muted-foreground text-xs">
                      {PROVIDER_META[channel.provider].label}
                    </span>
                    <Badge variant={channel.status === "CONNECTED" ? "success" : "warning"}>
                      {channel.status}
                    </Badge>
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
