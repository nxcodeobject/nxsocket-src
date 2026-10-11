import { randomBytes } from "node:crypto";
import fs from "node:fs";
import path from "node:path";

export type MediaRecord = {
  id: string;
  mime: string;
  name: string;
  size: number;
  createdAt: number;
  expiresAt: number;
  tokenId?: string;
};

type IndexFile = {
  items: MediaRecord[];
};

/** Default 12MB — cukup untuk klip pendek / foto / suara. */
const DEFAULT_MAX_BYTES = 12 * 1024 * 1024;
/** Default TTL 7 hari. */
const DEFAULT_TTL_MS = 7 * 24 * 60 * 60 * 1000;

function envInt(name: string, fallback: number): number {
  const raw = process.env[name];
  if (raw == null || raw === "") return fallback;
  const n = Number(raw);
  return Number.isFinite(n) && n > 0 ? Math.floor(n) : fallback;
}

function safeFileName(name: string): string {
  const cleaned = String(name || "berkas")
    .replace(/[^\w.\-+() ]+/g, "_")
    .trim()
    .slice(0, 120);
  return cleaned || "berkas";
}

function extFrom(mime: string, name: string): string {
  const fromName = path.extname(name);
  if (fromName && fromName.length <= 8) return fromName.toLowerCase();
  const m = String(mime || "").toLowerCase();
  if (m.includes("jpeg") || m === "image/jpg") return ".jpg";
  if (m.includes("png")) return ".png";
  if (m.includes("webp")) return ".webp";
  if (m.includes("gif")) return ".gif";
  if (m.includes("mp4")) return ".mp4";
  if (m.includes("webm")) return ".webm";
  if (m.includes("quicktime")) return ".mov";
  if (m.includes("mpeg") || m.includes("mp3")) return ".mp3";
  if (m.includes("wav")) return ".wav";
  if (m.includes("aac") || m === "audio/mp4") return ".m4a";
  if (m.includes("ogg") || m.includes("opus")) return ".ogg";
  if (m.includes("pdf")) return ".pdf";
  return ".bin";
}

export class MediaModule {
  readonly root: string;
  readonly maxBytes: number;
  readonly ttlMs: number;
  private readonly indexPath: string;
  private items = new Map<string, MediaRecord>();
  private purgeTimer: ReturnType<typeof setInterval> | null = null;

  constructor(dataDir: string) {
    this.root = path.join(dataDir, "media");
    this.indexPath = path.join(this.root, "index.json");
    this.maxBytes = envInt("NXSOCKET_MEDIA_MAX_BYTES", DEFAULT_MAX_BYTES);
    this.ttlMs = envInt("NXSOCKET_MEDIA_TTL_MS", DEFAULT_TTL_MS);
    fs.mkdirSync(this.root, { recursive: true });
    this.load();
    this.purgeExpired();
    this.purgeTimer = setInterval(() => this.purgeExpired(), 60 * 60 * 1000);
    this.purgeTimer.unref?.();
  }

  async save(
    buffer: Buffer,
    opts: { mime: string; name: string; tokenId?: string },
  ): Promise<MediaRecord> {
    if (!buffer.length) {
      throw new Error("Body media kosong");
    }
    if (buffer.length > this.maxBytes) {
      const mb = Math.round(this.maxBytes / (1024 * 1024));
      throw new Error(`Media melebihi batas ${mb}MB`);
    }

    const id = randomBytes(18).toString("hex");
    const name = safeFileName(opts.name);
    const mime =
      String(opts.mime || "application/octet-stream").trim().slice(0, 120) ||
      "application/octet-stream";
    const ext = extFrom(mime, name);
    const filePath = path.join(this.root, `${id}${ext}`);
    await fs.promises.writeFile(filePath, buffer);

    const now = Date.now();
    const record: MediaRecord = {
      id,
      mime,
      name,
      size: buffer.length,
      createdAt: now,
      expiresAt: now + this.ttlMs,
      tokenId: opts.tokenId,
    };
    this.items.set(id, record);
    this.persist();
    return record;
  }

  resolve(id: string): { record: MediaRecord; filePath: string } | null {
    const clean = String(id || "").replace(/[^a-f0-9]/gi, "");
    if (!clean || clean.length < 16) return null;

    const record = this.items.get(clean);
    if (!record) return null;
    if (record.expiresAt <= Date.now()) {
      this.deleteId(clean);
      return null;
    }

    const filePath = this.findFile(clean);
    if (!filePath) {
      this.items.delete(clean);
      this.persist();
      return null;
    }
    return { record, filePath };
  }

  publicUrl(pathPrefix: string, id: string): string {
    const prefix = String(pathPrefix || "/v1").replace(/\/+$/, "") || "/v1";
    return `${prefix}/media/${id}`;
  }

  purgeExpired(now = Date.now()): number {
    let removed = 0;
    for (const [id, record] of this.items) {
      if (record.expiresAt <= now) {
        this.deleteId(id);
        removed += 1;
      }
    }
    return removed;
  }

  close(): void {
    if (this.purgeTimer) {
      clearInterval(this.purgeTimer);
      this.purgeTimer = null;
    }
  }

  private findFile(id: string): string | null {
    try {
      const entries = fs.readdirSync(this.root);
      const hit = entries.find(
        (f) => f === id || (f.startsWith(`${id}.`) && !f.endsWith(".json")),
      );
      if (!hit) return null;
      return path.join(this.root, hit);
    } catch {
      return null;
    }
  }

  private deleteId(id: string): void {
    this.items.delete(id);
    try {
      const filePath = this.findFile(id);
      if (filePath) fs.unlinkSync(filePath);
    } catch {
      // ignore
    }
    this.persist();
  }

  private load(): void {
    try {
      if (!fs.existsSync(this.indexPath)) return;
      const raw = fs.readFileSync(this.indexPath, "utf8");
      const parsed = JSON.parse(raw) as IndexFile;
      if (!parsed?.items || !Array.isArray(parsed.items)) return;
      for (const item of parsed.items) {
        if (item?.id && typeof item.id === "string") {
          this.items.set(item.id, item);
        }
      }
    } catch {
      this.items = new Map();
    }
  }

  private persist(): void {
    const payload: IndexFile = { items: [...this.items.values()] };
    fs.writeFileSync(this.indexPath, JSON.stringify(payload, null, 2), "utf8");
  }
}
