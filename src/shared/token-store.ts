import { randomBytes, randomUUID } from "node:crypto";
import type { DataAdapter } from "../adapters/types.js";
import { normalizeScopes, parseExpiresIn } from "./auth.js";
import { normalizeAllowedRooms } from "./room-acl.js";
import type { GatewayTokenRecord, TokenScope } from "./types.js";

export type CreateTokenOptions = {
  label?: string;
  expiresIn?: string;
  scopes?: string[] | string;
  rooms?: string[] | string;
};

/**
 * TokenStore di atas DataAdapter (json / sqlite / firebase).
 */
export class TokenStore {
  constructor(private readonly adapter: DataAdapter) {}

  async reload(): Promise<void> {
    await this.adapter.reloadTokens();
  }

  list(includeRevoked = false): GatewayTokenRecord[] {
    return this.adapter.listTokens(includeRevoked);
  }

  findByToken(token: string): GatewayTokenRecord | undefined {
    return this.adapter.findTokenByValue(token);
  }

  findById(id: string): GatewayTokenRecord | undefined {
    return this.adapter.findTokenById(id);
  }

  async create(options: CreateTokenOptions | string = "default"): Promise<GatewayTokenRecord> {
    await this.adapter.reloadTokens();
    const opts: CreateTokenOptions =
      typeof options === "string" ? { label: options } : options;
    const now = new Date().toISOString();
    const record: GatewayTokenRecord = {
      id: randomUUID(),
      token: randomBytes(32).toString("hex"),
      label: opts.label?.trim() || "default",
      createdAt: now,
      updatedAt: now,
      revokedAt: null,
      expiresAt: parseExpiresIn(opts.expiresIn),
      scopes: normalizeScopes(opts.scopes) as TokenScope[],
      allowedRooms: normalizeAllowedRooms(opts.rooms),
    };
    await this.adapter.upsertToken(record);
    return record;
  }

  async regenerate(id: string): Promise<GatewayTokenRecord> {
    await this.adapter.reloadTokens();
    const record = this.adapter.findTokenById(id);
    if (!record) {
      throw new Error(`Token id tidak ditemukan: ${id}`);
    }
    if (record.revokedAt) {
      throw new Error(`Token sudah di-revoke: ${id}`);
    }

    const next: GatewayTokenRecord = {
      ...record,
      token: randomBytes(32).toString("hex"),
      updatedAt: new Date().toISOString(),
      scopes: record.scopes?.length ? record.scopes : ["*"],
      expiresAt: record.expiresAt ?? null,
      allowedRooms: record.allowedRooms ?? null,
    };
    await this.adapter.upsertToken(next);
    return next;
  }

  async revoke(id: string): Promise<GatewayTokenRecord> {
    await this.adapter.reloadTokens();
    const record = this.adapter.findTokenById(id);
    if (!record) {
      throw new Error(`Token id tidak ditemukan: ${id}`);
    }
    if (record.revokedAt) {
      return record;
    }

    const next: GatewayTokenRecord = {
      ...record,
      revokedAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      scopes: record.scopes?.length ? record.scopes : ["*"],
      expiresAt: record.expiresAt ?? null,
      allowedRooms: record.allowedRooms ?? null,
    };
    await this.adapter.upsertToken(next);
    return next;
  }

  async ensureDefault(): Promise<GatewayTokenRecord> {
    await this.adapter.reloadTokens();
    const active = this.adapter.listTokens(false);
    if (active.length > 0) {
      const row = active[0]!;
      return {
        ...row,
        scopes: row.scopes?.length ? row.scopes : ["*"],
        expiresAt: row.expiresAt ?? null,
        allowedRooms: row.allowedRooms ?? null,
      };
    }
    return this.create({ label: "default", scopes: ["*"] });
  }
}
