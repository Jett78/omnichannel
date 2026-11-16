import { CheckCheck, Clock, Inbox, MessagesSquare, Plug, UserX } from "lucide-react";
import Link from "next/link";
import { redirect } from "next/navigation";

import { AvatarWithBadge } from "@/components/avatar-with-badge";
import { ChannelIcon, PROVIDER_META } from "@/components/channel-icon";
import { EmptyState } from "@/components/empty-state";
import { PageHeader } from "@/components/layout/page-header";
import { SampleBadge } from "@/components/sample-badge";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { StatCard } from "@/features/dashboard/stat-card";
import { TeamPerformanceChart } from "@/features/dashboard/team-performance-chart";
import { VolumeChart } from "@/features/dashboard/volume-chart";
import { SAMPLE_CONVERSATIONS } from "@/features/inbox/sample-data";
import { getActiveWorkspace } from "@/lib/active-workspace";
import { getCurrentUser } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { workspaceService } from "@/services/workspace.service";

export default async function DashboardPage() {
  const user = await getCurrentUser();
  if (!user) redirect("/api/session-expired");

  const workspaces = await workspaceService.listWorkspacesForUser(user.id);
  if (workspaces.length === 0) redirect("/onboarding");

  const active = await getActiveWorkspace(user.id);
  if (!active) redirect("/onboarding");

  const [total, open, unassigned, resolved, channels, activeMembership] = await Promise.all([
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
  ]);

  const noDataNote = "Connect a channel to get started";

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

      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-5">
        <StatCard
          label="Total conversations"
          value={String(total)}
          note={noDataNote}
          icon={MessagesSquare}
        />
        <StatCard label="Open conversations" value={String(open)} note={noDataNote} icon={Inbox} />
        <StatCard
          label="Unassigned"
          value={String(unassigned)}
          note="Waiting for an agent"
          icon={UserX}
        />
        <StatCard label="Resolved" value={String(resolved)} note={noDataNote} icon={CheckCheck} />
        <StatCard label="Avg. response time" value="—" note="No data yet" icon={Clock} />
      </div>

      <div className="grid gap-4 xl:grid-cols-2">
        <Card className="shadow-none">
          <CardHeader>
            <div className="flex items-center justify-between gap-2">
              <div>
                <CardTitle>Conversation volume</CardTitle>
                <CardDescription>Last 14 days</CardDescription>
              </div>
              <SampleBadge />
            </div>
          </CardHeader>
          <CardContent>
            <VolumeChart />
          </CardContent>
        </Card>
        <Card className="shadow-none">
          <CardHeader>
            <div className="flex items-center justify-between gap-2">
              <div>
                <CardTitle>Team performance</CardTitle>
                <CardDescription>Resolved conversations per agent</CardDescription>
              </div>
              <SampleBadge />
            </div>
          </CardHeader>
          <CardContent>
            <TeamPerformanceChart />
          </CardContent>
        </Card>
      </div>

      <div className="grid gap-4 xl:grid-cols-2">
        <Card className="shadow-none">
          <CardHeader>
            <div className="flex items-center justify-between gap-2">
              <CardTitle>Recent conversations</CardTitle>
              <SampleBadge />
            </div>
            <CardDescription>How the inbox will look once channels are live.</CardDescription>
          </CardHeader>
          <CardContent>
            <ul className="divide-y">
              {SAMPLE_CONVERSATIONS.slice(0, 5).map((conversation) => (
                <li key={conversation.id}>
                  <Link
                    href="/inbox"
                    className="hover:bg-accent/60 -mx-2 flex items-center gap-3 rounded-md px-2 py-2.5"
                  >
                    <AvatarWithBadge
                      name={conversation.contactName}
                      provider={conversation.provider}
                      size="sm"
                    />
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-sm font-medium">
                        {conversation.contactName}
                      </span>
                      <span className="text-muted-foreground block truncate text-xs">
                        {conversation.snippet}
                      </span>
                    </span>
                    {conversation.unread > 0 ? (
                      <Badge variant="info">{conversation.unread} new</Badge>
                    ) : null}
                    <span className="text-muted-foreground text-xs">{conversation.timeLabel}</span>
                  </Link>
                </li>
              ))}
            </ul>
          </CardContent>
        </Card>

        <Card className="shadow-none">
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

      <Card className="shadow-none">
        <CardHeader>
          <CardTitle>Your workspaces</CardTitle>
          <CardDescription>
            Every workspace is fully isolated — members, channels, contacts.
          </CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col gap-2">
          {workspaces.map((workspace) => (
            <div key={workspace.id} className="flex items-center justify-between text-sm">
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
