import type { GatewayTokenRecord, TokenScope } from "./types.js";

export const ALL_SCOPES: TokenScope[] = [
  "chat",
  "call",
  "presence",
  "notify",
  "monitor",
  "track",
  "ai",
  "terminal",
  "progress",
  "job",
  "sync",
  "admin",
];

export function normalizeScopes(input?: string[] | string | null): TokenScope[] {
  if (!input || (Array.isArray(input) && input.length === 0)) {
    return ["*"];
  }
  const raw = Array.isArray(input) ? input : input.split(",");
  const scopes = raw
    .map((s) => s.trim().toLowerCase())
    .filter(Boolean) as TokenScope[];
  if (scopes.includes("*")) return ["*"];
  return scopes.length ? scopes : ["*"];
}

export function hasScope(record: GatewayTokenRecord | { scopes?: TokenScope[] }, needed: TokenScope): boolean {
  const scopes = record.scopes?.length ? record.scopes : ["*"];
  if (scopes.includes("*") || scopes.includes("admin")) return true;
  return scopes.includes(needed);
}

export function assertTokenUsable(record: GatewayTokenRecord): void {
  if (record.revokedAt) {
    throw new Error("Token sudah di-revoke");
  }
  if (record.expiresAt && Date.parse(record.expiresAt) <= Date.now()) {
    throw new Error("Token sudah kedaluwarsa");
  }
}

export function parseExpiresIn(value?: string): string | null {
  if (!value || value.trim() === "" || value === "0" || value.toLowerCase() === "never") {
    return null;
  }
  const m = value.trim().match(/^(\d+)([smhd])$/i);
  if (!m) {
    throw new Error("Format --expires salah. Contoh: 1h, 7d, 30d, never");
  }
  const n = Number(m[1]);
  const unit = m[2]!.toLowerCase();
  const mult =
    unit === "s" ? 1000 : unit === "m" ? 60_000 : unit === "h" ? 3_600_000 : 86_400_000;
  return new Date(Date.now() + n * mult).toISOString();
}
