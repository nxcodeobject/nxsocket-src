import { spawn, type ChildProcess } from "node:child_process";
import { randomUUID } from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import type { WebSocket } from "ws";
import type { ServerMessage } from "../../shared/types.js";
import type { ConnectionManager, ConnectionState } from "../core/connection.js";

/** Allowlist perintah aman (tanpa shell metachar agresif). */
const ALLOWED = new Set([
  "echo",
  "dir",
  "ls",
  "hostname",
  "whoami",
  "date",
  "pwd",
  "ver",
]);

const AGENT_TIMEOUT_MS = 5 * 60 * 1000;
const INFO_TIMEOUT_MS = 15_000;
const MAX_PROMPT = 8000;

type ActiveExec = {
  socket: WebSocket;
  child: ChildProcess;
  timer?: NodeJS.Timeout;
};

export type AgentTool = "info" | "claude" | "cursor";

/**
 * Remote exec + Remote AI Control.
 * - terminal.exec: allowlist singkat
 * - agent.run: spawn claude/cursor-agent -p di cwd terbatas (bukan shell bebas)
 */
export class TerminalModule {
  private readonly running = new Map<string, ActiveExec>();

  constructor(private readonly connections: ConnectionManager) {}

  statusPayload(): ServerMessage {
    const tools = resolveAgentTools();
    return {
      type: "agent.status",
      cwd: defaultCwd(),
      roots: workspaceRoots(),
      tools: {
        claude: Boolean(tools.claude),
        cursor: Boolean(tools.cursor),
        claudePath: tools.claude,
        cursorPath: tools.cursor,
      },
    };
  }

