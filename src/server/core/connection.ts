import { randomUUID } from "node:crypto";
import type { WebSocket } from "ws";
import type { SessionInfo, TokenScope } from "../../shared/types.js";

export type ConnectionState = {
  socket: WebSocket;
  session: SessionInfo;
  rooms: Set<string>;
  lastSeenAt: number;
  alive: boolean;
  displayName: string;
  /** Nomor Remora (opsional) — dipakai block + invite offline. */
  phone?: string;
  scopes: TokenScope[];
  allowedRooms: string[] | null;
};

export class ConnectionManager {
  private readonly bySession = new Map<string, ConnectionState>();
  private readonly bySocket = new Map<WebSocket, ConnectionState>();

  create(
    socket: WebSocket,
    tokenId: string,
    meta: Record<string, unknown> = {},
    scopes: TokenScope[] = ["*"],
    allowedRooms: string[] | null = null,
    resumeSessionId?: string,
  ): ConnectionState {
    const session: SessionInfo = {
      id: resumeSessionId || randomUUID(),
      tokenId,
      connectedAt: new Date().toISOString(),
      meta,
    };

    const state: ConnectionState = {
      socket,
      session,
      rooms: new Set(),
      lastSeenAt: Date.now(),
      alive: true,
      displayName: typeof meta.name === "string" ? meta.name : `user-${session.id.slice(0, 8)}`,
      scopes,
      allowedRooms,
    };

    this.bySession.set(session.id, state);
    this.bySocket.set(socket, state);
    return state;
  }

  /** Ganti socket untuk session yang di-resume (hapus mapping socket lama jika ada). */
  attachSocket(state: ConnectionState, socket: WebSocket): void {
    this.bySocket.delete(state.socket);
    state.socket = socket;
    state.lastSeenAt = Date.now();
    state.alive = true;
    this.bySocket.set(socket, state);
    this.bySession.set(state.session.id, state);
  }

  /** Pulihkan session id setelah reconnect (resume). */
  rebindSession(state: ConnectionState, sessionId: string): void {
    if (state.session.id === sessionId) return;
    this.bySession.delete(state.session.id);
    state.session.id = sessionId;
    this.bySession.set(sessionId, state);
  }

  setDisplayName(state: ConnectionState, name: string): void {
    const trimmed = name.trim();
    if (!trimmed) {
      throw new Error("Nama kosong");
    }
    state.displayName = trimmed;
    state.session.meta.name = trimmed;
  }

  setPhone(state: ConnectionState, phone: string): void {
    const digits = String(phone || "").replace(/\D/g, "");
    if (!digits) {
      state.phone = undefined;
      delete state.session.meta.phone;
      return;
    }
    state.phone = digits;
    state.session.meta.phone = digits;
  }

  getBySocket(socket: WebSocket): ConnectionState | undefined {
    return this.bySocket.get(socket);
  }

  getBySession(sessionId: string): ConnectionState | undefined {
    return this.bySession.get(sessionId);
  }

  touch(socket: WebSocket): void {
    const state = this.bySocket.get(socket);
    if (!state) return;
    state.lastSeenAt = Date.now();
    state.alive = true;
  }

  remove(socket: WebSocket): ConnectionState | undefined {
    const state = this.bySocket.get(socket);
    if (!state) return undefined;
    this.bySocket.delete(socket);
    this.bySession.delete(state.session.id);
    return state;
  }

  all(): ConnectionState[] {
    return [...this.bySocket.values()];
  }

  count(): number {
    return this.bySocket.size;
  }

  send(socket: WebSocket, payload: unknown): void {
    if (socket.readyState === socket.OPEN) {
      socket.send(JSON.stringify(payload));
    }
  }

  sendToSession(sessionId: string, payload: unknown): boolean {
    const state = this.bySession.get(sessionId);
    if (!state) return false;
    this.send(state.socket, payload);
    return true;
  }

  broadcastAll(payload: unknown, except?: WebSocket): number {
    const raw = JSON.stringify(payload);
    let sent = 0;
    for (const state of this.bySocket.values()) {
      if (except && state.socket === except) continue;
      if (state.socket.readyState === state.socket.OPEN) {
        state.socket.send(raw);
        sent += 1;
      }
    }
    return sent;
  }
}

