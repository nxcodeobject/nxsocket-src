import type { ServerMessage } from "../../shared/types.js";
import type { ConnectionManager, ConnectionState } from "../core/connection.js";
import type { RoomManager } from "../core/room.js";

export class NotificationModule {
  constructor(
    private readonly connections: ConnectionManager,
    private readonly rooms: RoomManager,
  ) {}

  send(
    state: ConnectionState,
    input: {
      title: string;
      body: string;
      data?: unknown;
      room?: string;
      to?: string;
    },
  ): void {
    const title = input.title.trim();
    const body = input.body.trim();
    if (!title || !body) {
      throw new Error("notification membutuhkan title dan body");
    }

    const payload: ServerMessage = {
      type: "notification",
      title,
      body,
      data: input.data,
      from: state.session.id,
      room: input.room,
      ts: new Date().toISOString(),
    };

    if (input.to) {
      const ok = this.connections.sendToSession(input.to, payload);
      if (!ok) {
        throw new Error(`Target notifikasi tidak online: ${input.to}`);
      }
      return;
    }

    if (input.room) {
      if (!state.rooms.has(input.room)) {
        throw new Error(`Belum join room: ${input.room}`);
      }
      this.rooms.broadcast(input.room, payload);
      return;
    }

    this.connections.broadcastAll(payload);
  }
}
