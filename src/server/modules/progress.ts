import type { WebSocket } from "ws";
import type { ServerMessage } from "../../shared/types.js";
import type { ConnectionManager, ConnectionState } from "../core/connection.js";

export type ProgressState = {
  id: string;
  percent: number;
  loaded?: number;
  total?: number;
  meta?: unknown;
  from: string;
  ts: string;
  done?: boolean;
  ok?: boolean;
};

/**
 * Progress realtime (upload / download / proses).
 */
export class ProgressModule {
  private readonly latest = new Map<string, ProgressState>();
  private readonly subscribers = new Map<string, Set<WebSocket>>();

  constructor(private readonly connections: ConnectionManager) {}

  subscribe(state: ConnectionState, id: string): void {
    const key = id.trim();
    if (!key) throw new Error("progress id kosong");
    let set = this.subscribers.get(key);
    if (!set) {
      set = new Set();
      this.subscribers.set(key, set);
    }
    set.add(state.socket);

    const current = this.latest.get(key);
    this.connections.send(state.socket, {
      type: "progress.snapshot",
      id: key,
      current: current ?? null,
    } satisfies ServerMessage);
  }

  unsubscribe(state: ConnectionState, id: string): void {
    const set = this.subscribers.get(id);
    if (!set) return;
    set.delete(state.socket);
    if (set.size === 0) this.subscribers.delete(id);
  }

  clear(socket: WebSocket): void {
    for (const [id, set] of this.subscribers) {
      set.delete(socket);
      if (set.size === 0) this.subscribers.delete(id);
    }
  }

  update(
    state: ConnectionState,
    id: string,
    percent: number,
    opts: { loaded?: number; total?: number; meta?: unknown } = {},
  ): void {
    const key = id.trim();
    if (!key) throw new Error("progress id kosong");
    if (!Number.isFinite(percent) || percent < 0 || percent > 100) {
      throw new Error("percent harus 0–100");
    }

    const row: ProgressState = {
      id: key,
      percent,
      loaded: opts.loaded,
      total: opts.total,
      meta: opts.meta,
      from: state.session.id,
      ts: new Date().toISOString(),
    };
    this.latest.set(key, row);

    this.publish(key, {
      type: "progress.update",
      id: key,
      percent,
      loaded: opts.loaded,
      total: opts.total,
      meta: opts.meta,
      from: state.session.id,
      ts: row.ts,
    });
  }

  done(
    state: ConnectionState,
    id: string,
    ok = true,
    meta?: unknown,
  ): void {
    const key = id.trim();
    if (!key) throw new Error("progress id kosong");
    const prev = this.latest.get(key);
    const row: ProgressState = {
      id: key,
      percent: ok ? 100 : (prev?.percent ?? 0),
      loaded: prev?.loaded,
      total: prev?.total,
      meta: meta ?? prev?.meta,
      from: state.session.id,
      ts: new Date().toISOString(),
      done: true,
      ok,
    };
    this.latest.set(key, row);

    this.publish(key, {
      type: "progress.done",
      id: key,
      ok,
      meta: row.meta,
      from: state.session.id,
      ts: row.ts,
    });
  }

  private publish(id: string, payload: ServerMessage): void {
    const set = this.subscribers.get(id);
    if (!set) return;
    const raw = JSON.stringify(payload);
    for (const socket of set) {
      if (socket.readyState === socket.OPEN) socket.send(raw);
    }
  }
}
