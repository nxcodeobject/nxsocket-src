import { randomUUID } from "node:crypto";
import type { WebSocket } from "ws";
import type { ServerMessage } from "../../shared/types.js";
import {
  AiKeyPool,
  isAiKeyExhausted,
  loadAiProviderConfig,
  parseProviderErrorStatus,
  type AiProviderConfig,
} from "../../shared/ai-provider-config.js";
import type { ConnectionManager, ConnectionState } from "../core/connection.js";

type ActiveStream = {
  socket: WebSocket;
  cancelled: boolean;
  timer?: NodeJS.Timeout;
  abort?: AbortController;
};

export type AiModuleOptions = {
  /** OpenAI-compatible base URL, e.g. https://api.openai.com/v1 */
  apiUrl?: string;
  apiKey?: string;
  model?: string;
};

/**
 * AI streaming: provider OpenAI-compatible + rotasi key ala nxcode
 * (settings.json AUTO_MODELS.apiKeys). Tanpa key → demo word-split.
 */
export class AiModule {
  private readonly streams = new Map<string, ActiveStream>();
  private readonly pool = new AiKeyPool();
  private config: AiProviderConfig | null = null;

  constructor(
    private readonly connections: ConnectionManager,
    private readonly options: AiModuleOptions = {},
  ) {
    this.refreshConfig({ resetExhausted: true });
  }

  /** Muat ulang config (env / %APPDATA%/nxcode/settings.json). */
  refreshConfig(opts?: { resetExhausted?: boolean }): AiProviderConfig | null {
    // options.apiKey (ctor) tetap override env/nxcode
    if (this.options.apiKey?.trim()) {
      this.config = {
        source: "env",
        entryId: "option",
        label: "option",
        baseUrl: (
          this.options.apiUrl ||
          process.env.NXSOCKET_AI_URL ||
          "https://api.openai.com/v1"
        ).replace(/\/+$/, ""),
        model: this.options.model || process.env.NXSOCKET_AI_MODEL || "openrouter/free",
        apiKeys: this.options.apiKey
          .split(/[,\n]/)
          .map((s) => s.trim())
          .filter(Boolean),
      };
    } else {
      this.config = loadAiProviderConfig();
      if (this.options.apiUrl) {
        this.config = this.config
          ? { ...this.config, baseUrl: this.options.apiUrl.replace(/\/+$/, "") }
          : null;
      }
      if (this.options.model && this.config) {
        this.config = { ...this.config, model: this.options.model };
      }
    }

    if (this.config) {
      const mtime = (this.config as AiProviderConfig & { mtimeMs?: number }).mtimeMs;
      const fileChanged = typeof mtime === "number" ? this.pool.noteSettingsMtime(mtime) : false;
      this.pool.load(this.config.entryId, this.config.apiKeys);
      if (opts?.resetExhausted || fileChanged) {
        this.pool.resetExhausted();
        if (fileChanged) {
          console.log("[ai] settings.json berubah — refresh key pool");
        }
      }
    } else {
      this.pool.load("none", []);
    }
    return this.config;
  }

  start(state: ConnectionState, prompt: string, streamId?: string): string {
    const text = prompt.trim();
    if (!text) throw new Error("prompt AI kosong");

    const id = streamId?.trim() || randomUUID();
    this.cancel(id);

    // Refresh ringan: jika settings.json berubah, ambil key baru
    this.refreshConfig({ resetExhausted: false });

    if (this.config && this.config.apiKeys.length > 0) {
      void this.streamFromProvider(state, id, text);
    } else {
      this.streamDemo(state, id, text);
    }
    return id;
  }

  /** Status AI untuk UI (demo4). */
  statusPayload(): ServerMessage {
    this.refreshConfig({ resetExhausted: false });
    if (this.config && this.config.apiKeys.length > 0) {
      return {
        type: "ai.status",
        mode: "provider",
        url: this.config.baseUrl,
        model: this.config.model,
        keys: this.config.apiKeys.length,
      };
    }
    return { type: "ai.status", mode: "demo" };
  }

  describeBanner(): string {
    this.refreshConfig({ resetExhausted: false });
    if (!this.config || !this.config.apiKeys.length) {
      return "AI       : demo fallback (set key di .env atau %APPDATA%/nxcode/settings.json)";
    }
    const src =
      this.config.source === "nxcode"
        ? "nxcode settings.json"
        : this.config.source;
    return `AI       : provider ON (${this.config.baseUrl} / ${this.config.model} / ${this.config.apiKeys.length} key via ${src})`;
  }

  private streamDemo(state: ConnectionState, id: string, text: string): void {
    const words = text.split(/\s+/);
    const active: ActiveStream = { socket: state.socket, cancelled: false };
    this.streams.set(id, active);

    let index = 0;
    const tick = () => {
      const current = this.streams.get(id);
      if (!current || current.cancelled) {
        this.finish(state, id, "cancelled");
        return;
      }
      if (index >= words.length) {
        this.finish(state, id, "completed");
        return;
      }
      const chunk = words[index] + (index < words.length - 1 ? " " : "");
      this.connections.send(state.socket, {
        type: "ai.chunk",
        streamId: id,
        index,
        text: chunk,
      } satisfies ServerMessage);
      index += 1;
      current.timer = setTimeout(tick, 40);
    };
    active.timer = setTimeout(tick, 20);
  }

