import { randomUUID } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import type { ServerMessage } from "../../shared/types.js";
import type { ConnectionManager, ConnectionState } from "../core/connection.js";
import type { RoomManager } from "../core/room.js";

export type FeedComment = {
  id: string;
  postId: string;
  parentId: string | null;
  from: string;
  name: string;
  text: string;
  ts: string;
};

export type FeedLike = {
  from: string;
  name: string;
};

export type FeedShared = {
  id: string;
  from: string;
  name: string;
  text: string;
  image?: string;
};

export type FeedFollowTarget = {
  from: string;
  name: string;
};

export type FeedPost = {
  id: string;
  room: string;
  from: string;
  name: string;
  authorTokenId?: string;
  text: string;
  image?: string;
  shared?: FeedShared;
  ts: string;
  likes: FeedLike[];
  comments: FeedComment[];
};

type FeedStore = {
  rooms: Record<string, FeedPost[]>;
  follows?: Record<string, FeedFollowTarget[]>;
};

const MAX_TEXT = 2000;
const MAX_IMAGE_CHARS = 280_000;
const MAX_POSTS_PER_ROOM = 200;
const MAX_COMMENTS_PER_POST = 500;

export class FeedModule {
  private readonly storePath: string;
  private rooms = new Map<string, FeedPost[]>();
  /** key = tokenId|displayname → targets */
  private follows = new Map<string, FeedFollowTarget[]>();

  constructor(
    dataDir: string,
    private readonly connections: ConnectionManager,
    private readonly roomManager: RoomManager,
  ) {
    this.storePath = path.join(dataDir, "feed.json");
    this.load();
  }

  join(state: ConnectionState, room: string): void {
    const key = this.roomKey(room);
    this.roomManager.join(state, key);
    this.sendSnapshot(state, key);
    this.sendFollows(state);
  }

  list(state: ConnectionState, room: string, limit = 50): void {
    const key = this.roomKey(room);
    this.sendSnapshot(state, key, limit);
  }

  createPost(
    state: ConnectionState,
    room: string,
    text: string,
    image?: string | null,
    shared?: FeedShared | null,
  ): FeedPost {
    const key = this.roomKey(room);
    if (!state.rooms.has(key)) {
      this.roomManager.join(state, key);
    }
    const body = (text || "").trim().slice(0, MAX_TEXT);
    const img = this.cleanImage(image);
    const sharedClean = shared
      ? {
          id: String(shared.id),
          from: String(shared.from || ""),
          name: String(shared.name || "Anon").slice(0, 64),
          text: String(shared.text || "").slice(0, MAX_TEXT),
          ...((): { image?: string } => {
            try {
              const im = this.cleanImage(shared.image);
              return im ? { image: im } : {};
            } catch {
              return {};
            }
          })(),
        }
      : undefined;
    if (!body && !img && !sharedClean) throw new Error("Isi teks, foto, atau share dulu");

    const post: FeedPost = {
      id: randomUUID(),
      room: key,
      from: state.session.id,
      name: state.displayName,
      authorTokenId: state.session.tokenId,
      text: body,
      image: img,
      shared: sharedClean,
      ts: new Date().toISOString(),
      likes: [],
      comments: [],
    };
    const list = this.ensureRoom(key);
    list.unshift(post);
    if (list.length > MAX_POSTS_PER_ROOM) {
      list.length = MAX_POSTS_PER_ROOM;
    }
    this.persist();
    const payload: ServerMessage = {
      type: "feed.post.created",
      room: key,
      post: this.publicPost(post),
    };
    this.roomManager.broadcast(key, payload);
    this.notifyFollowers(state, key, post);
    return post;
  }

  sharePost(
    state: ConnectionState,
    room: string,
    postId: string,
    text?: string,
  ): FeedPost {
    const key = this.roomKey(room);
    const original = this.ensureRoom(key).find((p) => p.id === postId);
    if (!original) throw new Error("Post tidak ditemukan");
    if (original.from === state.session.id) {
      throw new Error("Tidak bisa share status sendiri");
    }
    return this.createPost(state, key, text || "", null, {
      id: original.id,
      from: original.from,
      name: original.name,
      text: original.text,
      image: original.image,
    });
  }

