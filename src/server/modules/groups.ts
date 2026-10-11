import { randomBytes, randomUUID } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import type { ServerMessage } from "../../shared/types.js";
import type { ConnectionManager, ConnectionState } from "../core/connection.js";
import type { RoomManager } from "../core/room.js";

export type GroupMember = {
  key: string;
  name: string;
  tokenId: string;
  joinedAt: string;
};

export type ChatGroup = {
  id: string;
  name: string;
  code: string;
  ownerKey: string;
  members: GroupMember[];
  createdAt: string;
};

/** Undangan menunggu peer online (by nama atau nomor). */
export type PendingGroupInvite = {
  id: string;
  groupId: string;
  peerKey: string;
  invitedByKey: string;
  invitedByName: string;
  createdAt: string;
  expiresAt: string;
};

type Store = { groups: ChatGroup[]; pendingInvites?: PendingGroupInvite[] };

const PENDING_TTL_MS = 7 * 24 * 60 * 60 * 1000;

export function groupRoomId(groupId: string): string {
  return `g:${groupId}`;
}

export function dmRoomId(nameA: string, nameB: string): string {
  const a = nameA.trim().toLowerCase() || "anon";
  const b = nameB.trim().toLowerCase() || "anon";
  return `dm:${[a, b].sort().join("|")}`;
}

function normPeerKey(raw: string): string {
  const t = String(raw || "").trim();
  const digits = t.replace(/\D/g, "");
  if (digits.length >= 8) return `phone:${digits}`;
  return `name:${t.toLowerCase()}`;
}

function peerMatchesState(peerKey: string, state: ConnectionState): boolean {
  if (peerKey.startsWith("phone:")) {
    const want = peerKey.slice(6);
    const have = String(state.phone || "").replace(/\D/g, "");
    if (!want || !have) return false;
    return have === want || have.endsWith(want) || want.endsWith(have);
  }
  if (peerKey.startsWith("name:")) {
    const want = peerKey.slice(5);
    return state.displayName.trim().toLowerCase() === want;
  }
  return false;
}

export class GroupsModule {
  private readonly storePath: string;
  private groups = new Map<string, ChatGroup>();
  private pendingInvites: PendingGroupInvite[] = [];

  constructor(
    dataDir: string,
    private readonly connections: ConnectionManager,
    private readonly rooms: RoomManager,
  ) {
    this.storePath = path.join(dataDir, "groups.json");
    this.load();
  }

  memberKey(state: ConnectionState): string {
    return `${state.session.tokenId}|${state.displayName.trim().toLowerCase() || "anon"}`;
  }

  /** Join semua room grup milik user + kirim daftar. */
  sync(state: ConnectionState): ChatGroup[] {
    const mine = this.listFor(state);
    for (const g of mine) {
      this.rooms.join(state, groupRoomId(g.id));
    }
    this.sendList(state, mine);
    return mine;
  }