  exec(state: ConnectionState, command: string, execId?: string, cwd?: string): string {
    const raw = command.trim();
    if (!raw) throw new Error("command kosong");

    const parts = tokenize(raw);
    const bin = parts[0]?.toLowerCase();
    if (!bin || !ALLOWED.has(bin)) {
      throw new Error(
        `Perintah tidak diizinkan: ${bin ?? "(kosong)"}. Allowlist: ${[...ALLOWED].join(", ")}. Untuk AI pakai agent.run.`,
      );
    }

    if (/[;&|`$<>]/.test(raw)) {
      throw new Error("Karakter shell berbahaya tidak diizinkan");
    }

    const workDir = resolveWorkspaceCwd(cwd);
    const id = execId?.trim() || randomUUID();
    this.cancel(id);

    const isWin = process.platform === "win32";
    const winBuiltins = new Set(["echo", "dir", "ver", "date", "pwd"]);
    const child =
      isWin && winBuiltins.has(bin)
        ? spawn("cmd.exe", ["/d", "/s", "/c", bin === "pwd" ? "cd" : raw], {
            windowsHide: true,
            cwd: workDir,
          })
        : spawn(parts[0]!, parts.slice(1), {
            shell: false,
            windowsHide: true,
            cwd: workDir,
          });

    this.attach(state, id, raw, child, INFO_TIMEOUT_MS);
    return id;
  }

  runAgent(
    state: ConnectionState,
    tool: AgentTool,
    prompt?: string,
    cwd?: string,
    execId?: string,
  ): string {
    const workDir = resolveWorkspaceCwd(cwd);
    const id = execId?.trim() || randomUUID();
    this.cancel(id);

    if (tool === "info") {
      const label = `agent:info @ ${workDir}`;
      const isWin = process.platform === "win32";
      const child = isWin
        ? spawn(
            "cmd.exe",
            ["/d", "/s", "/c", "cd & echo. & dir /b"],
            { windowsHide: true, cwd: workDir },
          )
        : spawn("sh", ["-c", "pwd; ls -la"], {
            shell: false,
            cwd: workDir,
          });
      this.attach(state, id, label, child, INFO_TIMEOUT_MS);
      return id;
    }

    const text = String(prompt || "").trim();
    if (!text) throw new Error("prompt agen kosong");
    if (text.length > MAX_PROMPT) {
      throw new Error(`prompt terlalu panjang (max ${MAX_PROMPT})`);
    }

    const tools = resolveAgentTools();
    if (tool === "claude") {
      if (!tools.claude) {
        throw new Error(
          "Claude CLI tidak ditemukan. Install claude atau set NXSOCKET_CLAUDE_PATH.",
        );
      }
      const child = spawn(tools.claude, ["-p", text, "--output-format", "text"], {
        shell: false,
        windowsHide: true,
        cwd: workDir,
        env: { ...process.env },
        stdio: ["ignore", "pipe", "pipe"],
      });
      this.attach(state, id, `claude -p @ ${workDir}`, child, AGENT_TIMEOUT_MS);
      return id;
    }

    if (tool === "cursor") {
      if (!tools.cursor) {
        throw new Error(
          "Cursor Agent CLI tidak ditemukan. Install agent atau set NXSOCKET_CURSOR_AGENT_PATH.",
        );
      }
      // .cmd di Windows: spawn via cmd /c dengan argv aman
      const child =
        process.platform === "win32" && /\.cmd$/i.test(tools.cursor)
          ? spawn(
              process.env.ComSpec || "cmd.exe",
              [
                "/d",
                "/s",
                "/c",
                `"${tools.cursor}" -p ${JSON.stringify(text)}`,
              ],
              {
                windowsHide: true,
                cwd: workDir,
                env: { ...process.env },
                stdio: ["ignore", "pipe", "pipe"],
              },
            )
          : spawn(tools.cursor, ["-p", text], {
              shell: false,
              windowsHide: true,
              cwd: workDir,
              env: { ...process.env },
              stdio: ["ignore", "pipe", "pipe"],
            });
      this.attach(state, id, `cursor-agent -p @ ${workDir}`, child, AGENT_TIMEOUT_MS);
      return id;
    }

    throw new Error(`tool agen tidak dikenal: ${tool}`);
  }

  cancel(execId: string): void {
    const active = this.running.get(execId);
    if (!active) return;
    if (active.timer) clearTimeout(active.timer);
    active.child.kill();
    this.running.delete(execId);
  }

  clearSocket(socket: WebSocket): void {
    for (const [id, active] of this.running) {
      if (active.socket === socket) {
        if (active.timer) clearTimeout(active.timer);
        active.child.kill();
        this.running.delete(id);
      }
    }
  }

  private attach(
    state: ConnectionState,
    id: string,
    label: string,
    child: ChildProcess,
    timeoutMs: number,
  ): void {
    const active: ActiveExec = { socket: state.socket, child };
    this.running.set(id, active);

    this.connections.send(state.socket, {
      type: "terminal.started",
      execId: id,
      command: label,
    } satisfies ServerMessage);

    child.stdout?.on("data", (buf: Buffer) => {
      this.connections.send(state.socket, {
        type: "terminal.output",
        execId: id,
        stream: "stdout",
        chunk: buf.toString("utf8"),
      } satisfies ServerMessage);
    });

    child.stderr?.on("data", (buf: Buffer) => {
      this.connections.send(state.socket, {
        type: "terminal.output",
        execId: id,
        stream: "stderr",
        chunk: buf.toString("utf8"),
      } satisfies ServerMessage);
    });

    const finish = (code: number | null) => {
      if (active.timer) clearTimeout(active.timer);
      this.connections.send(state.socket, {
        type: "terminal.exit",
        execId: id,
        code,
      } satisfies ServerMessage);
      this.running.delete(id);
    };

    child.on("close", (code) => finish(code));
    child.on("error", (err) => {
      this.connections.send(state.socket, {
        type: "terminal.output",
        execId: id,
        stream: "stderr",
        chunk: err.message,
      } satisfies ServerMessage);
      finish(1);
    });

    active.timer = setTimeout(() => {
      if (this.running.has(id)) {
        this.connections.send(state.socket, {
          type: "terminal.output",
          execId: id,
          stream: "stderr",
          chunk: `\n[timeout ${timeoutMs}ms — dihentikan]\n`,
        } satisfies ServerMessage);
        this.cancel(id);
        this.connections.send(state.socket, {
          type: "terminal.exit",
          execId: id,
          code: 124,
        } satisfies ServerMessage);
      }
    }, timeoutMs);
    active.timer.unref?.();
  }
}

function tokenize(input: string): string[] {
  const out: string[] = [];
  const re = /"([^"]*)"|'([^']*)'|(\S+)/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(input))) {
    out.push(m[1] ?? m[2] ?? m[3] ?? "");
  }
  return out;
}

function workspaceRoots(): string[] {
  const raw =
    process.env.NXSOCKET_WORKSPACE_ROOTS ||
    process.env.NXSOCKET_WORKSPACE_ROOT ||
    "";
  const fromEnv = raw
    .split(/[,\n]/)
    .map((s) => s.trim())
    .filter(Boolean)
    .map((s) => path.resolve(s));
  const defaults = [
    path.resolve(process.cwd()),
    path.resolve("D:\\Framework"),
    path.resolve(os.homedir(), "Projects"),
    path.resolve(os.homedir(), "Developer"),
  ];
  const all = [...fromEnv, ...defaults];
  const uniq: string[] = [];
  for (const r of all) {
    if (!uniq.some((u) => u.toLowerCase() === r.toLowerCase())) uniq.push(r);
  }
  return uniq.filter((r) => {
    try {
      return fs.existsSync(r);
    } catch {
      return false;
    }
  });
}

function defaultCwd(): string {
  const pref = process.env.NXSOCKET_DEFAULT_CWD?.trim();
  if (pref) {
    try {
      return resolveWorkspaceCwd(pref);
    } catch {
      /* fall through */
    }
  }
  return path.resolve(process.cwd());
}

/** Pastikan cwd ada dan berada di dalam salah satu root yang diizinkan. */
export function resolveWorkspaceCwd(cwd?: string): string {
  const roots = workspaceRoots();
  const target = path.resolve(cwd?.trim() || defaultCwd());
  if (!fs.existsSync(target) || !fs.statSync(target).isDirectory()) {
    throw new Error(`Folder kerja tidak ada: ${target}`);
  }
  const real = fs.realpathSync.native?.(target) ?? fs.realpathSync(target);
  const ok = roots.some((root) => {
    try {
      const rr = fs.realpathSync.native?.(root) ?? fs.realpathSync(root);
      const rel = path.relative(rr, real);
      return rel === "" || (!rel.startsWith("..") && !path.isAbsolute(rel));
    } catch {
      return false;
    }
  });
  if (!ok) {
    throw new Error(
      `cwd di luar root yang diizinkan. Set NXSOCKET_WORKSPACE_ROOTS. cwd=${real}`,
    );
  }
  return real;
}

function resolveAgentTools(): { claude?: string; cursor?: string } {
  const claude =
    firstExistingFile([
      process.env.NXSOCKET_CLAUDE_PATH,
      path.join(os.homedir(), ".local", "bin", "claude.exe"),
      path.join(os.homedir(), ".local", "bin", "claude"),
    ]) || undefined;
  const cursor =
    firstExistingFile([
      process.env.NXSOCKET_CURSOR_AGENT_PATH,
      path.join(os.homedir(), "AppData", "Local", "cursor-agent", "agent.cmd"),
      path.join(os.homedir(), "AppData", "Local", "cursor-agent", "cursor-agent.cmd"),
    ]) || undefined;
  return { claude, cursor };
}

function firstExistingFile(candidates: Array<string | undefined>): string | null {
  for (const c of candidates) {
    const s = c?.trim();
    if (!s) continue;
    try {
      if (fs.existsSync(s) && fs.statSync(s).isFile()) return s;
    } catch {
      /* skip */
    }
  }
  return null;
}