  deletePost(state: ConnectionState, room: string, postId: string): void {
    const key = this.roomKey(room);
    const list = this.ensureRoom(key);
    const idx = list.findIndex((p) => p.id === postId);
    if (idx < 0) throw new Error("Post tidak ditemukan");
    const post = list[idx]!;
    if (post.from !== state.session.id) {
      throw new Error("Hanya penulis yang bisa hapus status ini");
    }
    list.splice(idx, 1);
    this.persist();
    this.roomManager.broadcast(key, {
      type: "feed.post.deleted",
      room: key,
      postId,
    } satisfies ServerMessage);
  }

  toggleFollow(
    state: ConnectionState,
    targetFrom: string,
    targetName: string,
  ): FeedFollowTarget[] {
    const from = targetFrom.trim();
    const name = targetName.trim().slice(0, 64);
    if (!from && !name) throw new Error("Target follow kosong");
    if (from === state.session.id) throw new Error("Tidak bisa follow diri sendiri");

    const key = this.followerKey(state);
    const list = this.follows.get(key) ? [...this.follows.get(key)!] : [];
    const idx = list.findIndex(
      (t) =>
        (from && t.from === from) ||
        (name && t.name.toLowerCase() === name.toLowerCase()),
    );
    if (idx >= 0) {
      list.splice(idx, 1);
    } else {
      list.push({ from: from || "", name: name || "Anon" });
    }
    this.follows.set(key, list);
    this.persist();
    this.sendFollows(state);
    return list;
  }

  createComment(
    state: ConnectionState,
    room: string,
    postId: string,
    text: string,
    parentId?: string | null,
  ): FeedComment {
    const key = this.roomKey(room);
    if (!state.rooms.has(key)) {
      this.roomManager.join(state, key);
    }
    const post = this.ensureRoom(key).find((p) => p.id === postId);
    if (!post) throw new Error("Post tidak ditemukan");

    let parent: string | null = parentId?.trim() || null;
    let parentComment: FeedComment | undefined;
    if (parent) {
      parentComment = post.comments.find((c) => c.id === parent);
      if (!parentComment) throw new Error("Komentar induk tidak ditemukan");
      if (parentComment.parentId) {
        parent = parentComment.parentId;
        parentComment = post.comments.find((c) => c.id === parent);
      }
    }

    if (post.comments.length >= MAX_COMMENTS_PER_POST) {
      throw new Error("Komentar di post ini sudah penuh");
    }

    const comment: FeedComment = {
      id: randomUUID(),
      postId: post.id,
      parentId: parent,
      from: state.session.id,
      name: state.displayName,
      text: this.cleanText(text),
      ts: new Date().toISOString(),
    };
    post.comments.push(comment);
    this.persist();
    const payload: ServerMessage = {
      type: "feed.comment.created",
      room: key,
      postId: post.id,
      comment: this.publicComment(comment),
    };
    this.roomManager.broadcast(key, payload);

    const notifyTargets = new Set<string>();
    if (post.from && post.from !== state.session.id) notifyTargets.add(post.from);
    if (parentComment?.from && parentComment.from !== state.session.id) {
      notifyTargets.add(parentComment.from);
    }
    for (const target of notifyTargets) {
      this.connections.sendToSession(target, {
        type: "feed.notify",
        room: key,
        kind: parent ? "reply" : "comment",
        postId: post.id,
        from: state.session.id,
        name: state.displayName,
        text: comment.text,
        ts: comment.ts,
      } satisfies ServerMessage);
    }

    return comment;
  }

