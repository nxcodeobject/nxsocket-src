import type { WebSocket } from "ws";

/**
 * Simple sliding-window rate limiter per socket.
 */
export class RateLimiter {
  private readonly hits = new Map<WebSocket, number[]>();

  constructor(
    private readonly maxMessages: number,
    private readonly windowMs: number,
  ) {}

  /** @returns true jika masih diizinkan */
  allow(socket: WebSocket): boolean {
    const now = Date.now();
    const cutoff = now - this.windowMs;
    const prev = this.hits.get(socket) ?? [];
    const recent = prev.filter((t) => t > cutoff);
    if (recent.length >= this.maxMessages) {
      this.hits.set(socket, recent);
      return false;
    }
    recent.push(now);
    this.hits.set(socket, recent);
    return true;
  }

  clear(socket: WebSocket): void {
    this.hits.delete(socket);
  }
}
