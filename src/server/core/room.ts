import type { WebSocket } from "ws";
import type { ConnectionManager, ConnectionState } from "./connection.js";

export class RoomManager {
  private readonly rooms = new Map<string, Set<WebSocket>>();

  constructor(private readonly connections: ConnectionManager) {}

  private key(room: string): string {
    return room.trim();
  }

  join(state: ConnectionState, room: string): string {
    const key = this.key(room);
    if (!key) {
      throw new Error("Nama room kosong");
    }

    let members = this.rooms.get(key);
    if (!members) {
      members = new Set();
      this.rooms.set(key, members);
    }

    members.add(state.socket);
    state.rooms.add(key);
    return key;
  }

  leave(state: ConnectionState, room: string): void {
    const key = this.key(room);
    const members = this.rooms.get(key);
    if (members) {
      members.delete(state.socket);
      if (members.size === 0) {
        this.rooms.delete(key);
      }
    }
    state.rooms.delete(key);
  }

  leaveAll(state: ConnectionState): string[] {
    const left = [...state.rooms];
    for (const room of left) {
      this.leave(state, room);
    }
    return left;
  }

  broadcast(
    room: string,
    payload: unknown,
    except?: WebSocket,
  ): number {
    const members = this.rooms.get(this.key(room));
    if (!members) return 0;

    const raw = JSON.stringify(payload);
    let sent = 0;
    for (const socket of members) {
      if (except && socket === except) continue;
      if (socket.readyState === socket.OPEN) {
        socket.send(raw);
        sent += 1;
      }
    }
    return sent;
  }

  memberCount(room: string): number {
    return this.rooms.get(this.key(room))?.size ?? 0;
  }

  /** Session id anggota room (kecuali exceptSession). */
  memberSessionIds(room: string, exceptSession?: string): string[] {
    const members = this.rooms.get(this.key(room));
    if (!members) return [];
    const ids: string[] = [];
    for (const socket of members) {
      const st = this.connections.getBySocket(socket);
      if (!st) continue;
      if (exceptSession && st.session.id === exceptSession) continue;
      ids.push(st.session.id);
    }
    return ids;
  }

  roomCount(): number {
    return this.rooms.size;
  }

  listRooms(): string[] {
    return [...this.rooms.keys()];
  }

  members(room: string): WebSocket[] {
    return [...(this.rooms.get(this.key(room)) ?? [])];
  }
}
