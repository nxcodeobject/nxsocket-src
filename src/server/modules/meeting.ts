import type { ServerMessage } from "../../shared/types.js";
import type { ConnectionManager, ConnectionState } from "../core/connection.js";
import type { RoomManager } from "../core/room.js";

export type MeetingMemberStatus = "waiting" | "in";

export type MeetingMember = {
  sessionId: string;
  name: string;
  status: MeetingMemberStatus;
  hand: boolean;
  mic: boolean;
  cam: boolean;
  screen: boolean;
};

export type MeetingRoom = {
  room: string;
  title: string;
  hostId: string;
  locked: boolean;
  members: Map<string, MeetingMember>;
};

export class MeetingModule {
  private readonly meetings = new Map<string, MeetingRoom>();

  constructor(
    private readonly connections: ConnectionManager,
    private readonly rooms: RoomManager,
  ) {}

  private key(room: string): string {
    return room.trim();
  }

  get(room: string): MeetingRoom | undefined {
    return this.meetings.get(this.key(room));
  }

  /** Buat / ambil meeting; pembuat pertama = host. */
  ensure(state: ConnectionState, room: string, title?: string): MeetingRoom {
    const key = this.key(room);
    if (!key) throw new Error("Room meeting kosong");
    let m = this.meetings.get(key);
    if (!m) {
      m = {
        room: key,
        title: (title || key).trim().slice(0, 80) || key,
        hostId: state.session.id,
        locked: true,
        members: new Map(),
      };
      this.meetings.set(key, m);
    }
    this.rooms.join(state, key);
    return m;
  }

  enter(
    state: ConnectionState,
    room: string,
    opts?: { title?: string; asHost?: boolean },
  ): MeetingRoom {
    const m = this.ensure(state, room, opts?.title);
    if (opts?.asHost && m.members.size === 0) {
      m.hostId = state.session.id;
    }
    const existing = m.members.get(state.session.id);
    const isHost = m.hostId === state.session.id;
    const status: MeetingMemberStatus =
      existing?.status === "in" || isHost || !m.locked ? "in" : "waiting";
    m.members.set(state.session.id, {
      sessionId: state.session.id,
      name: state.displayName,
      status,
      hand: existing?.hand ?? false,
      mic: existing?.mic ?? true,
      cam: existing?.cam ?? true,
      screen: existing?.screen ?? false,
    });
    this.broadcastState(m);
    return m;
  }

  admit(host: ConnectionState, room: string, sessionId: string): void {
    const m = this.requireHost(host, room);
    const member = m.members.get(sessionId);
    if (!member) throw new Error("Peserta tidak ada di lobby");
    member.status = "in";
    m.members.set(sessionId, member);
    this.connections.sendToSession(sessionId, {
      type: "meeting.admitted",
      room: m.room,
    } satisfies ServerMessage);
    this.broadcastState(m);
  }

  admitAll(host: ConnectionState, room: string): void {
    const m = this.requireHost(host, room);
    for (const member of m.members.values()) {
      if (member.status === "waiting") {
        member.status = "in";
        this.connections.sendToSession(member.sessionId, {
          type: "meeting.admitted",
          room: m.room,
        } satisfies ServerMessage);
      }
    }
    this.broadcastState(m);
  }

  kick(host: ConnectionState, room: string, sessionId: string): void {
    const m = this.requireHost(host, room);
    if (sessionId === m.hostId) throw new Error("Tidak bisa kick host");
    m.members.delete(sessionId);
    this.connections.sendToSession(sessionId, {
      type: "meeting.kicked",
      room: m.room,
    } satisfies ServerMessage);
    this.broadcastState(m);
  }

  setLocked(host: ConnectionState, room: string, locked: boolean): void {
    const m = this.requireHost(host, room);
    m.locked = locked;
    this.broadcastState(m);
  }

  raiseHand(state: ConnectionState, room: string, raised: boolean): void {
    const m = this.requireMember(state, room);
    const member = m.members.get(state.session.id)!;
    member.hand = raised;
    this.broadcastState(m);
  }

  setMedia(
    state: ConnectionState,
    room: string,
    patch: { mic?: boolean; cam?: boolean; screen?: boolean },
  ): void {
    const m = this.requireMember(state, room);
    const member = m.members.get(state.session.id)!;
    if (typeof patch.mic === "boolean") member.mic = patch.mic;
    if (typeof patch.cam === "boolean") member.cam = patch.cam;
    if (typeof patch.screen === "boolean") member.screen = patch.screen;
    this.broadcastState(m);
  }

  leave(state: ConnectionState, room: string): void {
    const key = this.key(room);
    const m = this.meetings.get(key);
    if (!m) return;
    m.members.delete(state.session.id);
    if (m.hostId === state.session.id) {
      const next = [...m.members.values()].find((x) => x.status === "in") || [...m.members.values()][0];
      if (next) m.hostId = next.sessionId;
    }
    if (m.members.size === 0) {
      this.meetings.delete(key);
      return;
    }
    this.broadcastState(m);
  }

  end(host: ConnectionState, room: string): void {
    const m = this.requireHost(host, room);
    const payload = { type: "meeting.ended" as const, room: m.room };
    for (const member of m.members.values()) {
      this.connections.sendToSession(member.sessionId, payload);
    }
    this.rooms.broadcast(m.room, payload);
    this.meetings.delete(m.room);
  }

  clearSocket(state: ConnectionState): void {
    for (const key of [...this.meetings.keys()]) {
      const m = this.meetings.get(key);
      if (!m?.members.has(state.session.id)) continue;
      this.leave(state, key);
    }
  }

  statePayload(m: MeetingRoom): ServerMessage {
    return {
      type: "meeting.state",
      room: m.room,
      title: m.title,
      hostId: m.hostId,
      locked: m.locked,
      participants: [...m.members.values()].map((p) => ({ ...p })),
    };
  }

  private requireHost(state: ConnectionState, room: string): MeetingRoom {
    const m = this.meetings.get(this.key(room));
    if (!m) throw new Error("Meeting belum ada");
    if (m.hostId !== state.session.id) throw new Error("Hanya host");
    return m;
  }

  private requireMember(state: ConnectionState, room: string): MeetingRoom {
    const m = this.meetings.get(this.key(room));
    if (!m) throw new Error("Meeting belum ada");
    if (!m.members.has(state.session.id)) throw new Error("Belum masuk meeting");
    return m;
  }

  private broadcastState(m: MeetingRoom): void {
    const payload = this.statePayload(m);
    for (const member of m.members.values()) {
      this.connections.sendToSession(member.sessionId, payload);
    }
    this.rooms.broadcast(m.room, payload);
  }
}
