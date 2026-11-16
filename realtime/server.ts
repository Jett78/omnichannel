import { createServer } from "node:http";

import { createAdapter } from "@socket.io/redis-adapter";
import { Server } from "socket.io";

import { getEnv } from "@/lib/env";
import { prisma } from "@/lib/prisma";
import { REALTIME_CHANNEL, type RealtimeEnvelope } from "@/lib/realtime";
import { createRedisConnection } from "@/lib/redis";

/**
 * Standalone Socket.IO gateway (Phase 4, Phase 0 §7) — run with
 * `npm run realtime`. Kept out of Next.js: it holds long-lived
 * connections and scales horizontally via the Redis adapter.
 *
 * Auth: the browser passes its Better Auth session token in the
 * handshake (`auth.token`); we validate it against the Session table
 * and attach the user id. Room joins are authorized server-side
 * (workspace membership is checked in the DB) — client-supplied room
 * names are never trusted.
 *
 * Events from the web app / workers arrive over the Redis pub/sub
 * channel `uoi:realtime` (see lib/realtime.ts) and are fanned out to
 * rooms here.
 */

const env = getEnv();
const port = env.SOCKET_PORT;

const httpServer = createServer((req, res) => {
  if (req.url === "/health") {
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ status: "ok", service: "realtime" }));
    return;
  }
  res.writeHead(404);
  res.end();
});

const io = new Server(httpServer, {
  cors: { origin: env.APP_URL, credentials: true },
});

// Redis adapter (multi-instance fan-out) — dedicated pub/sub pair.
const adapterPub = createRedisConnection();
const adapterSub = createRedisConnection();
io.adapter(createAdapter(adapterPub, adapterSub));

// App event bus: services publish envelopes, we emit them to rooms.
const busSub = createRedisConnection();
void busSub.subscribe(REALTIME_CHANNEL).then(() => {
  console.log(`[realtime] subscribed to ${REALTIME_CHANNEL}`);
});
busSub.on("message", (channel: string, raw: string) => {
  if (channel !== REALTIME_CHANNEL) return;
  try {
    const envelope = JSON.parse(raw) as RealtimeEnvelope;
    io.to(envelope.room).emit(envelope.event, envelope.payload);
  } catch (error) {
    console.error("[realtime] bad envelope ignored:", error);
  }
});

io.use(async (socket, next) => {
  const token = socket.handshake.auth.token as unknown;
  if (typeof token !== "string" || token.length === 0) {
    next(new Error("Unauthorized: missing session token"));
    return;
  }
  try {
    const session = await prisma.session.findUnique({
      where: { token },
      select: { userId: true, expiresAt: true },
    });
    if (!session || session.expiresAt.getTime() <= Date.now()) {
      next(new Error("Unauthorized: invalid or expired session"));
      return;
    }
    (socket.data as { userId?: string }).userId = session.userId;
    next();
  } catch (error) {
    console.error("[realtime] auth lookup failed:", error);
    next(new Error("Unauthorized"));
  }
});

io.on("connection", (socket) => {
  const userId = (socket.data as { userId?: string }).userId;
  console.log(`[realtime] connected socket=${socket.id} user=${userId ?? "?"}`);

  socket.on(
    "join:workspace",
    async (data: unknown, ack?: (response: { ok: boolean; error?: string }) => void) => {
      const workspaceId =
        data && typeof data === "object"
          ? (data as { workspaceId?: unknown }).workspaceId
          : undefined;
      if (!userId || typeof workspaceId !== "string") {
        ack?.({ ok: false, error: "workspaceId is required" });
        return;
      }
      const member = await prisma.workspaceMember.findUnique({
        where: { workspaceId_userId: { workspaceId, userId } },
        select: { id: true },
      });
      if (!member) {
        ack?.({ ok: false, error: "Not a member of this workspace" });
        return;
      }
      await socket.join(`workspace:${workspaceId}`);
      ack?.({ ok: true });
    },
  );

  socket.on(
    "join:conversation",
    async (data: unknown, ack?: (response: { ok: boolean; error?: string }) => void) => {
      const record = data && typeof data === "object" ? (data as Record<string, unknown>) : {};
      const workspaceId = record.workspaceId;
      const conversationId = record.conversationId;
      if (!userId || typeof workspaceId !== "string" || typeof conversationId !== "string") {
        ack?.({ ok: false, error: "workspaceId and conversationId are required" });
        return;
      }
      const member = await prisma.workspaceMember.findUnique({
        where: { workspaceId_userId: { workspaceId, userId } },
        select: { id: true },
      });
      if (!member) {
        ack?.({ ok: false, error: "Not a member of this workspace" });
        return;
      }
      const conversation = await prisma.conversation.findFirst({
        where: { id: conversationId, workspaceId },
        select: { id: true },
      });
      if (!conversation) {
        ack?.({ ok: false, error: "Conversation not found in this workspace" });
        return;
      }
      await socket.join(`conversation:${conversationId}`);
      ack?.({ ok: true });
    },
  );

  socket.on("disconnect", (reason: string) => {
    console.log(`[realtime] disconnected socket=${socket.id} reason=${reason}`);
  });
});

httpServer.listen(port, () => {
  console.log(`[realtime] Socket.IO gateway listening on http://localhost:${port}`);
});

async function shutdown(): Promise<void> {
  console.log("[realtime] shutting down…");
  await io.close();
  httpServer.close();
  adapterPub.disconnect();
  adapterSub.disconnect();
  busSub.disconnect();
  process.exit(0);
}

process.on("SIGTERM", () => void shutdown());
process.on("SIGINT", () => void shutdown());
