import type Redis from "ioredis";

import { createRedisConnection } from "@/lib/redis";

/**
 * Realtime publisher (Phase 4, Phase 0 §7).
 *
 * Web app and workers NEVER talk to Socket.IO clients directly. They
 * publish a JSON envelope to the Redis channel `uoi:realtime`; the
 * standalone gateway (realtime/server.ts) subscribes and emits to the
 * target room. Publishing is fire-and-forget: it must never throw into
 * a request/job path — a dead Redis only loses the live hint, the DB
 * remains the source of truth and clients refetch on reconnect.
 */
export const REALTIME_CHANNEL = "uoi:realtime";

export type RealtimeEventName =
  | "message.created"
  | "message.status_updated"
  | "message.deleted"
  | "conversation.created"
  | "conversation.updated"
  | "conversation.deleted";

export interface RealtimeEnvelope {
  room: string;
  event: RealtimeEventName;
  payload: Record<string, unknown>;
}

let publisher: Redis | null = null;

function getPublisher(): Redis {
  if (!publisher) publisher = createRedisConnection();
  return publisher;
}

export function workspaceRoom(workspaceId: string): string {
  return `workspace:${workspaceId}`;
}

export function conversationRoom(conversationId: string): string {
  return `conversation:${conversationId}`;
}

export async function publishRealtime(envelope: RealtimeEnvelope): Promise<void> {
  try {
    await getPublisher().publish(REALTIME_CHANNEL, JSON.stringify(envelope));
  } catch (error) {
    console.error("[realtime] publish failed (ignored):", error);
  }
}

export async function emitToWorkspace(
  workspaceId: string,
  event: RealtimeEventName,
  payload: Record<string, unknown>,
): Promise<void> {
  await publishRealtime({ room: workspaceRoom(workspaceId), event, payload });
}

export async function emitToConversation(
  conversationId: string,
  event: RealtimeEventName,
  payload: Record<string, unknown>,
): Promise<void> {
  await publishRealtime({ room: conversationRoom(conversationId), event, payload });
}

/** Emit the same event to both the workspace room and the conversation room. */
export async function emitToWorkspaceAndConversation(
  workspaceId: string,
  conversationId: string,
  event: RealtimeEventName,
  payload: Record<string, unknown>,
): Promise<void> {
  await Promise.all([
    emitToWorkspace(workspaceId, event, payload),
    emitToConversation(conversationId, event, payload),
  ]);
}