  private async streamFromProvider(
    state: ConnectionState,
    id: string,
    prompt: string,
  ): Promise<void> {
    const abort = new AbortController();
    const active: ActiveStream = { socket: state.socket, cancelled: false, abort };
    this.streams.set(id, active);

    let lastError = "AI stream gagal";
    let sawRateLimit = false;
    let sawAuthFail = false;

    // Satu putaran + optional refresh settings jika semua exhausted (cara nxcode reload)
    for (let round = 0; round < 2; round++) {
      if (round === 1) {
        console.warn("[ai] semua key exhausted — refresh settings.json & coba lagi");
        this.refreshConfig({ resetExhausted: true });
      }

      const cfg = this.config;
      if (!cfg?.apiKeys.length) break;

      const order = this.pool.attemptOrder();
      if (!order.length) continue;

      for (const slot of order) {
        try {
          await this.consumeProviderStream(
            state,
            id,
            prompt,
            cfg.baseUrl,
            slot.key,
            cfg.model,
            active,
          );
          this.pool.markSuccess(slot.index);
          console.log(`[ai] ok model=${cfg.model} key#${slot.slot}`);
          return;
        } catch (err) {
          if (active.cancelled) {
            this.finish(state, id, "cancelled");
            return;
          }
          const msg = err instanceof Error ? err.message : "AI stream gagal";
          lastError = msg;
          const status = parseProviderErrorStatus(msg);
          console.warn(`[ai] model=${cfg.model} key#${slot.slot} gagal: ${msg.slice(0, 140)}`);

          if (/429|rate limit|free-models-per-day|quota/i.test(msg)) sawRateLimit = true;
          if (/401|403|User not found|invalid.*key/i.test(msg)) sawAuthFail = true;

          if (isAiKeyExhausted(status, msg)) {
            this.pool.markExhausted(slot.index);
            console.warn(`[ai] key#${slot.slot} marked exhausted → coba token berikutnya`);
            continue;
          }
          // Error non-rotatable
          break;
        }
      }
    }

    this.streams.delete(id);
    const tip = sawRateLimit
      ? "Semua token OpenRouter kuota/limit (429). Tambah key di nxcode settings.json atau tunggu reset. Fallback demo lokal.\n\n"
      : sawAuthFail
        ? "API key ditolak (401). Perbarui apiKeys di %APPDATA%/nxcode/settings.json. Fallback demo lokal.\n\n"
        : `Provider gagal (${lastError.slice(0, 80)}). Fallback demo lokal.\n\n`;
    this.streamDemo(state, id, tip + "Echo: " + prompt);
  }

  private async consumeProviderStream(
    state: ConnectionState,
    id: string,
    prompt: string,
    apiUrl: string,
    apiKey: string,
    model: string,
    active: ActiveStream,
  ): Promise<void> {
    const headers: Record<string, string> = {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    };
    if (/openrouter\.ai/i.test(apiUrl)) {
      headers["HTTP-Referer"] =
        process.env.NXSOCKET_AI_REFERER || "https://nxsocket.local";
      headers["X-Title"] = process.env.NXSOCKET_AI_TITLE || "NxSocket Demo4";
    }

    const res = await fetch(`${apiUrl.replace(/\/+$/, "")}/chat/completions`, {
      method: "POST",
      headers,
      body: JSON.stringify({
        model,
        stream: true,
        messages: [{ role: "user", content: prompt }],
      }),
      signal: active.abort?.signal,
    });

    if (!res.ok || !res.body) {
      const errText = await res.text().catch(() => res.statusText);
      throw new Error(`AI provider error ${res.status}: ${errText.slice(0, 200)}`);
    }

    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    let buffer = "";
    let index = 0;

    while (true) {
      if (active.cancelled) {
        this.finish(state, id, "cancelled");
        return;
      }
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split("\n");
      buffer = lines.pop() ?? "";

      for (const line of lines) {
        const trimmed = line.trim();
        if (!trimmed.startsWith("data:")) continue;
        const data = trimmed.slice(5).trim();
        if (data === "[DONE]") {
          this.finish(state, id, "completed");
          return;
        }
        try {
          const json = JSON.parse(data) as {
            choices?: Array<{ delta?: { content?: string } }>;
          };
          const piece = json.choices?.[0]?.delta?.content;
          if (piece) {
            this.connections.send(state.socket, {
              type: "ai.chunk",
              streamId: id,
              index,
              text: piece,
            } satisfies ServerMessage);
            index += 1;
          }
        } catch {
          /* ignore partial json */
        }
      }
    }
    this.finish(state, id, "completed");
  }

  private finish(
    state: ConnectionState,
    id: string,
    reason: "completed" | "cancelled",
  ): void {
    this.connections.send(state.socket, {
      type: "ai.done",
      streamId: id,
      reason,
    } satisfies ServerMessage);
    this.streams.delete(id);
  }

  cancel(streamId: string): void {
    const active = this.streams.get(streamId);
    if (!active) return;
    active.cancelled = true;
    if (active.timer) clearTimeout(active.timer);
    active.abort?.abort();
  }

  clearSocket(socket: WebSocket): void {
    for (const [id, active] of this.streams) {
      if (active.socket === socket) {
        active.cancelled = true;
        if (active.timer) clearTimeout(active.timer);
        active.abort?.abort();
        this.streams.delete(id);
      }
    }
  }
}
