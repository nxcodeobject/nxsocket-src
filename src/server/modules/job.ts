import { randomUUID } from "node:crypto";
import type { WebSocket } from "ws";
import type { JobStatus, ServerMessage } from "../../shared/types.js";
import type { ConnectionManager, ConnectionState } from "../core/connection.js";

export type JobRecord = {
  jobId: string;
  name: string;
  status: JobStatus;
  progress: number;
  result?: unknown;
  error?: string;
  from: string;
  createdAt: string;
  updatedAt: string;
};

/**
 * Job / proses background: status + completion events.
 */
export class JobModule {
  private readonly jobs = new Map<string, JobRecord>();
  private readonly subscribers = new Map<string, Set<WebSocket>>();
  private readonly timers = new Map<string, NodeJS.Timeout>();

  constructor(private readonly connections: ConnectionManager) {}

  subscribe(state: ConnectionState, jobId: string): void {
    const key = jobId.trim();
    if (!key) throw new Error("jobId kosong");
    let set = this.subscribers.get(key);
    if (!set) {
      set = new Set();
      this.subscribers.set(key, set);
    }
    set.add(state.socket);

    const current = this.jobs.get(key);
    this.connections.send(state.socket, {
      type: "job.snapshot",
      jobId: key,
      job: current ?? null,
    } satisfies ServerMessage);
  }

  unsubscribe(state: ConnectionState, jobId: string): void {
    const set = this.subscribers.get(jobId);
    if (!set) return;
    set.delete(state.socket);
    if (set.size === 0) this.subscribers.delete(jobId);
  }

  clear(socket: WebSocket): void {
    for (const [id, set] of this.subscribers) {
      set.delete(socket);
      if (set.size === 0) this.subscribers.delete(id);
    }
  }

  create(state: ConnectionState, name: string, jobId?: string, data?: unknown): string {
    const id = jobId?.trim() || randomUUID();
    const now = new Date().toISOString();
    const job: JobRecord = {
      jobId: id,
      name: name.trim() || "job",
      status: "running",
      progress: 0,
      result: data,
      from: state.session.id,
      createdAt: now,
      updatedAt: now,
    };
    this.jobs.set(id, job);
    this.publish(id, {
      type: "job.update",
      jobId: id,
      name: job.name,
      status: job.status,
      progress: job.progress,
      result: job.result,
      from: job.from,
      ts: now,
    });
    return id;
  }

  set(
    state: ConnectionState,
    jobId: string,
    patch: {
      status?: JobStatus;
      progress?: number;
      result?: unknown;
      error?: string;
      name?: string;
    },
  ): void {
    const key = jobId.trim();
    if (!key) throw new Error("jobId kosong");
    const now = new Date().toISOString();
    const prev = this.jobs.get(key);
    const progress =
      patch.progress !== undefined
        ? clampPercent(patch.progress)
        : (prev?.progress ?? 0);
    const status = patch.status ?? prev?.status ?? "running";

    const job: JobRecord = {
      jobId: key,
      name: patch.name?.trim() || prev?.name || "job",
      status,
      progress,
      result: patch.result !== undefined ? patch.result : prev?.result,
      error: patch.error ?? (status === "failed" ? prev?.error : undefined),
      from: state.session.id,
      createdAt: prev?.createdAt ?? now,
      updatedAt: now,
    };
    this.jobs.set(key, job);

    this.publish(key, {
      type: "job.update",
      jobId: key,
      name: job.name,
      status: job.status,
      progress: job.progress,
      result: job.result,
      error: job.error,
      from: job.from,
      ts: now,
    });
  }

  /**
   * Demo job server-side: naikkan progress lalu complete.
   */
  runDemo(state: ConnectionState, name: string, jobId?: string, steps = 5): string {
    const id = this.create(state, name, jobId);
    this.clearTimer(id);
    let step = 0;
    const total = Math.max(1, Math.min(20, steps));
    const tick = () => {
      step += 1;
      const percent = Math.round((step / total) * 100);
      if (step >= total) {
        this.set(state, id, { status: "done", progress: 100, result: { steps: total } });
        this.timers.delete(id);
        return;
      }
      this.set(state, id, { status: "running", progress: percent });
      this.timers.set(id, setTimeout(tick, 120));
    };
    this.timers.set(id, setTimeout(tick, 80));
    return id;
  }

  cancelDemo(jobId: string): void {
    this.clearTimer(jobId);
  }

  private clearTimer(jobId: string): void {
    const t = this.timers.get(jobId);
    if (t) clearTimeout(t);
    this.timers.delete(jobId);
  }

  private publish(jobId: string, payload: ServerMessage): void {
    const set = this.subscribers.get(jobId);
    if (!set) return;
    const raw = JSON.stringify(payload);
    for (const socket of set) {
      if (socket.readyState === socket.OPEN) socket.send(raw);
    }
  }
}

function clampPercent(n: number): number {
  if (!Number.isFinite(n)) return 0;
  return Math.max(0, Math.min(100, n));
}
