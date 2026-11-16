"use client";

import {
  ArrowLeft,
  CheckCheck,
  Clock,
  Image as ImageIcon,
  MapPin,
  Mic,
  MoreHorizontal,
  Paperclip,
  Phone,
  Search,
  Send,
  Smile,
  SquarePen,
  Star,
  Tag as TagIcon,
  Video,
  X,
} from "lucide-react";
import { useMemo, useState } from "react";

import { AvatarWithBadge } from "@/components/avatar-with-badge";
import { PROVIDER_META } from "@/components/channel-icon";
import { SampleBadge } from "@/components/sample-badge";
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
import {
  SAMPLE_CONVERSATIONS,
  SAMPLE_TEAM_MEMBERS,
  type SampleConversation,
  type SampleMessage,
} from "@/features/inbox/sample-data";
import { cn } from "@/lib/utils";

type FilterTab = "all" | "unread" | "waiting" | "mine";
type StatusFilter = "ALL" | "OPEN" | "PENDING" | "RESOLVED";

const TABS: Array<{ id: FilterTab; label: string }> = [
  { id: "all", label: "All" },
  { id: "unread", label: "Unread" },
  { id: "waiting", label: "Waiting" },
  { id: "mine", label: "Assigned to me" },
];

export function InboxShell({ currentUserName }: { currentUserName: string }) {
  const [conversations, setConversations] = useState<SampleConversation[]>(SAMPLE_CONVERSATIONS);
  const [selectedId, setSelectedId] = useState<string>(SAMPLE_CONVERSATIONS[0]?.id ?? "");
  const [tab, setTab] = useState<FilterTab>("all");
  const [statusFilter, setStatusFilter] = useState<StatusFilter>("ALL");
  const [query, setQuery] = useState("");
  const [starred, setStarred] = useState<ReadonlySet<string>>(new Set());
  const [draft, setDraft] = useState("");
  const [tagInput, setTagInput] = useState("");
  const [note, setNote] = useState<string | null>(null);
  const [mobileThread, setMobileThread] = useState(false);

  const selected = conversations.find((c) => c.id === selectedId) ?? conversations[0];

  const counts = useMemo(
    () => ({
      all: conversations.length,
      unread: conversations.filter((c) => c.unread > 0).length,
      waiting: conversations.filter((c) => c.waiting).length,
      mine: conversations.filter(
        (c) => c.assigneeName === "You" || c.assigneeName === currentUserName,
      ).length,
    }),
    [conversations, currentUserName],
  );

  const visible = useMemo(() => {
    const q = query.trim().toLowerCase();
    return conversations.filter((c) => {
      if (tab === "unread" && c.unread === 0) return false;
      if (tab === "waiting" && !c.waiting) return false;
      if (tab === "mine" && c.assigneeName !== "You" && c.assigneeName !== currentUserName)
        return false;
      if (statusFilter !== "ALL" && c.status !== statusFilter) return false;
      if (q && !c.contactName.toLowerCase().includes(q) && !c.snippet.toLowerCase().includes(q))
        return false;
      return true;
    });
  }, [conversations, tab, statusFilter, query, currentUserName]);

  function updateConversation(id: string, patch: Partial<SampleConversation>) {
    setConversations((prev) => prev.map((c) => (c.id === id ? { ...c, ...patch } : c)));
  }

  function selectConversation(id: string) {
    setSelectedId(id);
    setMobileThread(true);
    updateConversation(id, { unread: 0 });
  }

  function toggleStar(id: string) {
    setStarred((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  function sendMessage() {
    const body = draft.trim();
    if (!body || !selected) return;
    const message: SampleMessage = {
      id: `local-${Date.now()}`,
      direction: "OUTBOUND",
      body,
      time: "Now",
      status: "SENT",
    };
    setConversations((prev) =>
      prev.map((c) =>
        c.id === selected.id
          ? {
              ...c,
              messages: [...c.messages, message],
              snippet: body,
              timeLabel: "Now",
              waiting: false,
            }
          : c,
      ),
    );
    setDraft("");
  }

  function addTag() {
    const tag = tagInput.trim();
    if (!tag || !selected) return;
    if (!selected.tags.includes(tag)) {
      updateConversation(selected.id, { tags: [...selected.tags, tag] });
    }
    setTagInput("");
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
          <div className="flex items-center gap-1.5">
            <SampleBadge />
            <Button
              variant="ghost"
              size="icon"
              className="size-8"
              aria-label="New conversation (preview)"
              title="New conversations start when a customer messages a connected channel"
              onClick={() =>
                setNote("New conversations start when a customer messages a connected channel.")
              }
            >
              <SquarePen className="size-4" />
            </Button>
          </div>
        </div>
        <div className="px-4 pb-2">
          <div className="relative">
            <Search className="text-muted-foreground pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2" />
            <Input
              placeholder="Search something"
              className="pl-9"
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              aria-label="Search conversations"
            />
          </div>
        </div>
        <div
          className="flex items-center gap-1 overflow-x-auto px-4 pb-2"
          role="tablist"
          aria-label="Conversation filters"
        >
          {TABS.map((item) => (
            <button
              key={item.id}
              role="tab"
              aria-selected={tab === item.id}
              onClick={() => setTab(item.id)}
              className={cn(
                "flex shrink-0 items-center gap-1.5 rounded-full px-3 py-1.5 text-xs font-medium whitespace-nowrap transition-colors",
                tab === item.id
                  ? "bg-primary text-primary-foreground"
                  : "bg-muted text-muted-foreground hover:text-foreground",
              )}
            >
              {item.label}
              <span
                className={cn(
                  "rounded-full px-1.5 text-[11px]",
                  tab === item.id ? "bg-primary-foreground/20" : "bg-background",
                )}
              >
                {counts[item.id]}
              </span>
            </button>
          ))}
          <Select
            value={statusFilter}
            onValueChange={(value) => setStatusFilter(value as StatusFilter)}
          >
            <SelectTrigger
              size="sm"
              className="ml-auto w-[104px] shrink-0"
              aria-label="Filter by status"
            >
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="ALL">All status</SelectItem>
              <SelectItem value="OPEN">Open</SelectItem>
              <SelectItem value="PENDING">Pending</SelectItem>
              <SelectItem value="RESOLVED">Resolved</SelectItem>
            </SelectContent>
          </Select>
        </div>
        <ScrollArea className="min-h-0 flex-1">
          <ul className="flex flex-col px-2 pb-2">
            {visible.map((conversation) => {
              const isActive = selected?.id === conversation.id;
              const isStarred = starred.has(conversation.id);
              return (
                <li key={conversation.id}>
                  <div
                    className={cn(
                      "group hover:bg-accent/70 relative flex w-full cursor-pointer gap-3 rounded-lg px-2.5 py-3 text-left transition-colors",
                      isActive && "bg-accent hover:bg-accent",
                    )}
                    onClick={() => selectConversation(conversation.id)}
                    onKeyDown={(event) => {
                      if (event.key === "Enter") selectConversation(conversation.id);
                    }}
                    role="button"
                    tabIndex={0}
                    aria-label={`Conversation with ${conversation.contactName}`}
                  >
                    <AvatarWithBadge
                      name={conversation.contactName}
                      provider={conversation.provider}
                    />
                    <span className="min-w-0 flex-1">
                      <span className="flex items-baseline justify-between gap-2">
                        <span
                          className={cn(
                            "truncate text-sm",
                            conversation.unread > 0 ? "font-semibold" : "font-medium",
                          )}
                        >
                          {conversation.contactName}
                        </span>
                        <span className="text-muted-foreground shrink-0 text-[11px]">
                          {conversation.timeLabel}
                        </span>
                      </span>
                      <span className="mt-0.5 flex items-center justify-between gap-2">
                        <span
                          className={cn(
                            "truncate text-xs",
                            conversation.unread > 0
                              ? "text-foreground font-medium"
                              : "text-muted-foreground",
                          )}
                        >
                          {conversation.snippet}
                        </span>
                        {conversation.unread > 0 ? (
                          <span className="bg-primary text-primary-foreground flex size-5 shrink-0 items-center justify-center rounded-full text-[11px] font-semibold">
                            {conversation.unread}
                          </span>
                        ) : null}
                      </span>
                      <span className="mt-1 flex items-center gap-1.5">
                        <Badge variant="muted" className="px-1.5 text-[10px]">
                          {conversation.status}
                        </Badge>
                        {conversation.tags.slice(0, 2).map((tag) => (
                          <Badge key={tag} variant="outline" className="px-1.5 text-[10px]">
                            {tag}
                          </Badge>
                        ))}
                      </span>
                    </span>
                    <button
                      type="button"
                      aria-label={isStarred ? "Unstar conversation" : "Star conversation"}
                      className="absolute top-2 right-8 opacity-0 transition-opacity group-hover:opacity-100 focus:opacity-100"
                      onClick={(event) => {
                        event.stopPropagation();
                        toggleStar(conversation.id);
                      }}
                    >
                      <Star
                        className={cn(
                          "size-3.5",
                          isStarred
                            ? "fill-amber-400 text-amber-400 opacity-100"
                            : "text-muted-foreground",
                        )}
                      />
                    </button>
                    {isStarred ? (
                      <Star className="absolute top-2 right-8 size-3.5 fill-amber-400 text-amber-400 group-hover:opacity-0" />
                    ) : null}
                  </div>
                </li>
              );
            })}
            {visible.length === 0 ? (
              <li className="text-muted-foreground px-3 py-10 text-center text-sm">
                No sample conversations match this filter.
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
              <AvatarWithBadge name={selected.contactName} provider={selected.provider} />
              <div className="min-w-0 flex-1 leading-tight">
                <p className="truncate text-sm font-semibold">{selected.contactName}</p>
                <p className="text-muted-foreground truncate text-xs">
                  {selected.lastSeen} · via {PROVIDER_META[selected.provider].label}
                </p>
              </div>
              <div className="flex items-center gap-1">
                {[
                  { icon: Phone, label: "Voice call" },
                  { icon: Video, label: "Video call" },
                  { icon: Search, label: "Search in conversation" },
                  { icon: MoreHorizontal, label: "More actions" },
                ].map((action) => (
                  <Button
                    key={action.label}
                    variant="ghost"
                    size="icon"
                    className="size-8"
                    aria-label={action.label}
                    title={`${action.label} — arrives with channel integrations`}
                    onClick={() => setNote(`${action.label} arrives with channel integrations.`)}
                  >
                    <action.icon className="size-4" />
                  </Button>
                ))}
              </div>
            </div>

            <ScrollArea className="min-h-0 flex-1">
              <div className="mx-auto flex max-w-3xl flex-col gap-4 px-4 py-5">
                <div className="flex justify-center">
                  <span className="bg-muted text-muted-foreground rounded-full px-3 py-1 text-[11px] font-medium">
                    Today
                  </span>
                </div>
                {selected.messages.map((message) =>
                  message.direction === "INBOUND" ? (
                    <div key={message.id} className="flex items-end gap-2">
                      <AvatarWithBadge name={selected.contactName} size="sm" />
                      <div className="max-w-[75%]">
                        <div className="bg-background rounded-2xl rounded-bl-md border px-3.5 py-2.5 text-sm shadow-xs">
                          {message.body}
                        </div>
                        <p className="text-muted-foreground mt-1 pl-1 text-[11px]">
                          {message.time}
                        </p>
                      </div>
                    </div>
                  ) : (
                    <div key={message.id} className="flex flex-col items-end">
                      <div className="max-w-[75%]">
                        <div className="rounded-2xl rounded-br-md bg-indigo-100 px-3.5 py-2.5 text-sm text-indigo-950 dark:bg-indigo-500/20 dark:text-indigo-50">
                          {message.body}
                        </div>
                        <p className="text-muted-foreground mt-1 flex items-center justify-end gap-1 pr-1 text-[11px]">
                          {message.time}
                          {message.status ? (
                            <>
                              · {message.status === "READ" ? "Seen" : message.status.toLowerCase()}
                              <CheckCheck className="size-3.5 text-sky-600" />
                            </>
                          ) : null}
                        </p>
                      </div>
                    </div>
                  ),
                )}
              </div>
            </ScrollArea>

            <div className="shrink-0 border-t px-4 py-3">
              <div className="mx-auto max-w-3xl">
                <div className="rounded-xl border shadow-xs focus-within:ring-ring/40 focus-within:ring-[3px]">
                  <Textarea
                    value={draft}
                    onChange={(event) => setDraft(event.target.value)}
                    onKeyDown={(event) => {
                      if (event.key === "Enter" && !event.shiftKey) {
                        event.preventDefault();
                        sendMessage();
                      }
                    }}
                    placeholder={`Reply to ${selected.contactName}…`}
                    aria-label="Message composer"
                    className="min-h-11 resize-none border-0 shadow-none focus-visible:ring-0"
                    rows={2}
                  />
                  <div className="flex items-center gap-1 px-2 pb-2">
                    {[
                      { icon: Smile, label: "Insert emoji" },
                      { icon: Paperclip, label: "Attach a file" },
                      { icon: ImageIcon, label: "Attach an image" },
                      { icon: Mic, label: "Record a voice note" },
                    ].map((action) => (
                      <Button
                        key={action.label}
                        variant="ghost"
                        size="icon"
                        className="size-8"
                        aria-label={action.label}
                        title={`${action.label} — arrives with channel integrations`}
                        onClick={() =>
                          setNote(`${action.label} arrives with channel integrations.`)
                        }
                      >
                        <action.icon className="size-4" />
                      </Button>
                    ))}
                    <Button className="ml-auto" onClick={sendMessage} disabled={!draft.trim()}>
                      Send
                      <Send className="size-4" />
                    </Button>
                  </div>
                </div>
                <p className="text-muted-foreground mt-2 flex items-center gap-1.5 text-xs">
                  <Clock className="size-3.5" />
                  {note ??
                    "Preview only — connect a channel to send real messages. Enter to send, Shift+Enter for a new line."}
                </p>
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
            <AvatarWithBadge name={selected.contactName} provider={selected.provider} size="lg" />
            <p className="text-sm font-semibold">{selected.contactName}</p>
            <p className="text-muted-foreground flex items-center gap-1 text-xs">
              <MapPin className="size-3.5" /> {selected.location}
            </p>
            <SampleBadge className="mt-1" />
          </div>

          <div className="space-y-5 px-4 pb-6">
            <section>
              <h3 className="pb-2 text-xs font-semibold tracking-wide uppercase">Assignment</h3>
              <Select
                value={selected.assigneeName ?? "unassigned"}
                onValueChange={(value) =>
                  updateConversation(selected.id, {
                    assigneeName: value === "unassigned" ? null : value,
                    waiting: value === "unassigned" ? selected.waiting : false,
                  })
                }
              >
                <SelectTrigger aria-label="Assign conversation">
                  <SelectValue placeholder="Unassigned" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="unassigned">Unassigned</SelectItem>
                  <SelectItem value="You">You ({currentUserName})</SelectItem>
                  {SAMPLE_TEAM_MEMBERS.map((member) => (
                    <SelectItem key={member} value={member}>
                      {member}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <Button
                variant="outline"
                size="sm"
                className="mt-2 w-full"
                onClick={() =>
                  updateConversation(selected.id, { assigneeName: "You", waiting: false })
                }
              >
                Assign to me
              </Button>
              <p className="text-muted-foreground mt-2 flex items-center gap-1.5 text-xs">
                <Badge
                  variant={selected.status === "RESOLVED" ? "success" : "info"}
                  className="px-1.5 text-[10px]"
                >
                  {selected.status}
                </Badge>
                via {PROVIDER_META[selected.provider].label}
              </p>
            </section>

            <section>
              <h3 className="flex items-center gap-1.5 pb-2 text-xs font-semibold tracking-wide uppercase">
                <TagIcon className="size-3.5" /> Tags
              </h3>
              <div className="flex flex-wrap gap-1.5">
                {selected.tags.map((tag) => (
                  <Badge key={tag} variant="secondary" className="gap-1 pr-1">
                    {tag}
                    <button
                      type="button"
                      aria-label={`Remove tag ${tag}`}
                      onClick={() =>
                        updateConversation(selected.id, {
                          tags: selected.tags.filter((t) => t !== tag),
                        })
                      }
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
                      addTag();
                    }
                  }}
                  placeholder="Add a tag…"
                  aria-label="Add a tag"
                  className="h-8"
                />
                <Button size="sm" variant="outline" onClick={addTag} disabled={!tagInput.trim()}>
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
                  <dd className="font-medium">{selected.phone}</dd>
                </div>
                <div className="flex justify-between gap-3">
                  <dt className="text-muted-foreground">Email</dt>
                  <dd className="truncate font-medium">{selected.email}</dd>
                </div>
                <div className="flex justify-between gap-3">
                  <dt className="text-muted-foreground">Channel</dt>
                  <dd className="font-medium">{PROVIDER_META[selected.provider].shortLabel}</dd>
                </div>
                <div className="flex justify-between gap-3">
                  <dt className="text-muted-foreground">Customer since</dt>
                  <dd className="font-medium">{selected.customerSince}</dd>
                </div>
              </dl>
            </section>

            <section>
              <h3 className="pb-2 text-xs font-semibold tracking-wide uppercase">
                Previous interactions
              </h3>
              {selected.previousInteractions.length === 0 ? (
                <p className="text-muted-foreground text-sm">No earlier conversations.</p>
              ) : (
                <ul className="space-y-2">
                  {selected.previousInteractions.map((interaction) => (
                    <li key={interaction.id} className="rounded-lg border p-2.5 text-sm">
                      <p className="font-medium">{interaction.title}</p>
                      <p className="text-muted-foreground text-xs">
                        {PROVIDER_META[interaction.provider].shortLabel} · {interaction.timeLabel}
                      </p>
                    </li>
                  ))}
                </ul>
              )}
            </section>
          </div>
        </aside>
      ) : null}
    </div>
  );
}