  toggleLike(state: ConnectionState, room: string, postId: string): FeedPost {
    const key = this.roomKey(room);
    if (!state.rooms.has(key)) {
      this.roomManager.join(state, key);
    }
    const post = this.ensureRoom(key).find((p) => p.id === postId);
    if (!post) throw new Error("Post tidak ditemukan");
    if (!post.likes) post.likes = [];

    const idx = post.likes.findIndex((l) => l.from === state.session.id);
    if (idx >= 0) {
      post.likes.splice(idx, 1);
    } else {
      post.likes.push({ from: state.session.id, name: state.displayName });
    }
    this.persist();
    const payload: ServerMessage = {
      type: "feed.like.updated",
      room: key,
      postId: post.id,
      likes: post.likes.map((l) => ({ from: l.from, name: l.name })),
    };
    this.roomManager.broadcast(key, payload);
    return post;
  }

  private notifyFollowers(
    author: ConnectionState,
    room: string,
    post: FeedPost,
  ): void {
    const preview = (post.text || (post.shared ? "(share)" : "") || "(foto)").slice(0, 120);
    const authorName = author.displayName.toLowerCase();
    const authorFrom = author.session.id;

    for (const conn of this.connections.all()) {
      if (conn.session.id === author.session.id) continue;
      if (!conn.rooms.has(room)) continue;
      const list = this.follows.get(this.followerKey(conn)) || [];
      const matched = list.some(
        (t) =>
          (t.from && t.from === authorFrom) ||
          (t.name && t.name.toLowerCase() === authorName),
      );
      if (!matched) continue;
      this.connections.send(conn.socket, {
        type: "feed.notify",
        room,
        kind: post.shared ? "share" : "post",
        postId: post.id,
        from: author.session.id,
        name: author.displayName,
        text: preview,
        ts: post.ts,
      } satisfies ServerMessage);
    }
  }

  private sendFollows(state: ConnectionState): void {
    const following = this.follows.get(this.followerKey(state)) || [];
    this.connections.send(state.socket, {
      type: "feed.follows",
      following: following.map((t) => ({ from: t.from, name: t.name })),
    } satisfies ServerMessage);
  }

  private followerKey(state: ConnectionState): string {
    return `${state.session.tokenId}|${state.displayName.trim().toLowerCase() || "anon"}`;
  }

  private sendSnapshot(state: ConnectionState, room: string, limit = 50): void {
    const lim = Math.min(100, Math.max(1, limit));
    const posts = this.ensureRoom(room)
      .slice(0, lim)
      .map((p) => this.publicPost(p));
    this.connections.send(state.socket, {
      type: "feed.snapshot",
      room,
      posts,
    } satisfies ServerMessage);
  }

  private publicPost(post: FeedPost) {
    return {
      id: post.id,
      room: post.room,
      from: post.from,
      name: post.name,
      authorTokenId: post.authorTokenId,
      text: post.text,
      image: post.image,
      shared: post.shared
        ? {
            id: post.shared.id,
            from: post.shared.from,
            name: post.shared.name,
            text: post.shared.text,
            image: post.shared.image,
          }
        : undefined,
      ts: post.ts,
      likes: (post.likes || []).map((l) => ({ from: l.from, name: l.name })),
      comments: post.comments.map((c) => this.publicComment(c)),
    };
  }

  private publicComment(c: FeedComment) {
    return {
      id: c.id,
      postId: c.postId,
      parentId: c.parentId,
      from: c.from,
      name: c.name,
      text: c.text,
      ts: c.ts,
    };
  }

  private roomKey(room: string): string {
    const key = room.trim().slice(0, 128);
    if (!key) throw new Error("Room feed kosong");
    return key;
  }

  private cleanText(text: string): string {
    const body = text.trim().slice(0, MAX_TEXT);
    if (!body) throw new Error("Teks kosong");
    return body;
  }

  private cleanImage(image?: string | null): string | undefined {
    if (image == null || image === "") return undefined;
    const raw = String(image);
    if (raw.length > MAX_IMAGE_CHARS) {
      throw new Error("Foto terlalu besar (max ~200KB setelah compress)");
    }
    if (!/^data:image\/(jpeg|jpg|png|webp);base64,/i.test(raw)) {
      throw new Error("Format foto harus JPEG/PNG/WebP (data URL)");
    }
    return raw;
  }

