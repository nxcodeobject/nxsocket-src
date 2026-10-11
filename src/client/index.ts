import WebSocket from "ws";
import { EventEmitter } from "node:events";
import type { ClientMessage, JobStatus, ServerMessage } from "../shared/types.js";

export type NxSocketClientOptions = {
  /** Base gateway URL, e.g. http://127.0.0.1:7080/v1 */
  url: string;
  /** Gateway token */
  token: string;
  /** Auto reconnect */
  reconnect?: boolean;
  reconnectDelayMs?: number;
};

export class NxSocketClient extends EventEmitter {
  private socket: WebSocket | null = null;
  private intentionalClose = false;
  private sessionId: string | null = null;
  /** Session sebelum disconnect — dipakai auto-resume setelah reconnect */
  private resumeSessionId: string | null = null;
  private reconnectTimer: NodeJS.Timeout | null = null;

  constructor(private readonly options: NxSocketClientOptions) {
    super();
  }

  getSessionId(): string | null {
    return this.sessionId;
  }

  connect(): void {
    this.intentionalClose = false;
    const wsUrl = toWsUrl(this.options.url);
    this.socket = new WebSocket(wsUrl, {
      headers: {
        Authorization: `Bearer ${this.options.token}`,
      },
    });

    this.socket.on("open", () => {
      this.emit("open");
    });

    this.socket.on("message", (raw) => {
      let msg: ServerMessage;
      try {
        msg = JSON.parse(raw.toString()) as ServerMessage;
      } catch {
        this.emit("error", new Error("Invalid JSON from server"));
        return;
      }

      this.emit("message", msg);
      switch (msg.type) {
        case "welcome":
          this.sessionId = msg.sessionId;
          if (this.resumeSessionId && this.resumeSessionId !== msg.sessionId) {
            this.send({ type: "resume", sessionId: this.resumeSessionId });
          } else {
            this.resumeSessionId = msg.sessionId;
          }
          this.emit("welcome", msg.sessionId);
          break;
        case "resumed":
          this.sessionId = msg.sessionId;
          this.resumeSessionId = msg.sessionId;
          this.emit("resumed", msg);
          break;
        case "pong":
          this.emit("pong", msg.ts);
          break;
        case "identified":
          this.emit("identified", msg.name);
          break;
        case "joined":
          this.emit("joined", msg.room);
          break;
        case "left":
          this.emit("left", msg.room);
          break;
        case "event":
          this.emit("event", msg);
          break;
        case "presence.update":
          this.emit("presence.update", msg);
          break;
        case "presence.snapshot":
          this.emit("presence.snapshot", msg);
          break;
        case "chat.message":
          this.emit("chat.message", msg);
          break;
        case "chat.history":
          this.emit("chat.history", msg);
          break;
        case "chat.typing":
          this.emit("chat.typing", msg);
          break;
        case "ice.config":
          this.emit("ice.config", msg);
          break;
        case "notification":
          this.emit("notification", msg);
          break;
        case "monitoring.stats":
          this.emit("monitoring.stats", msg);
          break;
        case "tracking.update":
          this.emit("tracking.update", msg);
          break;
        case "tracking.snapshot":
          this.emit("tracking.snapshot", msg);
          break;
        case "ai.chunk":
          this.emit("ai.chunk", msg);
          break;
        case "ai.done":
          this.emit("ai.done", msg);
          break;
        case "ai.status":
          this.emit("ai.status", msg);
          break;
        case "terminal.started":
          this.emit("terminal.started", msg);
          break;
        case "terminal.output":
          this.emit("terminal.output", msg);
          break;
        case "terminal.exit":
          this.emit("terminal.exit", msg);
          break;
        case "agent.status":
          this.emit("agent.status", msg);
          break;
        case "webrtc.signal":
          this.emit("webrtc.signal", msg);
          break;
        case "progress.snapshot":
          this.emit("progress.snapshot", msg);
          break;
        case "progress.update":
          this.emit("progress.update", msg);
          break;
        case "progress.done":
          this.emit("progress.done", msg);
          break;
        case "job.snapshot":
          this.emit("job.snapshot", msg);
          break;
        case "job.update":
          this.emit("job.update", msg);
          break;
        case "sync.snapshot":
          this.emit("sync.snapshot", msg);
          break;
        case "sync.update":
          this.emit("sync.update", msg);
          break;
        case "sync.delete":
          this.emit("sync.delete", msg);
          break;
        case "error":
          this.emit("error", new Error(`${msg.code}: ${msg.message}`));
          break;
        default:
          break;
      }
    });

    this.socket.on("close", (code, reasonBuf) => {
      const reason = reasonBuf.toString();
      this.emit("close", code, reason);
      this.socket = null;
      if (!this.intentionalClose && this.options.reconnect !== false) {
        const delay = this.options.reconnectDelayMs ?? 1500;
        this.reconnectTimer = setTimeout(() => this.connect(), delay);
      }
    });

    this.socket.on("error", (err) => {
      this.emit("error", err);
    });
  }

  close(): void {
    this.intentionalClose = true;
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
    this.socket?.close();
    this.socket = null;
  }

  send(message: ClientMessage): void {
    if (!this.socket || this.socket.readyState !== WebSocket.OPEN) {
      throw new Error("Socket belum terhubung");
    }
    this.socket.send(JSON.stringify(message));
  }

