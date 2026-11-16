"use client";

import {
  ArrowLeft,
  CheckCheck,
  Lock,
  MoreHorizontal,
  Search,
  Send,
  StickyNote,
  Tag as TagIcon,
  X,
} from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { AvatarWithBadge } from "@/components/avatar-with-badge";
import { PROVIDER_META } from "@/components/channel-icon";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { ScrollArea } from "@/components/ui/scroll-area";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import type {
  RealConversationItem,
  RealInboxData,
  RealMessageItem,
} from "@/features/inbox/real-data";
import { connectSocket, disconnectSocket } from "@/lib/socket-client";
import { cn } from "@/lib/utils";

type SocketStatus = "connecting" | "connected" | "disconnected";
type ComposerMode = "reply" | "note";

interface MessageCreatedPayload {
  conversationId?: string;
  message?: RealMessageItem;
}

interface StatusUpdatedPayload {
  conversationId?: string;
  messageId?: string;
  status?: string;
  externalMessageId?: string | null;
}

function formatListTime(iso: string | null): string {
  if (!iso) return "";
  const date = new Date(iso);
  const now = new Date();
  const sameDay = date.toDateString() === now.toDateString();
  return sameDay
    ? date.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })
    : date.toLocaleDateString([], { day: "numeric", month: "short" });
}

function formatMessageTime(iso: string): string {
  return new Date(iso).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
}

/**
 * REAL inbox (Phase 4) — rendered when the active workspace has real
 * conversations in the database. Data comes from the conversations
 * API; sending goes through the outbound queue + provider; live
 * updates arrive over Socket.IO. The Phase 3 sample shell is used
 * only when a workspace has no real conversations yet.
 */