  private ensureRoom(room: string): FeedPost[] {
    let list = this.rooms.get(room);
    if (!list) {
      list = [];
      this.rooms.set(room, list);
    }
    return list;
  }

  private load(): void {
    try {
      if (!fs.existsSync(this.storePath)) return;
      const raw = JSON.parse(fs.readFileSync(this.storePath, "utf8")) as FeedStore;
      if (raw?.follows && typeof raw.follows === "object") {
        for (const [k, list] of Object.entries(raw.follows)) {
          if (!Array.isArray(list)) continue;
          this.follows.set(
            k,
            list
              .filter((t) => t && (t.from || t.name))
              .map((t) => ({
                from: String(t.from || ""),
                name: String(t.name || "Anon").slice(0, 64),
              })),
          );
        }
      }
      if (!raw?.rooms || typeof raw.rooms !== "object") return;
      for (const [room, posts] of Object.entries(raw.rooms)) {
        if (!Array.isArray(posts)) continue;
        const cleaned: FeedPost[] = [];
        for (const p of posts) {
          if (!p?.id) continue;
          const text = p.text != null ? String(p.text).slice(0, MAX_TEXT) : "";
          let image: string | undefined;
          try {
            image = this.cleanImage((p as FeedPost).image);
          } catch {
            image = undefined;
          }
          let shared: FeedShared | undefined;
          const rawShared = (p as FeedPost).shared;
          if (rawShared?.id) {
            let sharedImg: string | undefined;
            try {
              sharedImg = this.cleanImage(rawShared.image);
            } catch {
              sharedImg = undefined;
            }
            shared = {
              id: String(rawShared.id),
              from: String(rawShared.from || ""),
              name: String(rawShared.name || "Anon").slice(0, 64),
              text: String(rawShared.text || "").slice(0, MAX_TEXT),
              image: sharedImg,
            };
          }
          if (!text && !image && !shared) continue;
          cleaned.push({
            id: String(p.id),
            room: String(p.room || room),
            from: String(p.from || ""),
            name: String(p.name || "Anon").slice(0, 64),
            authorTokenId: (p as FeedPost).authorTokenId
              ? String((p as FeedPost).authorTokenId)
              : undefined,
            text,
            image,
            shared,
            ts: String(p.ts || new Date().toISOString()),
            likes: Array.isArray((p as FeedPost).likes)
              ? (p as FeedPost).likes
                  .filter((l) => l?.from)
                  .map((l) => ({
                    from: String(l.from),
                    name: String(l.name || "Anon").slice(0, 64),
                  }))
              : [],
            comments: Array.isArray(p.comments)
              ? p.comments
                  .filter((c) => c?.id && c.text)
                  .map((c) => ({
                    id: String(c.id),
                    postId: String(c.postId || p.id),
                    parentId: c.parentId ? String(c.parentId) : null,
                    from: String(c.from || ""),
                    name: String(c.name || "Anon").slice(0, 64),
                    text: String(c.text).slice(0, MAX_TEXT),
                    ts: String(c.ts || new Date().toISOString()),
                  }))
              : [],
          });
        }
        this.rooms.set(room, cleaned);
      }
    } catch {
      this.rooms.clear();
      this.follows.clear();
    }
  }

  private persist(): void {
    try {
      fs.mkdirSync(path.dirname(this.storePath), { recursive: true });
      const rooms: Record<string, FeedPost[]> = {};
      for (const [k, v] of this.rooms) rooms[k] = v;
      const follows: Record<string, FeedFollowTarget[]> = {};
      for (const [k, v] of this.follows) follows[k] = v;
      fs.writeFileSync(
        this.storePath,
        JSON.stringify({ rooms, follows }, null, 2),
        "utf8",
      );
    } catch (err) {
      console.warn("[feed] gagal simpan", err);
    }
  }
}
