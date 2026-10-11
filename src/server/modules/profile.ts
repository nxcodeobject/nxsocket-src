import fs from "node:fs";
import path from "node:path";

export type TokenProfile = {
  tokenId: string;
  displayName: string;
  lastRoom?: string;
  updatedAt: string;
};

export class ProfileModule {
  private readonly storePath: string;
  private profiles = new Map<string, TokenProfile>();

  constructor(dataDir: string) {
    this.storePath = path.join(dataDir, "profiles.json");
    this.load();
  }

  get(tokenId: string): TokenProfile | undefined {
    return this.profiles.get(tokenId);
  }

  hintPayload(tokenId: string): {
    type: "profile.hint";
    name?: string;
    lastRoom?: string;
    updatedAt?: string;
  } {
    const p = this.profiles.get(tokenId);
    return {
      type: "profile.hint",
      name: p?.displayName,
      lastRoom: p?.lastRoom,
      updatedAt: p?.updatedAt,
    };
  }

  setDisplayName(tokenId: string, name: string): TokenProfile {
    const trimmed = name.trim().slice(0, 64);
    const prev = this.profiles.get(tokenId);
    const next: TokenProfile = {
      tokenId,
      displayName: trimmed || prev?.displayName || "Aku",
      lastRoom: prev?.lastRoom,
      updatedAt: new Date().toISOString(),
    };
    this.profiles.set(tokenId, next);
    this.persist();
    return next;
  }

  setLastRoom(tokenId: string, room: string): TokenProfile {
    const key = room.trim();
    const prev = this.profiles.get(tokenId);
    const next: TokenProfile = {
      tokenId,
      displayName: prev?.displayName || "Aku",
      lastRoom: key || prev?.lastRoom,
      updatedAt: new Date().toISOString(),
    };
    this.profiles.set(tokenId, next);
    this.persist();
    return next;
  }

  private load(): void {
    try {
      if (!fs.existsSync(this.storePath)) return;
      const raw = JSON.parse(fs.readFileSync(this.storePath, "utf8")) as unknown;
      const list = Array.isArray(raw) ? raw : [];
      for (const row of list) {
        if (!row || typeof row !== "object") continue;
        const r = row as Partial<TokenProfile>;
        if (!r.tokenId || !r.displayName) continue;
        this.profiles.set(r.tokenId, {
          tokenId: r.tokenId,
          displayName: String(r.displayName).slice(0, 64),
          lastRoom: r.lastRoom ? String(r.lastRoom).slice(0, 128) : undefined,
          updatedAt: r.updatedAt || new Date().toISOString(),
        });
      }
    } catch {
      this.profiles.clear();
    }
  }

  private persist(): void {
    try {
      fs.mkdirSync(path.dirname(this.storePath), { recursive: true });
      const list = [...this.profiles.values()];
      fs.writeFileSync(this.storePath, JSON.stringify(list, null, 2), "utf8");
    } catch (err) {
      console.warn("[profile] gagal simpan", err);
    }
  }
}
