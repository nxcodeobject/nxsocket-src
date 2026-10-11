import fs from "node:fs";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import type { GatewayTokenRecord } from "../shared/types.js";
import type { AdapterOptions, ChatRecord, DataAdapter } from "./types.js";

export class SqliteAdapter implements DataAdapter {
  readonly kind = "sqlite" as const;
  private db!: DatabaseSync;
  private tokens: GatewayTokenRecord[] = [];
  private readonly dbPath: string;

  constructor(private readonly options: AdapterOptions) {
    this.dbPath = path.join(options.dataDir, "nxsocket.sqlite");
  }

  async init(): Promise<void> {
    fs.mkdirSync(this.options.dataDir, { recursive: true });
    this.db = new DatabaseSync(this.dbPath);
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS tokens (
        id TEXT PRIMARY KEY,
        token TEXT NOT NULL,
        label TEXT NOT NULL,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        revoked_at TEXT
      );
      CREATE TABLE IF NOT EXISTS chat (
        id TEXT PRIMARY KEY,
        room TEXT NOT NULL,
        text TEXT NOT NULL,
        from_id TEXT NOT NULL,
        name TEXT NOT NULL,
        to_id TEXT,
        ts TEXT NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_chat_room_ts ON chat(room, ts);
    `);
    this.migrateTokenColumns();
    this.migrateChatColumns();
    await this.reloadTokens();
  }

  private migrateChatColumns(): void {
    const cols = this.db
      .prepare(`PRAGMA table_info(chat)`)
      .all() as Array<{ name: string }>;
    const names = new Set(cols.map((c) => c.name));
    if (!names.has("status")) {
      this.db.exec(`ALTER TABLE chat ADD COLUMN status TEXT`);
    }
    if (!names.has("read_at")) {
      this.db.exec(`ALTER TABLE chat ADD COLUMN read_at TEXT`);
    }
  }

  private migrateTokenColumns(): void {
    const cols = this.db
      .prepare(`PRAGMA table_info(tokens)`)
      .all() as Array<{ name: string }>;
    const names = new Set(cols.map((c) => c.name));
    if (!names.has("expires_at")) {
      this.db.exec(`ALTER TABLE tokens ADD COLUMN expires_at TEXT`);
    }
    if (!names.has("scopes")) {
      this.db.exec(`ALTER TABLE tokens ADD COLUMN scopes TEXT`);
    }
    if (!names.has("allowed_rooms")) {
      this.db.exec(`ALTER TABLE tokens ADD COLUMN allowed_rooms TEXT`);
    }
  }

  async close(): Promise<void> {
    this.db?.close();
  }

  async reloadTokens(): Promise<void> {
    const rows = this.db
      .prepare(
        `SELECT id, token, label,
                created_at AS createdAt, updated_at AS updatedAt, revoked_at AS revokedAt,
                expires_at AS expiresAt, scopes, allowed_rooms AS allowedRooms
         FROM tokens ORDER BY created_at ASC`,
      )
      .all() as Array<{
      id: string;
      token: string;
      label: string;
      createdAt: string;
      updatedAt: string;
      revokedAt: string | null;
      expiresAt: string | null;
      scopes: string | null;
      allowedRooms: string | null;
    }>;

    this.tokens = rows.map((r) => ({
      id: r.id,
      token: r.token,
      label: r.label,
      createdAt: r.createdAt,
      updatedAt: r.updatedAt,
      revokedAt: r.revokedAt ?? null,
      expiresAt: r.expiresAt ?? null,
      scopes: parseScopes(r.scopes),
      allowedRooms: parseRooms(r.allowedRooms),
    }));
  }

  listTokens(includeRevoked = false): GatewayTokenRecord[] {
    return this.tokens.filter((r) => includeRevoked || !r.revokedAt);
  }

  findTokenByValue(token: string): GatewayTokenRecord | undefined {
    return this.tokens.find((r) => r.token === token && !r.revokedAt);
  }

  findTokenById(id: string): GatewayTokenRecord | undefined {
    return this.tokens.find((r) => r.id === id);
  }

  async upsertToken(record: GatewayTokenRecord): Promise<void> {
    this.db
      .prepare(
        `INSERT INTO tokens (id, token, label, created_at, updated_at, revoked_at, expires_at, scopes, allowed_rooms)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT(id) DO UPDATE SET
           token = excluded.token,
           label = excluded.label,
           updated_at = excluded.updated_at,
           revoked_at = excluded.revoked_at,
           expires_at = excluded.expires_at,
           scopes = excluded.scopes,
           allowed_rooms = excluded.allowed_rooms`,
      )
      .run(
        record.id,
        record.token,
        record.label,
        record.createdAt,
        record.updatedAt,
        record.revokedAt,
        record.expiresAt,
        JSON.stringify(record.scopes?.length ? record.scopes : ["*"]),
        record.allowedRooms ? JSON.stringify(record.allowedRooms) : null,
      );
    await this.reloadTokens();
  }

  async replaceTokens(records: GatewayTokenRecord[]): Promise<void> {
    const insert = this.db.prepare(
      `INSERT INTO tokens (id, token, label, created_at, updated_at, revoked_at, expires_at, scopes, allowed_rooms)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    );
    this.db.exec("BEGIN");
    try {
      this.db.exec("DELETE FROM tokens");
      for (const record of records) {
        insert.run(
          record.id,
          record.token,
          record.label,
          record.createdAt,
          record.updatedAt,
          record.revokedAt,
          record.expiresAt,
          JSON.stringify(record.scopes?.length ? record.scopes : ["*"]),
          record.allowedRooms ? JSON.stringify(record.allowedRooms) : null,
        );
      }
      this.db.exec("COMMIT");
    } catch (err) {
      this.db.exec("ROLLBACK");
      throw err;
    }
    this.tokens = records;
  }

