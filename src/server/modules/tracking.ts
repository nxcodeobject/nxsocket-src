import type { WebSocket } from "ws";
import type { ServerMessage } from "../../shared/types.js";
import type { ConnectionManager, ConnectionState } from "../core/connection.js";

type Position = {
  lat: number;
  lng: number;
  meta?: unknown;
  from: string;
  ts: string;
};

export class TrackingModule {
  private readonly latest = new Map<string, Position>();
  private readonly subscribers = new Map<string, Set<WebSocket>>();

  constructor(private readonly connections: ConnectionManager) {}

  subscribe(state: ConnectionState, target: string): void {
    const key = target.trim();
    if (!key) throw new Error("tracking target kosong");

    let set = this.subscribers.get(key);
    if (!set) {
      set = new Set();
      this.subscribers.set(key, set);
    }
    set.add(state.socket);

    const current = this.latest.get(key);
    this.connections.send(state.socket, {
      type: "tracking.snapshot",
      target: key,
      positions: current ? [current] : [],
    } satisfies ServerMessage);
  }

  unsubscribe(state: ConnectionState, target: string): void {
    const set = this.subscribers.get(target);
    if (!set) return;
    set.delete(state.socket);
    if (set.size === 0) this.subscribers.delete(target);
  }

  clear(socket: WebSocket): void {
    for (const [target, set] of this.subscribers) {
      set.delete(socket);
      if (set.size === 0) this.subscribers.delete(target);
    }
  }

  update(
    state: ConnectionState,
    target: string,
    lat: number,
    lng: number,
    meta?: unknown,
  ): void {
    const key = target.trim();
    if (!key) throw new Error("tracking target kosong");
    if (!Number.isFinite(lat) || !Number.isFinite(lng)) {
      throw new Error("lat/lng tidak valid");
    }

    const position: Position = {
      lat,
      lng,
      meta,
      from: state.session.id,
      ts: new Date().toISOString(),
    };
    this.latest.set(key, position);

    const payload: ServerMessage = {
      type: "tracking.update",
      target: key,
      lat,
      lng,
      meta,
      from: state.session.id,
      ts: position.ts,
    };

    const set = this.subscribers.get(key);
    if (!set) return;
    const raw = JSON.stringify(payload);
    for (const socket of set) {
      if (socket.readyState === socket.OPEN) socket.send(raw);
    }
  }
}
