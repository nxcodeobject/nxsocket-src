import os from "node:os";
import type { WebSocket } from "ws";
import type { ServerMessage } from "../../shared/types.js";
import type { ConnectionManager } from "../core/connection.js";
import type { RoomManager } from "../core/room.js";

const startedAt = Date.now();

export class MonitoringModule {
  private readonly subscribers = new Set<WebSocket>();

  constructor(
    private readonly connections: ConnectionManager,
    private readonly rooms: RoomManager,
  ) {}

  subscribe(socket: WebSocket): void {
    this.subscribers.add(socket);
    this.connections.send(socket, this.stats());
  }

  unsubscribe(socket: WebSocket): void {
    this.subscribers.delete(socket);
  }

  clear(socket: WebSocket): void {
    this.subscribers.delete(socket);
  }

  publish(): void {
    const payload = this.stats();
    const raw = JSON.stringify(payload);
    for (const socket of this.subscribers) {
      if (socket.readyState === socket.OPEN) {
        socket.send(raw);
      }
    }
  }

  stats(): ServerMessage {
    const mem = process.memoryUsage();
    return {
      type: "monitoring.stats",
      connections: this.connections.count(),
      rooms: this.rooms.roomCount(),
      roomList: this.rooms.listRooms(),
      cpuLoad: os.loadavg(),
      memory: {
        rss: mem.rss,
        heapUsed: mem.heapUsed,
        heapTotal: mem.heapTotal,
        external: mem.external,
      },
      freemem: os.freemem(),
      totalmem: os.totalmem(),
      uptimeSec: Math.round((Date.now() - startedAt) / 1000),
      ts: new Date().toISOString(),
    };
  }
}
