import type { ConnectionManager } from "./connection.js";

export class HeartbeatMonitor {
  private timer: NodeJS.Timeout | null = null;

  constructor(
    private readonly connections: ConnectionManager,
    private readonly intervalMs: number,
    private readonly timeoutMs: number,
  ) {}

  start(): void {
    this.stop();
    this.timer = setInterval(() => this.tick(), this.intervalMs);
    this.timer.unref?.();
  }

  stop(): void {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
  }

  private tick(): void {
    const now = Date.now();
    for (const state of this.connections.all()) {
      if (now - state.lastSeenAt > this.timeoutMs) {
        state.socket.terminate();
        continue;
      }

      if (!state.alive) {
        state.socket.terminate();
        continue;
      }

      state.alive = false;
      if (state.socket.readyState === state.socket.OPEN) {
        state.socket.ping();
      }
    }
  }
}