  ping(ts = Date.now()): void {
    this.send({ type: "ping", ts });
  }

  identify(name: string): void {
    this.send({ type: "identify", name });
  }

  join(room: string): void {
    this.send({ type: "join", room });
  }

  leave(room: string): void {
    this.send({ type: "leave", room });
  }

  /** Resume session setelah reconnect (biasanya otomatis). */
  resume(sessionId?: string): void {
    const id = sessionId ?? this.resumeSessionId ?? this.sessionId;
    if (!id) throw new Error("Tidak ada sessionId untuk di-resume");
    this.send({ type: "resume", sessionId: id });
  }

  broadcast(room: string, event: string, data?: unknown): void {
    this.send({ type: "broadcast", room, event, data });
  }

  subscribePresence(scope: "global" | "room" = "global", room?: string): void {
    this.send({ type: "presence.subscribe", scope, room });
  }

  unsubscribePresence(scope: "global" | "room" = "global", room?: string): void {
    this.send({ type: "presence.unsubscribe", scope, room });
  }

  chat(room: string, text: string, to?: string): void {
    this.send({ type: "chat.send", room, text, to });
  }

  getChatHistory(room: string, limit?: number): void {
    this.send({ type: "chat.getHistory", room, limit });
  }

  typing(room: string, typing: boolean): void {
    this.send({ type: "chat.typing", room, typing });
  }

  notify(input: {
    title: string;
    body: string;
    data?: unknown;
    room?: string;
    to?: string;
  }): void {
    this.send({ type: "notification.send", ...input });
  }

  subscribeMonitoring(): void {
    this.send({ type: "monitoring.subscribe" });
  }

  unsubscribeMonitoring(): void {
    this.send({ type: "monitoring.unsubscribe" });
  }

  getMonitoring(): void {
    this.send({ type: "monitoring.get" });
  }

  subscribeTracking(target: string): void {
    this.send({ type: "tracking.subscribe", target });
  }

  unsubscribeTracking(target: string): void {
    this.send({ type: "tracking.unsubscribe", target });
  }

  updateTracking(target: string, lat: number, lng: number, meta?: unknown): void {
    this.send({ type: "tracking.update", target, lat, lng, meta });
  }

  startAi(prompt: string, streamId?: string): void {
    this.send({ type: "ai.start", prompt, streamId });
  }

  cancelAi(streamId: string): void {
    this.send({ type: "ai.cancel", streamId });
  }

  exec(command: string, execId?: string, cwd?: string): void {
    this.send({ type: "terminal.exec", command, execId, cwd });
  }

  cancelExec(execId: string): void {
    this.send({ type: "terminal.cancel", execId });
  }

  runAgent(
    tool: "info" | "claude" | "cursor",
    prompt?: string,
    cwd?: string,
    execId?: string,
  ): void {
    this.send({ type: "agent.run", tool, prompt, cwd, execId });
  }

  cancelAgent(execId: string): void {
    this.send({ type: "agent.cancel", execId });
  }

  webrtcSignal(
    room: string,
    signal: "offer" | "answer" | "ice",
    payload: unknown,
    to?: string,
  ): void {
    this.send({ type: "webrtc.signal", room, signal, payload, to });
  }

  subscribeProgress(id: string): void {
    this.send({ type: "progress.subscribe", id });
  }

  unsubscribeProgress(id: string): void {
    this.send({ type: "progress.unsubscribe", id });
  }

  updateProgress(
    id: string,
    percent: number,
    opts?: { loaded?: number; total?: number; meta?: unknown },
  ): void {
    this.send({ type: "progress.update", id, percent, ...opts });
  }

  doneProgress(id: string, ok = true, meta?: unknown): void {
    this.send({ type: "progress.done", id, ok, meta });
  }

  subscribeJob(jobId: string): void {
    this.send({ type: "job.subscribe", jobId });
  }

  unsubscribeJob(jobId: string): void {
    this.send({ type: "job.unsubscribe", jobId });
  }

  createJob(name: string, jobId?: string, data?: unknown): void {
    this.send({ type: "job.create", name, jobId, data });
  }

  setJob(
    jobId: string,
    patch: {
      status?: JobStatus;
      progress?: number;
      result?: unknown;
      error?: string;
      name?: string;
    },
  ): void {
    this.send({ type: "job.set", jobId, ...patch });
  }

  runJob(name: string, jobId?: string, steps?: number): void {
    this.send({ type: "job.run", name, jobId, steps });
  }

  subscribeSync(channel: string): void {
    this.send({ type: "sync.subscribe", channel });
  }

  unsubscribeSync(channel: string): void {
    this.send({ type: "sync.unsubscribe", channel });
  }

  setSync(channel: string, key: string, value: unknown): void {
    this.send({ type: "sync.set", channel, key, value });
  }

  deleteSync(channel: string, key: string): void {
    this.send({ type: "sync.delete", channel, key });
  }
}

function toWsUrl(input: string): string {
  const url = new URL(input);
  url.protocol = url.protocol === "https:" ? "wss:" : "ws:";
  const basePath = url.pathname.replace(/\/+$/, "");
  url.pathname = `${basePath}/ws`;
  url.search = "";
  url.hash = "";
  return url.toString();
}

export default NxSocketClient;
