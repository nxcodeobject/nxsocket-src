import fs from "node:fs";
import os from "node:os";
import path from "node:path";

export type AiProviderConfig = {
  source: "env" | "nxcode";
  entryId: string;
  label: string;
  baseUrl: string;
  model: string;
  apiKeys: string[];
  settingsPath?: string;
};

type KeySlot = { index: number; key: string; slot: string };

/**
 * Pool key ala nxcode/modelai:
 * - sticky activeIndex (lanjut dari key yang terakhir sukses)
 * - exhausted set (401/402/429) → skip, coba token berikutnya
 * - refresh: reload settings.json + clear exhausted
 */
export class AiKeyPool {
  private activeIndex = 0;
  private readonly exhausted = new Set<number>();
  private keys: string[] = [];
  private entryId = "default";
  private lastSettingsMtime = 0;

  load(entryId: string, keys: string[]): void {
    this.entryId = entryId || "default";
    this.keys = keys.map((k) => k.trim()).filter(Boolean);
    if (this.activeIndex >= this.keys.length) this.activeIndex = 0;
  }

  get keyCount(): number {
    return this.keys.length;
  }

  get activeSlot(): number {
    return this.activeIndex + 1;
  }

  attemptOrder(): KeySlot[] {
    const list = this.keys;
    if (!list.length) return [];
    const start = Math.max(0, Math.min(this.activeIndex, list.length - 1));
    const ordered: KeySlot[] = [];
    for (let i = 0; i < list.length; i++) {
      const index = (start + i) % list.length;
      ordered.push({
        index,
        key: list[index]!,
        slot: String(index + 1),
      });
    }
    return ordered.filter((k) => !this.exhausted.has(k.index));
  }

  markSuccess(index: number): void {
    if (!Number.isFinite(index) || index < 0) return;
    this.activeIndex = index;
    this.exhausted.delete(index);
  }

  markExhausted(index: number): void {
    if (!Number.isFinite(index) || index < 0) return;
    this.exhausted.add(index);
  }

  resetExhausted(): void {
    this.exhausted.clear();
    this.activeIndex = 0;
  }

  /** true jika settings.json berubah di disk sejak load terakhir */
  noteSettingsMtime(mtimeMs: number): boolean {
    const changed = this.lastSettingsMtime > 0 && mtimeMs > this.lastSettingsMtime;
    this.lastSettingsMtime = mtimeMs;
    return changed;
  }
}

export function nxcodeSettingsPath(): string {
  if (process.env.NXSOCKET_NXCODE_SETTINGS?.trim()) {
    return path.resolve(process.env.NXSOCKET_NXCODE_SETTINGS.trim());
  }
  const base =
    process.env.APPDATA || path.join(os.homedir(), "AppData", "Roaming");
  return path.join(base, "nxcode", "settings.json");
}

function splitKeys(raw: string): string[] {
  return raw
    .split(/[,\n]/)
    .map((s) => s.trim())
    .filter(Boolean);
}

function loadFromNxcode(): (AiProviderConfig & { mtimeMs: number }) | null {
  const settingsPath = nxcodeSettingsPath();
  if (!fs.existsSync(settingsPath)) return null;
  try {
    const st = fs.statSync(settingsPath);
    const parsed = JSON.parse(fs.readFileSync(settingsPath, "utf8")) as {
      AUTO_MODELS?: Array<{
        id?: string;
        label?: string;
        model?: string;
        baseUrl?: string;
        apiKeys?: string[];
        default?: boolean;
      }>;
    };
    const list = Array.isArray(parsed.AUTO_MODELS) ? parsed.AUTO_MODELS : [];
    if (!list.length) return null;
    const entry =
      list.find((e) => e.default) ||
      list.find((e) => String(e.id || "").toLowerCase() === "free") ||
      list[0];
    if (!entry) return null;
    const apiKeys = Array.isArray(entry.apiKeys)
      ? entry.apiKeys.map((k) => String(k || "").trim()).filter(Boolean)
      : [];
    if (!apiKeys.length) return null;
    return {
      source: "nxcode",
      entryId: String(entry.id || "free"),
      label: String(entry.label || entry.id || "Free Tier"),
      baseUrl: String(entry.baseUrl || "https://openrouter.ai/api/v1").replace(
        /\/+$/,
        "",
      ),
      model: String(entry.model || "openrouter/free").trim() || "openrouter/free",
      apiKeys,
      settingsPath,
      mtimeMs: st.mtimeMs,
    };
  } catch (err) {
    console.warn(
      "[ai] gagal baca nxcode settings.json:",
      err instanceof Error ? err.message : err,
    );
    return null;
  }
}

/**
 * Prioritas:
 * 1. NXSOCKET_AI_API_KEYS (multi) / NXSOCKET_AI_API_KEY (single) dari env/.env
 * 2. %APPDATA%/nxcode/settings.json → AUTO_MODELS (sama seperti nxcode)
 */
export function loadAiProviderConfig(): (AiProviderConfig & { mtimeMs?: number }) | null {
  const envMulti = process.env.NXSOCKET_AI_API_KEYS?.trim();
  const envSingle =
    process.env.NXSOCKET_AI_API_KEY?.trim() ||
    process.env.OPENAI_API_KEY?.trim();
  const nx = loadFromNxcode();

  const envKeys = envMulti
    ? splitKeys(envMulti)
    : envSingle
      ? [envSingle]
      : [];

  if (envKeys.length > 0) {
    return {
      source: "env",
      entryId: "env",
      label: "env",
      baseUrl: (
        process.env.NXSOCKET_AI_URL ||
        nx?.baseUrl ||
        "https://api.openai.com/v1"
      ).replace(/\/+$/, ""),
      model:
        process.env.NXSOCKET_AI_MODEL?.trim() ||
        process.env.NXSOCKET_AI_MODELS?.split(",")[0]?.trim() ||
        nx?.model ||
        "openrouter/free",
      apiKeys: envKeys,
      settingsPath: nx?.settingsPath,
      mtimeMs: nx?.mtimeMs,
    };
  }

  if (nx) {
    return {
      ...nx,
      baseUrl: (process.env.NXSOCKET_AI_URL || nx.baseUrl).replace(/\/+$/, ""),
      model:
        process.env.NXSOCKET_AI_MODEL?.trim() ||
        process.env.NXSOCKET_AI_MODELS?.split(",")[0]?.trim() ||
        nx.model,
    };
  }

  return null;
}

/** 401 / 402 / 429 (dan 403 quota) → ganti token berikutnya, seperti nxcode isAutoKeyExhausted */
export function isAiKeyExhausted(status: number, bodyText: string): boolean {
  const code = Number(status) || 0;
  if (code === 429 || code === 402 || code === 401) return true;
  const t = String(bodyText || "").toLowerCase();
  if (
    code === 403 &&
    /quota|rate.?limit|insufficient|credit|billing|exhausted|usage|user not found/i.test(
      t,
    )
  ) {
    return true;
  }
  return (
    /rate.?limit|insufficient.?credits|quota.?exceeded|key.?limit|user not found|free-models-per-day/i.test(
      t,
    ) &&
    (code === 400 || code >= 402)
  );
}

export function parseProviderErrorStatus(message: string): number {
  const m = message.match(/AI provider error\s+(\d{3})/i);
  return m ? Number(m[1]) : 0;
}
