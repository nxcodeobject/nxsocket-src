import fs from "node:fs";
import path from "node:path";
import type { GatewayTokenRecord } from "../shared/types.js";
import type { AdapterOptions, ChatRecord, DataAdapter } from "./types.js";

export class JsonAdapter implements DataAdapter {
  readonly kind = "json" as const;
  private readonly tokensPath: string;
  private readonly chatPath: string;
  private tokens: GatewayTokenRecord[] = [];

  constructor(private readonly options: AdapterOptions) {
    this.tokensPath = path.join(options.dataDir, "tokens.json");
    this.chatPath = path.join(options.dataDir, "chat.json");
  }

  async init(): Promise<void> {
    fs.mkdirSync(this.options.dataDir, { recursive: true });
    await this.reloadTokens();
    if (!fs.existsSync(this.chatPath)) {
      fs.writeFileSync(this.chatPath, "[]", "utf8");
    }
  }

  async close(): Promise<void> {
    /* no-op */
  }

  async reloadTokens(): Promise<void> {
    if (!fs.existsSync(this.tokensPath)) {
      this.tokens = [];
      this.writeTokens();
      return;
    }
    const raw = fs.readFileSync(this.tokensPath, "utf8");
    const parsed = raw.trim() ? (JSON.parse(raw) as GatewayTokenRecord[]) : [];
    this.tokens = parsed.map((r) => ({
      ...r,
      expiresAt: r.expiresAt ?? null,
      scopes: r.scopes?.length ? r.scopes : ["*"],
      allowedRooms: r.allowedRooms ?? null,
    }));
  }

  private writeTokens(): void {
    fs.mkdirSync(path.dirname(this.tokensPath), { recursive: true });
    fs.writeFileSync(this.tokensPath, JSON.stringify(this.tokens, null, 2), "utf8");
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
    await this.reloadTokens();
    const idx = this.tokens.findIndex((r) => r.id === record.id);
    if (idx >= 0) this.tokens[idx] = record;
    else this.tokens.push(record);
    this.writeTokens();
  }

  async replaceTokens(records: GatewayTokenRecord[]): Promise<void> {
    this.tokens = records;
    this.writeTokens();
  }

  async saveChat(message: ChatRecord): Promise<void> {
    const rows = this.readChatFile();
    rows.push(message);
    fs.writeFileSync(this.chatPath, JSON.stringify(rows, null, 2), "utf8");
  }

  async listChat(room: string, limit = 50): Promise<ChatRecord[]> {
    return this.readChatFile()
      .filter((r) => r.room === room)
      .slice(-limit);
  }

  async updateChatStatus(
    ids: string[],
    status: ChatRecord["status"],
    meta?: { readAt?: string },
  ): Promise<number> {
    if (!ids.length || !status) return 0;
    const want = new Set(ids);
    const rows = this.readChatFile();
    let n = 0;
    for (const row of rows) {
      if (!want.has(row.id)) continue;
      const rank = { sent: 1, delivered: 2, read: 3 } as const;
      const cur = row.status && rank[row.status] ? row.status : "sent";
      if (rank[status] < rank[cur]) continue;
      row.status = status;
      if (status === "read") row.readAt = meta?.readAt || new Date().toISOString();
      n += 1;
    }
    if (n) fs.writeFileSync(this.chatPath, JSON.stringify(rows, null, 2), "utf8");
    return n;
  }

  async markChatRead(
    room: string,
    readerSessionId: string,
    opts?: { messageIds?: string[]; upToTs?: string },
  ): Promise<ChatRecord[]> {
    const rows = this.readChatFile();
    const idFilter = opts?.messageIds?.length ? new Set(opts.messageIds) : null;
    const upTo = opts?.upToTs || "";
    const readAt = new Date().toISOString();
    const updated: ChatRecord[] = [];
    for (const row of rows) {
      if (row.room !== room) continue;
      if (row.from === readerSessionId) continue;
      if (idFilter && !idFilter.has(row.id)) continue;
      if (upTo && row.ts > upTo) continue;
      if (row.status === "read") continue;
      row.status = "read";
      row.readAt = readAt;
      updated.push({ ...row });
    }
    if (updated.length) {
      fs.writeFileSync(this.chatPath, JSON.stringify(rows, null, 2), "utf8");
    }
    return updated;
  }

  private readChatFile(): ChatRecord[] {
    if (!fs.existsSync(this.chatPath)) return [];
    const raw = fs.readFileSync(this.chatPath, "utf8");
    return raw.trim() ? (JSON.parse(raw) as ChatRecord[]) : [];
  }
}
