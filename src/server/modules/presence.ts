import type { WebSocket } from "ws";
import type { PresenceUser, ServerMessage } from "../../shared/types.js";
import type { ConnectionManager, ConnectionState } from "../core/connection.js";
import type { RoomManager } from "../core/room.js";

function toUser(state: ConnectionState, status: "online" | "offline"): PresenceUser {
  return {
    userId: state.session.id,
    name: state.displayName,
    status,
    rooms: [...state.rooms],
  };
}

export class PresenceModule {
  private readonly globalSubs = new Set<WebSocket>();
  private readonly roomSubs = new Map<string, Set<WebSocket>>();

  constructor(
    private readonly connections: ConnectionManager,
    private readonly rooms: RoomManager,
  ) {}

  subscribe(state: ConnectionState, scope: "global" | "room", room?: string): void {
    if (scope === "global") {
      this.globalSubs.add(state.socket);
      this.connections.send(state.socket, {
        type: "presence.snapshot",
        scope: "global",
        users: this.connections.all().map((s) => toUser(s, "online")),
      } satisfies ServerMessage);
      return;
    }

    const key = room?.trim();
    if (!key) {
      throw new Error("presence.subscribe room membutuhkan nama room");
    }

    let set = this.roomSubs.get(key);
    if (!set) {
      set = new Set();
      this.roomSubs.set(key, set);
    }
    set.add(state.socket);

    const users = this.rooms
      .members(key)
      .map((socket) => this.connections.getBySocket(socket))
      .filter((s): s is ConnectionState => Boolean(s))
      .map((s) => toUser(s, "online"));

    this.connections.send(state.socket, {
      type: "presence.snapshot",
      scope: "room",
      room: key,
      users,
    } satisfies ServerMessage);
  }

  unsubscribe(state: ConnectionState, scope: "global" | "room", room?: string): void {
    if (scope === "global") {
      this.globalSubs.delete(state.socket);
      return;
    }
    const key = room?.trim();
    if (!key) return;
    const set = this.roomSubs.get(key);
    if (!set) return;
    set.delete(state.socket);
    if (set.size === 0) this.roomSubs.delete(key);
  }

  clear(state: ConnectionState): void {
    this.globalSubs.delete(state.socket);
    for (const [room, set] of this.roomSubs) {
      set.delete(state.socket);
      if (set.size === 0) this.roomSubs.delete(room);
    }
  }

  announceOnline(state: ConnectionState): void {
    this.emitGlobal({ type: "presence.update", user: toUser(state, "online") });
  }

  announceOffline(state: ConnectionState): void {
    const user = toUser(state, "offline");
    this.emitGlobal({ type: "presence.update", user });
    for (const room of state.rooms) {
      this.emitRoom(room, { type: "presence.update", user, room });
    }
  }

  announceRoomJoin(state: ConnectionState, room: string): void {
    this.emitRoom(room, {
      type: "presence.update",
      user: toUser(state, "online"),
      room,
    });
  }

  announceRoomLeave(state: ConnectionState, room: string): void {
    this.emitRoom(room, {
      type: "presence.update",
      user: toUser(state, "offline"),
      room,
    });
  }

  private emitGlobal(payload: ServerMessage): void {
    const raw = JSON.stringify(payload);
    for (const socket of this.globalSubs) {
      if (socket.readyState === socket.OPEN) socket.send(raw);
    }
  }

  private emitRoom(room: string, payload: ServerMessage): void {
    const set = this.roomSubs.get(room);
    if (!set) return;
    const raw = JSON.stringify(payload);
    for (const socket of set) {
      if (socket.readyState === socket.OPEN) socket.send(raw);
    }
  }
}
