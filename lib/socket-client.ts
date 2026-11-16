"use client";

import { io, type Socket } from "socket.io-client";

/**
 * Browser Socket.IO client singleton (Phase 4).
 *
 * The session token comes from GET /api/realtime/token (the signed-in
 * user's Better Auth session token) — the gateway validates it against
 * the Session table before accepting the connection.
 */
let socket: Socket | null = null;

export function connectSocket(token: string, url: string): Socket {
  if (socket) {
    socket.auth = { token };
    if (!socket.connected) socket.connect();
    return socket;
  }
  socket = io(url, {
    auth: { token },
    transports: ["websocket", "polling"],
    reconnectionAttempts: 5,
  });
  return socket;
}

export function getSocket(): Socket | null {
  return socket;
}

export function disconnectSocket(): void {
  socket?.disconnect();
  socket = null;
}
