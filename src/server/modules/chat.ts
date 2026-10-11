import { randomUUID } from "node:crypto";
import type { ChatDeliveryStatus, ChatRecord, DataAdapter } from "../../adapters/types.js";
import type { ServerMessage } from "../../shared/types.js";
import type { ConnectionManager, ConnectionState } from "../core/connection.js";
import type { RoomManager } from "../core/room.js";

const STATUS_RANK: Record<ChatDeliveryStatus, number> = {
  sent: 1,
  delivered: 2,
  read: 3,
};

function bumpStatus(
  current: ChatDeliveryStatus | undefined,
  next: ChatDeliveryStatus,
): ChatDeliveryStatus {
  const cur = current && STATUS_RANK[current] ? current : "sent";
  return STATUS_RANK[next] >= STATUS_RANK[cur] ? next : cur;
}

function digitsOnly(value: string): string {
  return String(value || "").replace(/\D/g, "");
}

function phonesFromDmRoom(room: string): string[] {
  const m = String(room || "").match(/^dm-(\d+)-(\d+)$/);
  return m ? [m[1], m[2]] : [];
}

export class ChatModule {
  /** Cache status live bila adapter tidak persist / pesan baru. */
  private readonly liveStatus = new Map<string, ChatDeliveryStatus>();

  constructor(
    private readonly connections: ConnectionManager,
    private readonly rooms: RoomManager,
    private readonly adapter?: DataAdapter,
  ) {}

  /**
   * Room DM (`dm-<a>-<b>`) hanya broadcast ke socket yang sudah `rooms.join`.
   * Penerima baru join saat membuka layar chat itu -- kalau lawan bicara
   * belum pernah membuka layar itu (atau app di background/killed), dia
   * bukan anggota room dan chat.send tidak pernah sampai ke device-nya
   * sama sekali, walau sedang online. Auto-join peer yang match nomor
   * telepon room ini (server-side, transparan untuk client) sebelum
   * broadcast, mirip pola notifyPhone yang sudah dipakai untuk call.
   */
  private autoJoinDmPeers(room: string, exceptSocket: unknown): void {
    const phones = phonesFromDmRoom(room);
    if (phones.length !== 2) return;
    for (const state of this.connections.all()) {
      if (state.socket === exceptSocket) continue;
      if (state.rooms.has(room)) continue;
      const mine = digitsOnly(state.phone || "");
      if (!mine) continue;
      const matches = phones.some(
        (p) => p === mine || p.endsWith(mine) || mine.endsWith(p),
      );
      if (matches) this.rooms.join(state, room);
    }
  }

  async send(
    state: ConnectionState,
    room: string,
    text: string,
    to?: string,
  ): Promise<void> {
    const body = text.trim();
    if (!body) {
      throw new Error("Pesan chat kosong");
    }
    if (!state.rooms.has(room)) {
      throw new Error(`Belum join room: ${room}`);
    }
    if (!to) this.autoJoinDmPeers(room, state.socket);

    const id = randomUUID();
    const ts = new Date().toISOString();
    let status: ChatDeliveryStatus = "sent";

    const base = {
      type: "chat.message" as const,
      id,
      room,
      text: body,
      from: state.session.id,
      name: state.displayName,
      to,
      ts,
      status,
    };

    if (this.adapter) {
      await this.adapter.saveChat({
        id,
        room,
        text: body,
        from: state.session.id,
        name: state.displayName,
        to,
        ts,
        status,
      });
    }
    this.liveStatus.set(id, status);

    if (to) {
      const delivered = this.connections.sendToSession(to, { ...base, status: "sent" });
      if (!delivered) {
        throw new Error(`Target DM tidak online: ${to}`);
      }
      status = "delivered";
      this.liveStatus.set(id, status);
      await this.persistStatus([id], status);
      const echo: ServerMessage = { ...base, status };
      this.connections.send(state.socket, echo);
      this.connections.send(state.socket, {
        type: "chat.receipt",
        room,
        messageId: id,
        status: "delivered",
        ts: new Date().toISOString(),
      });
      return;
    }

    this.rooms.broadcast(room, { ...base, status: "sent" });

    const peers = this.rooms.memberCount(room);
    if (peers > 1) {
      status = "delivered";
      this.liveStatus.set(id, status);
      await this.persistStatus([id], status);
      this.rooms.broadcast(room, {
        type: "chat.receipt",
        room,
        messageId: id,
        status: "delivered",
        ts: new Date().toISOString(),
      } satisfies ServerMessage);
    }
  }