export function RealInboxShell({
  currentUserName,
  data,
}: {
  currentUserName: string;
  data: RealInboxData;
}) {
  const { workspaceId, currentUserId } = data;
  const apiBase = `/api/workspaces/${workspaceId}`;

  const [conversations, setConversations] = useState<RealConversationItem[]>(data.conversations);
  const [selectedId, setSelectedId] = useState<string>(data.conversations[0]?.id ?? "");
  const [messagesByConversation, setMessagesByConversation] = useState<
    Record<string, RealMessageItem[]>
  >({ [data.initialMessages.conversationId]: data.initialMessages.messages });
  const [query, setQuery] = useState("");
  const [draft, setDraft] = useState("");
  const [composerMode, setComposerMode] = useState<ComposerMode>("reply");
  const [tagInput, setTagInput] = useState("");
  const [socketStatus, setSocketStatus] = useState<SocketStatus>("connecting");
  const [notice, setNotice] = useState<string | null>(null);
  const [mobileThread, setMobileThread] = useState(false);

  const selectedIdRef = useRef(selectedId);
  useEffect(() => {
    selectedIdRef.current = selectedId;
  }, [selectedId]);
  const selected = conversations.find((c) => c.id === selectedId) ?? conversations[0];
  const messages = selected ? (messagesByConversation[selected.id] ?? []) : [];

  const visible = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return conversations;
    return conversations.filter(
      (c) =>
        c.contact.displayName.toLowerCase().includes(q) ||
        (c.preview ?? "").toLowerCase().includes(q),
    );
  }, [conversations, query]);

  const fetchConversations = useCallback(async () => {
    try {
      const res = await fetch(`${apiBase}/conversations?limit=30`);
      if (!res.ok) return;
      const body = (await res.json()) as { items: RealConversationItem[] };
      setConversations(body.items);
    } catch {
      // Realtime/list refresh is best-effort; DB state re-syncs on next event.
    }
  }, [apiBase]);

  const fetchMessages = useCallback(
    async (conversationId: string) => {
      try {
        const res = await fetch(`${apiBase}/conversations/${conversationId}/messages?limit=100`);
        if (!res.ok) return;
        const body = (await res.json()) as { items: RealMessageItem[] };
        setMessagesByConversation((prev) => ({ ...prev, [conversationId]: body.items }));
      } catch {
        // best-effort
      }
    },
    [apiBase],
  );

  // ── Realtime ─────────────────────────────────────────────────────────
  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const res = await fetch("/api/realtime/token");
        if (!res.ok) {
          setSocketStatus("disconnected");
          return;
        }
        const { token, socketUrl } = (await res.json()) as { token: string; socketUrl: string };
        if (cancelled) return;
        const socket = connectSocket(token, socketUrl);
        socket.on("connect", () => {
          setSocketStatus("connected");
          socket.emit("join:workspace", { workspaceId });
          const current = selectedIdRef.current;
          if (current) socket.emit("join:conversation", { workspaceId, conversationId: current });
        });
        socket.on("disconnect", () => setSocketStatus("disconnected"));
        socket.on("message.created", (payload: unknown) => {
          const event = payload as MessageCreatedPayload;
          if (event.message && event.conversationId) {
            const incoming = event.message;
            const conversationId = event.conversationId;
            setMessagesByConversation((prev) => {
              const existing = prev[conversationId];
              if (!existing || existing.some((m) => m.id === incoming.id)) return prev;
              return { ...prev, [conversationId]: [...existing, incoming] };
            });
          }
          void fetchConversations();
        });
        socket.on("message.status_updated", (payload: unknown) => {
          const event = payload as StatusUpdatedPayload;
          if (!event.conversationId || !event.messageId || !event.status) return;
          const { conversationId, messageId, status } = event;
          setMessagesByConversation((prev) => {
            const existing = prev[conversationId];
            if (!existing) return prev;
            return {
              ...prev,
              [conversationId]: existing.map((m) =>
                m.id === messageId
                  ? {
                      ...m,
                      status,
                      externalMessageId: event.externalMessageId ?? m.externalMessageId,
                    }
                  : m,
              ),
            };
          });
        });
        socket.on("conversation.updated", () => void fetchConversations());
        socket.on("conversation.created", () => void fetchConversations());
      } catch {
        setSocketStatus("disconnected");
      }
    })();
    return () => {
      cancelled = true;
      disconnectSocket();
    };
  }, [workspaceId, fetchConversations]);

  // Join the selected conversation's room + load its messages.
  useEffect(() => {
    if (!selected) return;
    if (!messagesByConversation[selected.id]) {
      // fetchMessages only setStates inside promise callbacks (async load).
      // eslint-disable-next-line react-hooks/set-state-in-effect
      void fetchMessages(selected.id);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selected?.id]);

  async function selectConversation(id: string) {
    setSelectedId(id);
    setMobileThread(true);
    const conversation = conversations.find((c) => c.id === id);
    if (conversation && conversation.unreadCount > 0) {
      setConversations((prev) => prev.map((c) => (c.id === id ? { ...c, unreadCount: 0 } : c)));
      await fetch(`${apiBase}/conversations/${id}/read`, { method: "POST" }).catch(() => null);
    }
  }

  async function send() {
    const content = draft.trim();
    if (!content || !selected) return;
    setDraft("");
    try {
      const path =
        composerMode === "note"
          ? `${apiBase}/conversations/${selected.id}/notes`
          : `${apiBase}/conversations/${selected.id}/messages`;
      const res = await fetch(path, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ content }),
      });
      if (!res.ok) throw new Error(`Request failed (${res.status})`);
      const body = (await res.json()) as { message: RealMessageItem };
      setMessagesByConversation((prev) => {
        const existing = prev[selected.id] ?? [];
        if (existing.some((m) => m.id === body.message.id)) return prev;
        return { ...prev, [selected.id]: [...existing, body.message] };
      });
      void fetchConversations();
    } catch (error) {
      setNotice(error instanceof Error ? error.message : "Failed to send");
      setDraft(content);
    }
  }

  async function changeStatus(action: "resolve" | "reopen") {
    if (!selected) return;
    const res = await fetch(`${apiBase}/conversations/${selected.id}/${action}`, {
      method: "POST",
    }).catch(() => null);
    if (res?.ok) {
      const body = (await res.json()) as { conversation: RealConversationItem };
      setConversations((prev) =>
        prev.map((c) => (c.id === body.conversation.id ? { ...c, ...body.conversation } : c)),
      );
    } else {
      setNotice(`Could not ${action} this conversation.`);
    }
  }

  async function assign(assigneeId: string | null) {
    if (!selected) return;
    const res = await fetch(`${apiBase}/conversations/${selected.id}/assign`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ assigneeId }),
    }).catch(() => null);
    if (res?.ok) {
      const body = (await res.json()) as { conversation: RealConversationItem };
      setConversations((prev) =>
        prev.map((c) => (c.id === body.conversation.id ? { ...c, ...body.conversation } : c)),
      );
    } else {
      setNotice("Could not update the assignment.");
    }
  }

  async function addTag() {
    const name = tagInput.trim();
    if (!name || !selected) return;
    setTagInput("");
    const res = await fetch(`${apiBase}/conversations/${selected.id}/tags`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name }),
    }).catch(() => null);
    if (res?.ok) {
      const body = (await res.json()) as { tags: Array<{ id: string; name: string }> };
      setConversations((prev) =>
        prev.map((c) => (c.id === selected.id ? { ...c, tags: body.tags } : c)),
      );
    }
  }

  async function removeTag(name: string) {
    if (!selected) return;
    const res = await fetch(`${apiBase}/conversations/${selected.id}/tags`, {
      method: "DELETE",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name }),
    }).catch(() => null);
    if (res?.ok) {
      const body = (await res.json()) as { tags: Array<{ id: string; name: string }> };
      setConversations((prev) =>
        prev.map((c) => (c.id === selected.id ? { ...c, tags: body.tags } : c)),
      );
    }
  }

  return (
    <div className="flex h-[calc(100vh-3.5rem)] w-full">
      {/* ─── LEFT: conversation list ─────────────────────────────────── */}
      <section
        className={cn(
          "w-full shrink-0 flex-col border-r md:flex md:w-80",
          mobileThread ? "hidden" : "flex",
        )}
        aria-label="Conversations"
      >
        <div className="flex items-center justify-between gap-2 px-4 pt-4 pb-2">
          <h2 className="text-lg font-semibold tracking-tight">Inbox</h2>
          <span
            className="flex items-center gap-1.5 text-xs"
            title={`Realtime: ${socketStatus}`}
            aria-label={`Realtime status: ${socketStatus}`}
          >
            <span
              className={cn(
                "size-2 rounded-full",
                socketStatus === "connected"
                  ? "bg-emerald-500"
                  : socketStatus === "connecting"
                    ? "bg-amber-400"
                    : "bg-zinc-300",
              )}
            />
            <span className="text-muted-foreground">
              {socketStatus === "connected"
                ? "Live"
                : socketStatus === "connecting"
                  ? "Connecting…"
                  : "Offline"}
            </span>
          </span>
        </div>
        <div className="px-4 pb-2">
          <div className="relative">
            <Search className="text-muted-foreground pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2" />
            <Input
              placeholder="Search conversations"
              className="pl-9"
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              aria-label="Search conversations"
            />
          </div>
        </div>
        <ScrollArea className="min-h-0 flex-1">
          <ul className="flex flex-col px-2 pb-2">
            {visible.map((conversation) => {
              const isActive = selected?.id === conversation.id;
              return (
                <li key={conversation.id}>
                  <div
                    className={cn(
                      "hover:bg-accent/70 relative flex w-full cursor-pointer gap-3 rounded-lg px-2.5 py-3 text-left transition-colors",
                      isActive && "bg-accent hover:bg-accent",
                    )}
                    onClick={() => void selectConversation(conversation.id)}
                    onKeyDown={(event) => {
                      if (event.key === "Enter") void selectConversation(conversation.id);
                    }}
                    role="button"
                    tabIndex={0}
                    aria-label={`Conversation with ${conversation.contact.displayName}`}
                  >
                    <AvatarWithBadge
                      name={conversation.contact.displayName}
                      provider={conversation.channel.provider}
                    />
                    <span className="min-w-0 flex-1">
                      <span className="flex items-baseline justify-between gap-2">
                        <span
                          className={cn(
                            "truncate text-sm",
                            conversation.unreadCount > 0 ? "font-semibold" : "font-medium",
                          )}
                        >
                          {conversation.contact.displayName}
                        </span>
                        <span className="text-muted-foreground shrink-0 text-[11px]">
                          {formatListTime(conversation.lastMessageAt)}
                        </span>
                      </span>
                      <span className="mt-0.5 flex items-center justify-between gap-2">
                        <span
                          className={cn(
                            "truncate text-xs",
                            conversation.unreadCount > 0
                              ? "text-foreground font-medium"
                              : "text-muted-foreground",
                          )}
                        >
                          {conversation.preview ?? "No messages yet"}
                        </span>
                        {conversation.unreadCount > 0 ? (
                          <span className="bg-primary text-primary-foreground flex size-5 shrink-0 items-center justify-center rounded-full text-[11px] font-semibold">
                            {conversation.unreadCount}
                          </span>
                        ) : null}
                      </span>
                      <span className="mt-1 flex items-center gap-1.5">
                        <Badge variant="muted" className="px-1.5 text-[10px]">
                          {conversation.status}
                        </Badge>
                        {conversation.tags.slice(0, 2).map((tag) => (
                          <Badge key={tag.id} variant="outline" className="px-1.5 text-[10px]">
                            {tag.name}
                          </Badge>
                        ))}
                      </span>
                    </span>
                  </div>
                </li>
              );
            })}
            {visible.length === 0 ? (
              <li className="text-muted-foreground px-3 py-10 text-center text-sm">
                No conversations match this search.
              </li>
            ) : null}
          </ul>
        </ScrollArea>
      </section>

      {/* ─── MIDDLE: thread ──────────────────────────────────────────── */}
      <section
        className={cn("min-w-0 flex-1 flex-col", mobileThread ? "flex" : "hidden md:flex")}
        aria-label="Conversation thread"
      >
        {selected ? (
          <>
            <div className="flex h-16 shrink-0 items-center gap-3 border-b px-4">
              <Button
                variant="ghost"
                size="icon"
                className="size-8 md:hidden"
                aria-label="Back to conversation list"
                onClick={() => setMobileThread(false)}
              >
                <ArrowLeft className="size-4" />
              </Button>
              <AvatarWithBadge
                name={selected.contact.displayName}
                provider={selected.channel.provider}
              />
              <div className="min-w-0 flex-1 leading-tight">
                <p className="truncate text-sm font-semibold">{selected.contact.displayName}</p>
                <p className="text-muted-foreground truncate text-xs">
                  via {PROVIDER_META[selected.channel.provider].label} · {selected.status}
                </p>
              </div>
              {selected.status === "RESOLVED" ? (
                <Button variant="outline" size="sm" onClick={() => void changeStatus("reopen")}>
                  Reopen
                </Button>
              ) : (
                <Button variant="outline" size="sm" onClick={() => void changeStatus("resolve")}>
                  Resolve
                </Button>
              )}
              <Button variant="ghost" size="icon" className="size-8" aria-label="More actions">
                <MoreHorizontal className="size-4" />
              </Button>
            </div>

            <ScrollArea className="min-h-0 flex-1">
              <div className="mx-auto flex max-w-3xl flex-col gap-4 px-4 py-5">
                {messages.map((message) =>
                  message.isPrivateNote ? (
                    <div key={message.id} className="flex justify-center">
                      <div className="w-full max-w-[85%] rounded-xl border border-amber-200 bg-amber-50 px-3.5 py-2.5 text-sm text-amber-900 dark:border-amber-500/30 dark:bg-amber-500/10 dark:text-amber-100">
                        <p className="flex items-center gap-1.5 pb-1 text-[11px] font-semibold tracking-wide uppercase">
                          <Lock className="size-3" /> Private note ·{" "}
                          {formatMessageTime(message.createdAt)}
                        </p>
                        {message.content}
                      </div>
                    </div>
                  ) : message.direction === "INBOUND" ? (
                    <div key={message.id} className="flex items-end gap-2">
                      <AvatarWithBadge name={selected.contact.displayName} size="sm" />
                      <div className="max-w-[75%]">
                        <div className="bg-background rounded-2xl rounded-bl-md border px-3.5 py-2.5 text-sm shadow-xs">
                          {message.content}
                        </div>
                        <p className="text-muted-foreground mt-1 pl-1 text-[11px]">
                          {formatMessageTime(message.createdAt)}
                        </p>
                      </div>
                    </div>
                  ) : (
                    <div key={message.id} className="flex flex-col items-end">
                      <div className="max-w-[75%]">
                        <div className="rounded-2xl rounded-br-md bg-indigo-100 px-3.5 py-2.5 text-sm text-indigo-950 dark:bg-indigo-500/20 dark:text-indigo-50">
                          {message.content}
                        </div>
                        <p className="text-muted-foreground mt-1 flex items-center justify-end gap-1 pr-1 text-[11px]">
                          {formatMessageTime(message.createdAt)} · {message.status.toLowerCase()}
                          {message.status === "READ" || message.status === "DELIVERED" ? (
                            <CheckCheck className="size-3.5 text-sky-600" />
                          ) : null}
                        </p>
                      </div>
                    </div>
                  ),
                )}
                {messages.length === 0 ? (
                  <p className="text-muted-foreground py-8 text-center text-sm">
                    No messages in this conversation yet.
                  </p>
                ) : null}
              </div>
            </ScrollArea>

            <div className="shrink-0 border-t px-4 py-3">
              <div className="mx-auto max-w-3xl">
                <div
                  className={cn(
                    "rounded-xl border shadow-xs focus-within:ring-ring/40 focus-within:ring-[3px]",
                    composerMode === "note" && "border-amber-300 bg-amber-50/50",
                  )}
                >
                  <div className="flex items-center gap-1 px-2 pt-2">
                    <button
                      type="button"
                      onClick={() => setComposerMode("reply")}
                      className={cn(
                        "flex items-center gap-1 rounded-md px-2 py-1 text-xs font-medium",
                        composerMode === "reply"
                          ? "bg-accent text-foreground"
                          : "text-muted-foreground",
                      )}
                    >
                      <Send className="size-3.5" /> Reply
                    </button>
                    <button
                      type="button"
                      onClick={() => setComposerMode("note")}
                      className={cn(
                        "flex items-center gap-1 rounded-md px-2 py-1 text-xs font-medium",
                        composerMode === "note"
                          ? "bg-amber-100 text-amber-900"
                          : "text-muted-foreground",
                      )}
                    >
                      <StickyNote className="size-3.5" /> Private note
                    </button>
                  </div>
                  <Textarea
                    value={draft}
                    onChange={(event) => setDraft(event.target.value)}
                    onKeyDown={(event) => {
                      if (event.key === "Enter" && !event.shiftKey) {
                        event.preventDefault();
                        void send();
                      }
                    }}
                    placeholder={
                      composerMode === "note"
                        ? "Write an internal note — only your team can see this…"
                        : `Reply to ${selected.contact.displayName}…`
                    }
                    aria-label="Message composer"
                    className="min-h-11 resize-none border-0 shadow-none focus-visible:ring-0"
                    rows={2}
                  />
                  <div className="flex items-center px-2 pb-2">
                    <span className="text-muted-foreground text-xs">
                      {composerMode === "note"
                        ? "Notes are never sent to the customer."
                        : `Sending as ${currentUserName}`}
                    </span>
                    <Button
                      className="ml-auto"
                      onClick={() => void send()}
                      disabled={!draft.trim()}
                    >
                      {composerMode === "note" ? "Add note" : "Send"}
                      <Send className="size-4" />
                    </Button>
                  </div>
                </div>
                {notice ? <p className="mt-2 text-xs text-red-600">{notice}</p> : null}
              </div>
            </div>
          </>
        ) : (
          <p className="text-muted-foreground p-6 text-sm">Select a conversation.</p>
        )}
      </section>

      {/* ─── RIGHT: contact panel ────────────────────────────────────── */}
      {selected ? (
        <aside
          className="hidden w-[300px] shrink-0 overflow-y-auto border-l xl:block"
          aria-label="Contact details"
        >
          <div className="flex flex-col items-center gap-1.5 px-4 pt-6 pb-4 text-center">
            <AvatarWithBadge
              name={selected.contact.displayName}
              provider={selected.channel.provider}
              size="lg"
            />
            <p className="text-sm font-semibold">{selected.contact.displayName}</p>
            <p className="text-muted-foreground text-xs">
              via {PROVIDER_META[selected.channel.provider].label}
            </p>
          </div>

          <div className="space-y-5 px-4 pb-6">
            <section>
              <h3 className="pb-2 text-xs font-semibold tracking-wide uppercase">Assignment</h3>
              <Select
                value={selected.assignee?.id ?? "unassigned"}
                onValueChange={(value) => void assign(value === "unassigned" ? null : value)}
              >
                <SelectTrigger aria-label="Assign conversation">
                  <SelectValue placeholder="Unassigned" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="unassigned">Unassigned</SelectItem>
                  {data.members.map((member) => (
                    <SelectItem key={member.id} value={member.id}>
                      {member.name}
                      {member.id === currentUserId ? " (you)" : ""}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <Button
                variant="outline"
                size="sm"
                className="mt-2 w-full"
                onClick={() => void assign(currentUserId)}
              >
                Assign to me
              </Button>
            </section>

            <section>
              <h3 className="flex items-center gap-1.5 pb-2 text-xs font-semibold tracking-wide uppercase">
                <TagIcon className="size-3.5" /> Tags
              </h3>
              <div className="flex flex-wrap gap-1.5">
                {selected.tags.map((tag) => (
                  <Badge key={tag.id} variant="secondary" className="gap-1 pr-1">
                    {tag.name}
                    <button
                      type="button"
                      aria-label={`Remove tag ${tag.name}`}
                      onClick={() => void removeTag(tag.name)}
                    >
                      <X className="size-3" />
                    </button>
                  </Badge>
                ))}
                {selected.tags.length === 0 ? (
                  <span className="text-muted-foreground text-xs">No tags yet.</span>
                ) : null}
              </div>
              <div className="mt-2 flex gap-2">
                <Input
                  value={tagInput}
                  onChange={(event) => setTagInput(event.target.value)}
                  onKeyDown={(event) => {
                    if (event.key === "Enter") {
                      event.preventDefault();
                      void addTag();
                    }
                  }}
                  placeholder="Add a tag…"
                  aria-label="Add a tag"
                  className="h-8"
                />
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() => void addTag()}
                  disabled={!tagInput.trim()}
                >
                  Add
                </Button>
              </div>
            </section>

            <section>
              <h3 className="pb-2 text-xs font-semibold tracking-wide uppercase">
                Customer details
              </h3>
              <dl className="space-y-2 text-sm">
                <div className="flex justify-between gap-3">
                  <dt className="text-muted-foreground">Phone</dt>
                  <dd className="font-medium">{selected.contact.phone ?? "—"}</dd>
                </div>
                <div className="flex justify-between gap-3">
                  <dt className="text-muted-foreground">Email</dt>
                  <dd className="truncate font-medium">{selected.contact.email ?? "—"}</dd>
                </div>
                <div className="flex justify-between gap-3">
                  <dt className="text-muted-foreground">Channel</dt>
                  <dd className="font-medium">
                    {PROVIDER_META[selected.channel.provider].shortLabel}
                  </dd>
                </div>
                <div className="flex justify-between gap-3">
                  <dt className="text-muted-foreground">Status</dt>
                  <dd className="font-medium">{selected.status}</dd>
                </div>
              </dl>
            </section>
          </div>
        </aside>
      ) : null}
    </div>
  );
}
