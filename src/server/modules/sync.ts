import type { WebSocket } from "ws";
import type { ServerMessage } from "../../shared/types.js";
import type { ConnectionManager, ConnectionState } from "../core/connection.js";

/**
 * Sinkronisasi data generik per channel (key → value).
 */
export class SyncModule {
  private readonly channels = new Map<string, Map<string, unknown>>();
  private readonly subscribers = new Map<string, Set<WebSocket>>();

  constructor(private readonly connections: ConnectionManager) {}

  subscribe(state: ConnectionState, channel: string): void {
    const key = channel.trim();
    if (!key) throw new Error("sync channel kosong");
    let set = this.subscribers.get(key);
    if (!set) {
      set = new Set();
      this.subscribers.set(key, set);
    }
    set.add(state.socket);

    const data = this.channels.get(key);
    const entries: Record<string, unknown> = {};
    if (data) {
      for (const [k, v] of data) entries[k] = v;
    }
    this.connections.send(state.socket, {
      type: "sync.snapshot",
      channel: key,
      data: entries,
    } satisfies ServerMessage);
  }

  unsubscribe(state: ConnectionState, channel: string): void {
    const set = this.subscribers.get(channel);
    if (!set) return;
    set.delete(state.socket);
    if (set.size === 0) this.subscribers.delete(channel);
  }

  clear(socket: WebSocket): void {
    for (const [ch, set] of this.subscribers) {
      set.delete(socket);
      if (set.size === 0) this.subscribers.delete(ch);
    }
  }

  set(state: ConnectionState, channel: string, key: string, value: unknown): void {
    const ch = channel.trim();
    const k = key.trim();
    if (!ch) throw new Error("sync channel kosong");
    if (!k) throw new Error("sync key kosong");

    let store = this.channels.get(ch);
    if (!store) {
      store = new Map();
      this.channels.set(ch, store);
    }
    store.set(k, value);

    this.publish(ch, {
      type: "sync.update",
      channel: ch,
      key: k,
      value,
      from: state.session.id,
      ts: new Date().toISOString(),
    });
  }

  delete(state: ConnectionState, channel: string, key: string): void {
    const ch = channel.trim();
    const k = key.trim();
    if (!ch) throw new Error("sync channel kosong");
    if (!k) throw new Error("sync key kosong");

    const store = this.channels.get(ch);
    store?.delete(k);

    this.publish(ch, {
      type: "sync.delete",
      channel: ch,
      key: k,
      from: state.session.id,
      ts: new Date().toISOString(),
    });
  }

  private publish(channel: string, payload: ServerMessage): void {
    const set = this.subscribers.get(channel);
    if (!set) return;
    const raw = JSON.stringify(payload);
    for (const socket of set) {
      if (socket.readyState === socket.OPEN) socket.send(raw);
    }
  }
}