  typing(state: ConnectionState, room: string, typing: boolean): void {
    if (!state.rooms.has(room)) {
      throw new Error(`Belum join room: ${room}`);
    }

    const payload: ServerMessage = {
      type: "chat.typing",
      room,
      from: state.session.id,
      name: state.displayName,
      typing,
    };

    this.rooms.broadcast(room, payload, state.socket);
  }

  async sendHistory(
    state: ConnectionState,
    room: string,
    limit = 50,
  ): Promise<void> {
    const key = room.trim();
    if (!key) throw new Error("room kosong");
    if (!this.adapter) {
      this.connections.send(state.socket, {
        type: "chat.history",
        room: key,
        messages: [],
      } satisfies ServerMessage);
      return;
    }
    const rows = await this.adapter.listChat(key, Math.min(100, Math.max(1, limit)));
    this.connections.send(state.socket, {
      type: "chat.history",
      room: key,
      messages: rows.map((r) => ({
        id: r.id,
        room: r.room,
        text: r.text,
        from: r.from,
        name: r.name,
        to: r.to,
        ts: r.ts,
        status: r.status || this.liveStatus.get(r.id) || "sent",
        readAt: r.readAt,
      })),
    } satisfies ServerMessage);
  }

  /**
   * Peer menandai pesan orang lain sebagai dibaca.
   * Broadcast `chat.read` ke room agar pengirim naik ke 2 centang.
   */
  async markRead(
    state: ConnectionState,
    room: string,
    messageIds?: string[],
    upToTs?: string,
  ): Promise<void> {
    const key = room.trim();
    if (!key) throw new Error("room kosong");
    if (!state.rooms.has(key)) {
      throw new Error(`Belum join room: ${key}`);
    }

    const reader = state.session.id;
    let updated: ChatRecord[] = [];

    if (this.adapter?.markChatRead) {
      updated = await this.adapter.markChatRead(key, reader, {
        messageIds,
        upToTs,
      });
    } else if (messageIds?.length) {
      // Tanpa adapter: anggap id yang dikirim valid untuk room live.
      for (const id of messageIds) {
        const cur = this.liveStatus.get(id) || "sent";
        const next = bumpStatus(cur, "read");
        this.liveStatus.set(id, next);
        if (next === "read") {
          updated.push({
            id,
            room: key,
            text: "",
            from: "",
            name: "",
            ts: upToTs || new Date().toISOString(),
            status: "read",
          });
        }
      }
    }

    const ids = updated.map((r) => r.id).filter(Boolean);
    if (!ids.length) return;

    for (const id of ids) this.liveStatus.set(id, "read");

    const ts = new Date().toISOString();
    this.rooms.broadcast(key, {
      type: "chat.read",
      room: key,
      reader,
      readerName: state.displayName || "",
      messageIds: ids,
      ts,
    } satisfies ServerMessage);

    for (const id of ids) {
      this.rooms.broadcast(key, {
        type: "chat.receipt",
        room: key,
        messageId: id,
        status: "read",
        ts,
      } satisfies ServerMessage);
    }
  }

  private async persistStatus(
    ids: string[],
    status: ChatDeliveryStatus,
    meta?: { readAt?: string },
  ): Promise<void> {
    if (!ids.length || !this.adapter?.updateChatStatus) return;
    await this.adapter.updateChatStatus(ids, status, meta);
  }
}