  listFor(state: ConnectionState): ChatGroup[] {
    const key = this.memberKey(state);
    return [...this.groups.values()]
      .filter((g) => g.members.some((m) => m.key === key))
      .sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1));
  }

  create(state: ConnectionState, name: string): ChatGroup {
    const title = name.trim().slice(0, 64);
    if (!title) throw new Error("Nama grup kosong");
    const key = this.memberKey(state);
    const group: ChatGroup = {
      id: randomUUID(),
      name: title,
      code: this.newCode(),
      ownerKey: key,
      members: [
        {
          key,
          name: state.displayName,
          tokenId: state.session.tokenId,
          joinedAt: new Date().toISOString(),
        },
      ],
      createdAt: new Date().toISOString(),
    };
    this.groups.set(group.id, group);
    this.persist();
    this.rooms.join(state, groupRoomId(group.id));
    this.emitGroup(group, "group.created", state);
    this.sendList(state);
    return group;
  }

  joinByCode(state: ConnectionState, code: string): ChatGroup {
    const c = code.trim().toUpperCase().replace(/[^A-Z0-9]/g, "");
    if (c.length < 4) throw new Error("Kode invite tidak valid");
    const group = [...this.groups.values()].find((g) => g.code === c);
    if (!group) throw new Error("Kode invite tidak ditemukan");
    return this.addMember(state, group);
  }

  leave(state: ConnectionState, groupId: string): void {
    const group = this.groups.get(groupId);
    if (!group) throw new Error("Grup tidak ditemukan");
    const key = this.memberKey(state);
    const before = group.members.length;
    group.members = group.members.filter((m) => m.key !== key);
    if (group.members.length === before) {
      throw new Error("Kamu bukan anggota grup ini");
    }
    this.rooms.leave(state, groupRoomId(group.id));
    if (group.members.length === 0) {
      this.groups.delete(group.id);
      this.persist();
      this.sendList(state);
      return;
    }
    if (group.ownerKey === key) {
      group.ownerKey = group.members[0]!.key;
    }
    this.persist();
    this.broadcastToGroup(group, {
      type: "group.updated",
      group: this.publicGroup(group),
    });
    this.sendList(state);
  }

  kick(state: ConnectionState, groupId: string, memberKey: string): void {
    const group = this.groups.get(groupId);
    if (!group) throw new Error("Grup tidak ditemukan");
    const myKey = this.memberKey(state);
    if (group.ownerKey !== myKey) throw new Error("Hanya owner yang bisa kick");
    if (memberKey === myKey) throw new Error("Owner tidak bisa kick diri sendiri");
    const target = group.members.find((m) => m.key === memberKey);
    if (!target) throw new Error("Anggota tidak ditemukan");
    group.members = group.members.filter((m) => m.key !== memberKey);
    this.persist();

    for (const conn of this.connections.all()) {
      if (this.memberKey(conn) === memberKey) {
        this.rooms.leave(conn, groupRoomId(group.id));
        this.sendList(conn);
        this.connections.send(conn.socket, {
          type: "group.kicked",
          groupId: group.id,
          name: group.name,
        } satisfies ServerMessage);
      }
    }

    this.broadcastToGroup(group, {
      type: "group.updated",
      group: this.publicGroup(group),
    });
  }

  /**
   * Owner mengundang peer (by displayName atau nomor).
   * Online → join langsung. Offline → antrian pending (7 hari) + kode tetap valid.
   */
  invite(
    state: ConnectionState,
    groupId: string,
    peerName: string,
  ): { group: ChatGroup; queued: boolean } {
    const group = this.groups.get(groupId);
    if (!group) throw new Error("Grup tidak ditemukan");
    const myKey = this.memberKey(state);
    if (group.ownerKey !== myKey) throw new Error("Hanya owner yang bisa undang");
    const peer = peerName.trim();
    if (!peer) throw new Error("Nama peer kosong");
    if (peer.toLowerCase() === state.displayName.trim().toLowerCase()) {
      throw new Error("Tidak bisa undang diri sendiri");
    }
    const peerKey = normPeerKey(peer);

    let target: ConnectionState | null = null;
    for (const conn of this.connections.all()) {
      if (conn.session.id === state.session.id) continue;
      if (peerMatchesState(peerKey, conn)) {
        target = conn;
        break;
      }
      if (conn.displayName.trim().toLowerCase() === peer.toLowerCase()) {
        target = conn;
        break;
      }
    }
    if (target) {
      const g = this.addMember(target, group);
      return { group: g, queued: false };
    }

    this.purgeExpiredPending();
    const existing = this.pendingInvites.find(
      (p) => p.groupId === groupId && p.peerKey === peerKey,
    );
    if (!existing) {
      const now = Date.now();
      this.pendingInvites.push({
        id: randomUUID(),
        groupId,
        peerKey,
        invitedByKey: myKey,
        invitedByName: state.displayName,
        createdAt: new Date(now).toISOString(),
        expiresAt: new Date(now + PENDING_TTL_MS).toISOString(),
      });
      this.persist();
    }

    this.connections.send(state.socket, {
      type: "group.invite.queued",
      groupId: group.id,
      peerName: peer,
      code: group.code,
      group: this.publicGroup(group),
    } as ServerMessage);

    return { group, queued: true };
  }

  /** Saat peer identify/online: terapkan undangan pending. */
  flushPendingFor(state: ConnectionState): number {
    this.purgeExpiredPending();
    let applied = 0;
    const keep: PendingGroupInvite[] = [];
    for (const pend of this.pendingInvites) {
      if (!peerMatchesState(pend.peerKey, state)) {
        keep.push(pend);
        continue;
      }
      const group = this.groups.get(pend.groupId);
      if (!group) continue;
      this.addMember(state, group);
      applied += 1;
      this.connections.send(state.socket, {
        type: "group.invite.delivered",
        groupId: group.id,
        invitedByName: pend.invitedByName,
        group: this.publicGroup(group),
      } as ServerMessage);
      // kabari owner jika online
      for (const conn of this.connections.all()) {
        if (this.memberKey(conn) === pend.invitedByKey) {
          this.connections.send(conn.socket, {
            type: "group.invite.delivered",
            groupId: group.id,
            peerName: state.displayName,
            group: this.publicGroup(group),
          } as ServerMessage);
        }
      }
    }
    if (keep.length !== this.pendingInvites.length) {
      this.pendingInvites = keep;
      this.persist();
    }
    return applied;
  }

  private purgeExpiredPending(): void {
    const now = Date.now();
    const next = this.pendingInvites.filter(
      (p) => new Date(p.expiresAt).getTime() > now,
    );
    if (next.length !== this.pendingInvites.length) {
      this.pendingInvites = next;
      this.persist();
    }
  }

  openDm(state: ConnectionState, peerName: string): string {
    const peer = peerName.trim();
    if (!peer) throw new Error("Nama peer kosong");
    if (peer.toLowerCase() === state.displayName.trim().toLowerCase()) {
      throw new Error("Tidak bisa DM diri sendiri");
    }
    const room = dmRoomId(state.displayName, peer);
    this.rooms.join(state, room);
    // Peer online dengan nama sama → ikut join agar broadcast langsung
    for (const conn of this.connections.all()) {
      if (conn.session.id === state.session.id) continue;
      if (conn.displayName.trim().toLowerCase() === peer.toLowerCase()) {
        this.rooms.join(conn, room);
      }
    }
    this.connections.send(state.socket, {
      type: "group.dm",
      room,
      peerName: peer,
    } satisfies ServerMessage);
    return room;
  }

  private addMember(state: ConnectionState, group: ChatGroup): ChatGroup {
    const key = this.memberKey(state);
    if (!group.members.some((m) => m.key === key)) {
      if (group.members.length >= 50) throw new Error("Grup penuh (max 50)");
      group.members.push({
        key,
        name: state.displayName,
        tokenId: state.session.tokenId,
        joinedAt: new Date().toISOString(),
      });
      this.persist();
    }
    this.rooms.join(state, groupRoomId(group.id));
    this.broadcastToGroup(group, {
      type: "group.updated",
      group: this.publicGroup(group),
    });
    this.sendList(state);
    this.connections.send(state.socket, {
      type: "group.joined",
      group: this.publicGroup(group),
    } satisfies ServerMessage);
    return group;
  }

  private emitGroup(
    group: ChatGroup,
    type: "group.created",
    state: ConnectionState,
  ): void {
    this.connections.send(state.socket, {
      type,
      group: this.publicGroup(group),
    } satisfies ServerMessage);
  }

  private sendList(state: ConnectionState, list?: ChatGroup[]): void {
    const groups = (list || this.listFor(state)).map((g) => this.publicGroup(g));
    this.connections.send(state.socket, {
      type: "group.list",
      groups,
    } satisfies ServerMessage);
  }

  private broadcastToGroup(group: ChatGroup, payload: ServerMessage): void {
    const keys = new Set(group.members.map((m) => m.key));
    for (const conn of this.connections.all()) {
      if (keys.has(this.memberKey(conn))) {
        this.connections.send(conn.socket, payload);
      }
    }
  }

  private publicGroup(group: ChatGroup) {
    return {
      id: group.id,
      name: group.name,
      code: group.code,
      ownerKey: group.ownerKey,
      room: groupRoomId(group.id),
      createdAt: group.createdAt,
      members: group.members.map((m) => ({
        key: m.key,
        name: m.name,
        joinedAt: m.joinedAt,
      })),
    };
  }

  private newCode(): string {
    for (let i = 0; i < 20; i++) {
      const code = randomBytes(3).toString("hex").toUpperCase().slice(0, 6);
      if (![...this.groups.values()].some((g) => g.code === code)) return code;
    }
    return randomUUID().replace(/-/g, "").slice(0, 6).toUpperCase();
  }

  private load(): void {
    try {
      if (!fs.existsSync(this.storePath)) return;
      const raw = JSON.parse(fs.readFileSync(this.storePath, "utf8")) as Store;
      if (!Array.isArray(raw?.groups)) return;
      for (const g of raw.groups) {
        if (!g?.id || !g.name) continue;
        this.groups.set(g.id, {
          id: String(g.id),
          name: String(g.name).slice(0, 64),
          code: String(g.code || this.newCode()).toUpperCase().slice(0, 8),
          ownerKey: String(g.ownerKey || ""),
          createdAt: String(g.createdAt || new Date().toISOString()),
          members: Array.isArray(g.members)
            ? g.members
                .filter((m) => m?.key)
                .map((m) => ({
                  key: String(m.key),
                  name: String(m.name || "Anon").slice(0, 64),
                  tokenId: String(m.tokenId || ""),
                  joinedAt: String(m.joinedAt || new Date().toISOString()),
                }))
            : [],
        });
      }
      if (Array.isArray(raw.pendingInvites)) {
        this.pendingInvites = raw.pendingInvites
          .filter((p) => p?.groupId && p?.peerKey)
          .map((p) => ({
            id: String(p.id || randomUUID()),
            groupId: String(p.groupId),
            peerKey: String(p.peerKey),
            invitedByKey: String(p.invitedByKey || ""),
            invitedByName: String(p.invitedByName || ""),
            createdAt: String(p.createdAt || new Date().toISOString()),
            expiresAt: String(
              p.expiresAt ||
                new Date(Date.now() + PENDING_TTL_MS).toISOString(),
            ),
          }));
      }
    } catch {
      this.groups.clear();
      this.pendingInvites = [];
    }
  }

  private persist(): void {
    try {
      fs.mkdirSync(path.dirname(this.storePath), { recursive: true });
      const groups = [...this.groups.values()];
      fs.writeFileSync(
        this.storePath,
        JSON.stringify({ groups, pendingInvites: this.pendingInvites }, null, 2),
        "utf8",
      );
    } catch (err) {
      console.warn("[groups] gagal simpan", err);
    }
  }
}
