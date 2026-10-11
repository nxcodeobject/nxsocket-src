import fs from "node:fs";
import path from "node:path";

export type BlockEntry = {
  /** Nomor yang memblokir (digit). */
  byPhone: string;
  /** Daftar nomor yang diblokir. */
  blocked: string[];
  updatedAt: string;
};

type StoreFile = { entries: BlockEntry[] };

function digitsOnly(value: string): string {
  return String(value || "").replace(/\D/g, "");
}

function phonesMatch(a: string, b: string): boolean {
  const x = digitsOnly(a);
  const y = digitsOnly(b);
  if (!x || !y) return false;
  return x === y || x.endsWith(y) || y.endsWith(x);
}

/**
 * Blokir server-side Remora (per nomor).
 * Client sync daftar lewat `blocks.sync`.
 */
export class BlockModule {
  private readonly storePath: string;
  private entries: BlockEntry[] = [];

  constructor(dataDir: string) {
    this.storePath = path.join(dataDir, "blocks.json");
    this.entries = loadStore(this.storePath);
  }

  setBlocks(byPhone: string, blocked: string[]): BlockEntry {
    const key = digitsOnly(byPhone);
    if (!key) throw new Error("Nomor pemblokir kosong");
    const list = [
      ...new Set(
        (blocked || [])
          .map((p) => digitsOnly(p))
          .filter((p) => p && p !== key),
      ),
    ].slice(0, 200);

    const next: BlockEntry = {
      byPhone: key,
      blocked: list,
      updatedAt: new Date().toISOString(),
    };
    const idx = this.entries.findIndex((e) => e.byPhone === key);
    if (idx >= 0) this.entries[idx] = next;
    else this.entries.push(next);
    this.persist();
    return next;
  }

  getBlocked(byPhone: string): string[] {
    const key = digitsOnly(byPhone);
    if (!key) return [];
    const hit = this.entries.find((e) => e.byPhone === key);
    return hit ? [...hit.blocked] : [];
  }

  /** true jika A memblokir B atau B memblokir A. */
  isEitherBlocked(phoneA: string, phoneB: string): boolean {
    const a = digitsOnly(phoneA);
    const b = digitsOnly(phoneB);
    if (!a || !b) return false;
    if (this.getBlocked(a).some((p) => phonesMatch(p, b))) return true;
    if (this.getBlocked(b).some((p) => phonesMatch(p, a))) return true;
    return false;
  }

  private persist(): void {
    const payload: StoreFile = { entries: this.entries };
    fs.writeFileSync(this.storePath, JSON.stringify(payload, null, 2), "utf8");
  }
}

function loadStore(file: string): BlockEntry[] {
  try {
    if (!fs.existsSync(file)) return [];
    const parsed = JSON.parse(fs.readFileSync(file, "utf8")) as StoreFile;
    return Array.isArray(parsed?.entries) ? parsed.entries : [];
  } catch {
    return [];
  }
}
