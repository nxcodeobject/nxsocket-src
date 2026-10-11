import type { ServerMessage } from "../../shared/types.js";
import type { ConnectionManager, ConnectionState } from "../core/connection.js";
import type { RoomManager } from "../core/room.js";

export class WebrtcModule {
  constructor(
    private readonly connections: ConnectionManager,
    private readonly rooms: RoomManager,
  ) {}

  signal(
    state: ConnectionState,
    room: string,
    signal: "offer" | "answer" | "ice" | "ring" | "hangup" | "reject" | "mute",
    payload: unknown,
    to?: string,
  ): void {
    const key = room.trim();
    if (!key) throw new Error("webrtc room kosong");

    // Pastikan pengirim ada di room
    if (!state.rooms.has(key)) {
      this.rooms.join(state, key);
    }

    const message: ServerMessage = {
      type: "webrtc.signal",
      room: key,
      signal,
      payload,
      from: state.session.id,
      to,
    };

    if (to) {
      const ok = this.connections.sendToSession(to, message);
      if (!ok) {
        // fallback blast
        this.connections.broadcastAll(message, state.socket);
      }
      return;
    }

    // Room + semua peer online (demo 2 HP harus sampai)
    this.rooms.broadcast(key, message, state.socket);
    const sent = this.connections.broadcastAll(message, state.socket);
    if (sent === 0 && signal !== "ice") {
      throw new Error(
        "Tidak ada HP lain Online. Pastikan A1 sudah Masuk (status Online) di demo3.",
      );
    }
  }
}