  async saveChat(message: ChatRecord): Promise<void> {
    this.db
      .prepare(
        `INSERT INTO chat (id, room, text, from_id, name, to_id, ts, status, read_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        message.id,
        message.room,
        message.text,
        message.from,
        message.name,
        message.to ?? null,
        message.ts,
        message.status ?? "sent",
        message.readAt ?? null,
      );
  }

  async listChat(room: string, limit = 50): Promise<ChatRecord[]> {
    const rows = this.db
      .prepare(
        `SELECT id, room, text, from_id AS "from", name, to_id AS "to", ts, status, read_at AS readAt
         FROM chat WHERE room = ? ORDER BY ts DESC LIMIT ?`,
      )
      .all(room, limit) as Array<{
      id: string;
      room: string;
      text: string;
      from: string;
      name: string;
      to: string | null;
      ts: string;
      status: string | null;
      readAt: string | null;
    }>;

    return rows
      .map((r) => ({
        id: r.id,
        room: r.room,
        text: r.text,
        from: r.from,
        name: r.name,
        to: r.to ?? undefined,
        ts: r.ts,
        status: (r.status as ChatRecord["status"]) || "sent",
        readAt: r.readAt ?? undefined,
      }))
      .reverse();
  }

  async updateChatStatus(
    ids: string[],
    status: ChatRecord["status"],
    meta?: { readAt?: string },
  ): Promise<number> {
    if (!ids.length || !status) return 0;
    const readAt = status === "read" ? meta?.readAt || new Date().toISOString() : null;
    const stmt = this.db.prepare(
      `UPDATE chat SET status = ?, read_at = COALESCE(?, read_at)
       WHERE id = ? AND (
         CASE status
           WHEN 'read' THEN 3
           WHEN 'delivered' THEN 2
           WHEN 'sent' THEN 1
           ELSE 0
         END
       ) <= (
         CASE ?
           WHEN 'read' THEN 3
           WHEN 'delivered' THEN 2
           WHEN 'sent' THEN 1
           ELSE 0
         END
       )`,
    );
    let n = 0;
    for (const id of ids) {
      const info = stmt.run(status, readAt, id, status);
      n += Number(info.changes || 0);
    }
    return n;
  }

  async markChatRead(
    room: string,
    readerSessionId: string,
    opts?: { messageIds?: string[]; upToTs?: string },
  ): Promise<ChatRecord[]> {
    const readAt = new Date().toISOString();
    let rows: ChatRecord[] = await this.listChat(room, 200);
    rows = rows.filter((r) => {
      if (r.from === readerSessionId) return false;
      if (r.status === "read") return false;
      if (opts?.messageIds?.length && !opts.messageIds.includes(r.id)) return false;
      if (opts?.upToTs && r.ts > opts.upToTs) return false;
      return true;
    });
    if (!rows.length) return [];
    await this.updateChatStatus(
      rows.map((r) => r.id),
      "read",
      { readAt },
    );
    return rows.map((r) => ({ ...r, status: "read" as const, readAt }));
  }
}

function parseScopes(raw: string | null): GatewayTokenRecord["scopes"] {
  if (!raw) return ["*"];
  try {
    const parsed = JSON.parse(raw) as string[];
    return parsed.length ? (parsed as GatewayTokenRecord["scopes"]) : ["*"];
  } catch {
    return ["*"];
  }
}

function parseRooms(raw: string | null): string[] | null {
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as string[];
    return parsed.length ? parsed : null;
  } catch {
    return null;
  }
}
