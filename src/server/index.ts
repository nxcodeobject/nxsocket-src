import http from "node:http";
import https from "node:https";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { WebSocketServer, type WebSocket, type RawData } from "ws";
import { createAdapter } from "../adapters/index.js";
import type { DataAdapter } from "../adapters/types.js";
import { assertTokenUsable, hasScope } from "../shared/auth.js";
import { loadConfig } from "../shared/config.js";
import { printLanAccessTips } from "../shared/lan-tips.js";
import { formatGatewayEndpoints } from "../shared/net.js";
import { printNetworkUrlQr, printTokenQr } from "../shared/qr.js";
import { canJoinRoom } from "../shared/room-acl.js";
import { ensureTlsCerts } from "../shared/tls.js";
import { TokenStore } from "../shared/token-store.js";
import type {
  ClientMessage,
  GatewayTokenRecord,
  ServerConfig,
  ServerMessage,
  TokenScope,
} from "../shared/types.js";
import { ConnectionManager } from "./core/connection.js";
import { HeartbeatMonitor } from "./core/heartbeat.js";
import { RateLimiter } from "./core/rate-limit.js";
import { RoomManager } from "./core/room.js";
import { SessionResumeStore } from "./core/session-resume.js";
import { ChatModule } from "./modules/chat.js";
import { AiModule } from "./modules/ai.js";
import { JobModule } from "./modules/job.js";
import { MonitoringModule } from "./modules/monitoring.js";
import { NotificationModule } from "./modules/notification.js";
import { PresenceModule } from "./modules/presence.js";
import { ProgressModule } from "./modules/progress.js";
import { SyncModule } from "./modules/sync.js";
import { TerminalModule } from "./modules/terminal.js";
import { TrackingModule } from "./modules/tracking.js";
import { WebrtcModule } from "./modules/webrtc.js";
import { MeetingModule } from "./modules/meeting.js";
import { SfuLiveKitModule } from "./modules/sfu-livekit.js";
import { WebPushModule } from "./modules/web-push.js";
import { ProfileModule } from "./modules/profile.js";
import { FeedModule } from "./modules/feed.js";
import { GroupsModule } from "./modules/groups.js";
import { OtpModule } from "./modules/otp.js";
import { MediaModule } from "./modules/media.js";
import { FcmModule } from "./modules/fcm.js";
import { BlockModule } from "./modules/blocks.js";
import { iceStatusLabel, resolveIceServers } from "../shared/ice-servers.js";

function send(socket: WebSocket, message: ServerMessage): void {
  if (socket.readyState === socket.OPEN) {
    socket.send(JSON.stringify(message));
  }
}

async function readJsonBody(
  req: http.IncomingMessage,
  limit = 64_000,
): Promise<Record<string, unknown>> {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of req) {
    const buf = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk as string);
    size += buf.length;
    if (size > limit) throw new Error("Body terlalu besar");
    chunks.push(buf);
  }
  const raw = Buffer.concat(chunks).toString("utf8").trim();
  if (!raw) return {};
  const parsed = JSON.parse(raw) as unknown;
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new Error("Body harus JSON object");
  }
  return parsed as Record<string, unknown>;
}

async function readRawBody(
  req: http.IncomingMessage,
  limit: number,
): Promise<Buffer> {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of req) {
    const buf = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk as string);
    size += buf.length;
    if (size > limit) throw new Error("Body terlalu besar");
    chunks.push(buf);
  }
  return Buffer.concat(chunks);
}

const CORS_ALLOW_HEADERS =
  "content-type, authorization, x-nxsocket-token, x-nxsocket-media-name";

function sendJson(
  res: http.ServerResponse,
  status: number,
  body: unknown,
): void {
  res.writeHead(status, {
    "content-type": "application/json; charset=utf-8",
    "cache-control": "no-store",
    "access-control-allow-origin": "*",
    "access-control-allow-methods": "GET, POST, OPTIONS",
    "access-control-allow-headers": CORS_ALLOW_HEADERS,
  });
  res.end(JSON.stringify(body));
}

/** Preview singkat untuk notifikasi push. */
/**
 * Event envelope Remora ({"remora":1,"event":"..."}) yang murni sinyal
 * protokol/sinkronisasi -- BUKAN pesan untuk ditampilkan/dinotifikasi ke
 * user. "hello" (directory announce/presence, broadcast tiap device connect)
 * yang paling sering muncul di sini. Push FCM untuk event ini harus di-skip
 * sepenuhnya di pemanggil, bukan cuma disaring dari preview text.
 */
const SILENT_CHAT_EVENTS = new Set([
  "hello",
  "delete",
  "edit",
  "clear",
  "react",
  "e2ee",
  "ge2ee",
  "gkey",
  "room.mute",
  "pin",
  "poll.vote",
  "typing.ack",
]);

function parseRemoraEnvelope(
  text: string,
): { event?: string; kind?: string; text?: string } | null {
  const raw = String(text || "").trim();
  if (!raw.startsWith("{")) return null;
  try {
    const body = JSON.parse(raw) as {
      remora?: number;
      event?: string;
      kind?: string;
      text?: string;
    };
    if (body && body.remora === 1 && typeof body.event === "string") return body;
  } catch {
    // plain text
  }
  return null;
}

function isSilentChatEnvelope(text: string): boolean {
  const body = parseRemoraEnvelope(text);
  return !!body && SILENT_CHAT_EVENTS.has(body.event!);
}

function previewChatText(text: string): string {
  const raw = String(text || "").trim();
  if (!raw) return "Pesan baru";
  const body = parseRemoraEnvelope(raw);
  if (body) {
    if (body.event === "media") {
      if (body.kind === "image") return "Foto";
      if (body.kind === "video") return "Video";
      if (body.kind === "audio") return "Suara";
      return "Berkas";
    }
    if (body.event === "location") return "Lokasi";
    if (body.event === "contact") return "Kontak";
    if (body.event === "poll") return "Polling";
    if (body.event === "reply") return String(body.text || "Balasan").slice(0, 140);
    if (body.event === "delete") return "Pesan dihapus";
    // Envelope Remora yang dikenal formatnya tapi belum dipetakan modul ini
    // -- jangan tampilkan JSON mentah, fallback ke pesan generik.
    return "Pesan baru";
  }
  return raw.slice(0, 140);
}

/** Cek SDP offer: punya m=video → video call (demo3); selain itu audio (demo2). */
function detectOfferMode(payload: unknown): "audio" | "video" {
  let sdp = "";
  if (typeof payload === "string") sdp = payload;
  else if (payload && typeof payload === "object") {
    const p = payload as { sdp?: unknown };
    if (typeof p.sdp === "string") sdp = p.sdp;
    else if (p.sdp && typeof p.sdp === "object" && typeof (p.sdp as { sdp?: string }).sdp === "string") {
      sdp = (p.sdp as { sdp: string }).sdp;
    }
  }
  return /m=video/i.test(sdp) ? "video" : "audio";
}

function extractToken(req: http.IncomingMessage, url: URL): string | null {
  const header = req.headers["authorization"];
  if (typeof header === "string" && header.toLowerCase().startsWith("bearer ")) {
    return header.slice(7).trim() || null;
  }

  const xToken = req.headers["x-nxsocket-token"];
  if (typeof xToken === "string" && xToken.trim()) {
    return xToken.trim();
  }

  const queryToken = url.searchParams.get("token");
  return queryToken?.trim() || null;
}

export type StartServerOptions = Partial<ServerConfig> & {
  printBanner?: boolean;
};

export async function startServer(options: StartServerOptions = {}): Promise<{
  config: ServerConfig;
  close: () => Promise<void>;
}> {
  const { printBanner = true, ...overrides } = options;
  const config = loadConfig(overrides);
  const dataAdapter: DataAdapter = await createAdapter(config.adapter, {
    dataDir: config.dataDir,
    firebaseCredentials: config.firebaseCredentials,
    firebaseDatabaseURL: config.firebaseDatabaseURL,
  });
  const tokens = new TokenStore(dataAdapter);
  const defaultToken = await tokens.ensureDefault();
  const connections = new ConnectionManager();
  const rooms = new RoomManager(connections);
  const resumeStore = new SessionResumeStore();
  const presence = new PresenceModule(connections, rooms);
  const chat = new ChatModule(connections, rooms, dataAdapter);
  const notifications = new NotificationModule(connections, rooms);
  const monitoring = new MonitoringModule(connections, rooms);
  const tracking = new TrackingModule(connections);
  const progress = new ProgressModule(connections);
  const jobs = new JobModule(connections);
  const sync = new SyncModule(connections);
  const ai = new AiModule(connections);
  const terminal = new TerminalModule(connections);
  const webrtc = new WebrtcModule(connections, rooms);
  const meetings = new MeetingModule(connections, rooms);
  const sfu = new SfuLiveKitModule();
  const webPush = new WebPushModule(config.dataDir);
  const profiles = new ProfileModule(config.dataDir);
  const feed = new FeedModule(config.dataDir, connections, rooms);
  const groups = new GroupsModule(config.dataDir, connections, rooms);
  const otp = new OtpModule(config.dataDir);
  const media = new MediaModule(config.dataDir);
  const fcm = new FcmModule(config.dataDir);
  const blocks = new BlockModule(config.dataDir);
  await fcm.init();
  const rateLimiter = new RateLimiter(config.rateLimitMax, config.rateLimitWindowMs);
  const heartbeat = new HeartbeatMonitor(
    connections,
    config.heartbeatIntervalMs,
    config.heartbeatTimeoutMs,
  );

  const wsPath = `${config.pathPrefix}/ws`;
  const scheme = config.https ? "https" : "http";
  const tls = config.https ? await ensureTlsCerts(config.dataDir) : null;
  const demoPath = path.resolve(
    path.dirname(fileURLToPath(import.meta.url)),
    "../../public/demo.html",
  );
  const demo2Path = path.resolve(
    path.dirname(fileURLToPath(import.meta.url)),
    "../../public/demo2.html",
  );
  const demo3Path = path.resolve(
    path.dirname(fileURLToPath(import.meta.url)),
    "../../public/demo3.html",
  );
  const demo4Path = path.resolve(
    path.dirname(fileURLToPath(import.meta.url)),
    "../../public/demo4.html",
  );
  const demo5Path = path.resolve(
    path.dirname(fileURLToPath(import.meta.url)),
    "../../public/demo5.html",
  );
  const demo6Path = path.resolve(
    path.dirname(fileURLToPath(import.meta.url)),
    "../../public/demo6.html",
  );
  const demo7Path = path.resolve(
    path.dirname(fileURLToPath(import.meta.url)),
    "../../public/demo7.html",
  );
  const demo8Path = path.resolve(
    path.dirname(fileURLToPath(import.meta.url)),
    "../../public/demo8.html",
  );
  const demo9Path = path.resolve(
    path.dirname(fileURLToPath(import.meta.url)),
    "../../public/demo9.html",
  );
  const demo10Path = path.resolve(
    path.dirname(fileURLToPath(import.meta.url)),
    "../../public/demo10.html",
  );
  const demo11Path = path.resolve(
    path.dirname(fileURLToPath(import.meta.url)),
    "../../public/demo11.html",
  );
  const demo12Path = path.resolve(
    path.dirname(fileURLToPath(import.meta.url)),
    "../../public/demo12.html",
  );
  const qrPagePath = path.resolve(
    path.dirname(fileURLToPath(import.meta.url)),
    "../../public/qr.html",
  );
  const otpPagePath = path.resolve(
    path.dirname(fileURLToPath(import.meta.url)),
    "../../public/otp.html",
  );
  const publicDir = path.resolve(
    path.dirname(fileURLToPath(import.meta.url)),
    "../../public",
  );

  function serveHtml(filePath: string, res: http.ServerResponse): void {
    try {
      let html = fs.readFileSync(filePath, "utf8");
      // Cache-bust: setiap response unik supaya HP tidak pakai HTML lama
      const stamp = String(Date.now());
      html = html.replace(/__NX_BUILD__/g, stamp);
      html = html.replace(/Video Call v\d+/g, `Video Call v${stamp.slice(-6)}`);
      res.writeHead(200, {
        "content-type": "text/html; charset=utf-8",
        "cache-control": "no-store, no-cache, must-revalidate, max-age=0",
        pragma: "no-cache",
        expires: "0",
      });
      res.end(html);
    } catch {
      res.writeHead(404, { "content-type": "application/json" });
      res.end(JSON.stringify({ error: "Demo page not found", path: filePath }));
    }
  }

  function contentTypeFor(file: string): string {
    if (file.endsWith(".js")) return "application/javascript; charset=utf-8";
    if (file.endsWith(".webmanifest") || file.endsWith(".json")) {
      return "application/manifest+json; charset=utf-8";
    }
    if (file.endsWith(".svg")) return "image/svg+xml; charset=utf-8";
    if (file.endsWith(".png")) return "image/png";
    if (file.endsWith(".css")) return "text/css; charset=utf-8";
    return "application/octet-stream";
  }

  function servePublicFile(relPath: string, res: http.ServerResponse): boolean {
    const safe = path.normalize(relPath).replace(/^(\.\.(\/|\\|$))+/, "");
    const full = path.resolve(publicDir, safe);
    if (!full.startsWith(publicDir) || !fs.existsSync(full) || !fs.statSync(full).isFile()) {
      return false;
    }
    const body = fs.readFileSync(full);
    res.writeHead(200, {
      "content-type": contentTypeFor(full),
      "cache-control": "no-cache",
    });
    res.end(body);
    return true;
  }

  const requestListener: http.RequestListener = (req, res) => {
    const url = new URL(req.url ?? "/", `http://${req.headers.host ?? "localhost"}`);

    // CORS preflight (Remora / browser)
    if (req.method === "OPTIONS") {
      res.writeHead(204, {
        "access-control-allow-origin": "*",
        "access-control-allow-methods": "GET, POST, OPTIONS",
        "access-control-allow-headers": CORS_ALLOW_HEADERS,
        "access-control-max-age": "86400",
      });
      res.end();
      return;
    }

    // Static PWA / icons di bawah pathPrefix
    const prefix = config.pathPrefix.replace(/\/+$/, "") || "";
    if (url.pathname === `${prefix}/manifest.webmanifest`) {
      if (servePublicFile("manifest.webmanifest", res)) return;
    }
    if (url.pathname === `${prefix}/sw.js`) {
      if (servePublicFile("sw.js", res)) return;
    }
    if (url.pathname.startsWith(`${prefix}/icons/`)) {
      const rel = url.pathname.slice(`${prefix}/`.length);
      if (servePublicFile(rel, res)) return;
    }

    // Media upload / serve — Remora chat lampiran (pointer, bukan base64 di WS)
    const mediaRoot = `${config.pathPrefix}/media`;
    if (url.pathname === mediaRoot || url.pathname === `${mediaRoot}/`) {
      if (req.method !== "POST") {
        sendJson(res, 405, { ok: false, error: "Gunakan POST untuk upload" });
        return;
      }
      void (async () => {
        try {
          await tokens.reload();
          const tokenValue = extractToken(req, url);
          if (!tokenValue) {
            sendJson(res, 401, { ok: false, error: "Token wajib" });
            return;
          }
          const record = tokens.findByToken(tokenValue);
          if (!record) {
            sendJson(res, 401, { ok: false, error: "Token tidak valid" });
            return;
          }
          assertTokenUsable(record);
          if (!hasScope(record, "chat")) {
            sendJson(res, 403, { ok: false, error: "Scope chat diperlukan" });
            return;
          }

          const contentType = String(req.headers["content-type"] || "")
            .split(";")[0]
            .trim()
            .toLowerCase();
          const nameHeader = req.headers["x-nxsocket-media-name"];
          let name =
            typeof nameHeader === "string"
              ? decodeURIComponent(nameHeader.trim())
              : "berkas";
          let mime = contentType || "application/octet-stream";
          let buffer: Buffer;

          if (contentType === "application/json") {
            const body = await readJsonBody(req, media.maxBytes + 64_000);
            const data = String(body.data ?? "");
            mime =
              String(body.mime ?? mime).trim() || "application/octet-stream";
            name = String(body.name ?? name).trim() || "berkas";
            const b64 = data.replace(/^data:[^;]+;base64,/, "");
            if (!b64) {
              sendJson(res, 400, { ok: false, error: "Field data (base64) wajib" });
              return;
            }
            buffer = Buffer.from(b64, "base64");
          } else {
            buffer = await readRawBody(req, media.maxBytes + 1024);
          }

          const saved = await media.save(buffer, {
            mime,
            name,
            tokenId: record.id,
          });
          const rel = media.publicUrl(config.pathPrefix, saved.id);
          sendJson(res, 200, {
            ok: true,
            id: saved.id,
            url: rel,
            mime: saved.mime,
            name: saved.name,
            size: saved.size,
            expiresAt: saved.expiresAt,
            maxBytes: media.maxBytes,
            ttlMs: media.ttlMs,
          });
        } catch (err) {
          const message =
            err instanceof Error ? err.message : "Upload media gagal";
          const status = /terlalu besar|melebihi|kosong/i.test(message)
            ? 413
            : 400;
          sendJson(res, status, { ok: false, error: message });
        }
      })();
      return;
    }

    const mediaGetMatch = url.pathname.match(
      new RegExp(
        `^${config.pathPrefix.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}/media/([a-f0-9]+)/?$`,
        "i",
      ),
    );
    if (mediaGetMatch) {
      if (req.method !== "GET" && req.method !== "HEAD") {
        sendJson(res, 405, { ok: false, error: "Gunakan GET" });
        return;
      }
      const hit = media.resolve(mediaGetMatch[1]);
      if (!hit) {
        sendJson(res, 404, { ok: false, error: "Media tidak ditemukan" });
        return;
      }
      try {
        const body = fs.readFileSync(hit.filePath);
        const mime = hit.record.mime || "application/octet-stream";
        const total = body.length;
        const rangeHeader = req.headers.range;
        const common = {
          "content-type": mime,
          "accept-ranges": "bytes",
          "cache-control": "public, max-age=86400",
          "access-control-allow-origin": "*",
          "access-control-expose-headers": "content-range, accept-ranges, content-length",
          "content-disposition": `inline; filename="${hit.record.name.replace(/"/g, "")}"`,
        };

        if (typeof rangeHeader === "string" && rangeHeader.startsWith("bytes=")) {
          const m = /^bytes=(\d*)-(\d*)$/.exec(rangeHeader.trim());
          if (m) {
            let start = m[1] ? Number(m[1]) : 0;
            let end = m[2] ? Number(m[2]) : total - 1;
            if (!Number.isFinite(start)) start = 0;
            if (!Number.isFinite(end) || end >= total) end = total - 1;
            if (start > end || start >= total) {
              res.writeHead(416, {
                ...common,
                "content-range": `bytes */${total}`,
              });
              res.end();
              return;
            }
            const chunk = body.subarray(start, end + 1);
            res.writeHead(206, {
              ...common,
              "content-length": chunk.length,
              "content-range": `bytes ${start}-${end}/${total}`,
            });
            if (req.method === "HEAD") {
              res.end();
            } else {
              res.end(chunk);
            }
            return;
          }
        }

        res.writeHead(200, {
          ...common,
          "content-length": total,
        });
        if (req.method === "HEAD") {
          res.end();
        } else {
          res.end(body);
        }
      } catch {
        sendJson(res, 404, { ok: false, error: "Berkas media hilang" });
      }
      return;
    }

    // OTP API — fondasi Remora register
    const otpRequestPath = `${config.pathPrefix}/otp/request`;
    const otpVerifyPath = `${config.pathPrefix}/otp/verify`;
    const otpStatusPath = `${config.pathPrefix}/otp/status`;
    if (
      url.pathname === otpRequestPath ||
      url.pathname === `${otpRequestPath}/`
    ) {
      if (req.method !== "POST") {
        sendJson(res, 405, { ok: false, error: "Gunakan POST" });
        return;
      }
      void (async () => {
        try {
          const body = await readJsonBody(req);
          const phone = String(body.phone ?? "");
          const out = await otp.request(phone);
          sendJson(res, 200, out);
        } catch (err) {
          const message = err instanceof Error ? err.message : "OTP request gagal";
          const cooldownSec =
            err && typeof err === "object" && "cooldownSec" in err
              ? Number((err as { cooldownSec: number }).cooldownSec)
              : undefined;
          sendJson(res, 400, { ok: false, error: message, cooldownSec });
        }
      })();
      return;
    }
    if (
      url.pathname === otpVerifyPath ||
      url.pathname === `${otpVerifyPath}/`
    ) {
      if (req.method !== "POST") {
        sendJson(res, 405, { ok: false, error: "Gunakan POST" });
        return;
      }
      void (async () => {
        try {
          const body = await readJsonBody(req);
          const phone = String(body.phone ?? "");
          const code = String(body.code ?? "");
          const out = otp.verify(phone, code);
          sendJson(res, 200, out);
        } catch (err) {
          const message = err instanceof Error ? err.message : "OTP verify gagal";
          sendJson(res, 400, { ok: false, error: message });
        }
      })();
      return;
    }
    if (
      url.pathname === otpStatusPath ||
      url.pathname === `${otpStatusPath}/`
    ) {
      const phone = url.searchParams.get("phone") || "";
      sendJson(res, 200, otp.status(phone));
      return;
    }
    if (
      url.pathname === `${config.pathPrefix}/otp` ||
      url.pathname === `${config.pathPrefix}/otp/`
    ) {
      serveHtml(otpPagePath, res);
      return;
    }

    if (
      url.pathname === `${config.pathPrefix}/demo` ||
      url.pathname === `${config.pathPrefix}/demo/`
    ) {
      serveHtml(demoPath, res);
      return;
    }

    if (
      url.pathname === `${config.pathPrefix}/demo2` ||
      url.pathname === `${config.pathPrefix}/demo2/`
    ) {
      serveHtml(demo2Path, res);
      return;
    }

    if (
      url.pathname === `${config.pathPrefix}/demo3` ||
      url.pathname === `${config.pathPrefix}/demo3/`
    ) {
      serveHtml(demo3Path, res);
      return;
    }

    if (
      url.pathname === `${config.pathPrefix}/demo4` ||
      url.pathname === `${config.pathPrefix}/demo4/`
    ) {
      serveHtml(demo4Path, res);
      return;
    }

    if (
      url.pathname === `${config.pathPrefix}/demo5` ||
      url.pathname === `${config.pathPrefix}/demo5/`
    ) {
      serveHtml(demo5Path, res);
      return;
    }

    if (
      url.pathname === `${config.pathPrefix}/demo6` ||
      url.pathname === `${config.pathPrefix}/demo6/`
    ) {
      serveHtml(demo6Path, res);
      return;
    }

    if (
      url.pathname === `${config.pathPrefix}/demo7` ||
      url.pathname === `${config.pathPrefix}/demo7/`
    ) {
      serveHtml(demo7Path, res);
      return;
    }

    if (
      url.pathname === `${config.pathPrefix}/demo8` ||
      url.pathname === `${config.pathPrefix}/demo8/`
    ) {
      serveHtml(demo8Path, res);
      return;
    }

    if (
      url.pathname === `${config.pathPrefix}/demo9` ||
      url.pathname === `${config.pathPrefix}/demo9/`
    ) {
      serveHtml(demo9Path, res);
      return;
    }

    if (
      url.pathname === `${config.pathPrefix}/demo10` ||
      url.pathname === `${config.pathPrefix}/demo10/`
    ) {
      serveHtml(demo10Path, res);
      return;
    }

    if (
      url.pathname === `${config.pathPrefix}/demo11` ||
      url.pathname === `${config.pathPrefix}/demo11/`
    ) {
      serveHtml(demo11Path, res);
      return;
    }

    if (
      url.pathname === `${config.pathPrefix}/demo12` ||
      url.pathname === `${config.pathPrefix}/demo12/`
    ) {
      serveHtml(demo12Path, res);
      return;
    }

    // API token untuk halaman QR (HTML yang gambar QR — server tidak generate QR)
    if (
      url.pathname === `${config.pathPrefix}/qr.json` ||
      url.pathname === `${config.pathPrefix}/qr.json/`
    ) {
      const host = req.headers.host || `127.0.0.1:${config.port}`;
      const base = `${scheme}://${host}${config.pathPrefix}`;
      res.writeHead(200, {
        "content-type": "application/json; charset=utf-8",
        "cache-control": "no-store",
      });
      res.end(
        JSON.stringify({
          token: defaultToken.token,
          tokenId: defaultToken.id,
          label: defaultToken.label,
          scopes: defaultToken.scopes ?? ["*"],
          expiresAt: defaultToken.expiresAt,
          base,
          websocket: `${config.https ? "wss" : "ws"}://${host}${wsPath}`,
          pages: {
            demo: `${base}/demo`,
            demo2: `${base}/demo2`,
            demo3: `${base}/demo3`,
            demo8: `${base}/demo8`,
            demo10: `${base}/demo10`,
            demo11: `${base}/demo11`,
            demo12: `${base}/demo12`,
            qr: `${base}/qr`,
          },
        }),
      );
      return;
    }

    if (
      url.pathname === `${config.pathPrefix}/qr` ||
      url.pathname === `${config.pathPrefix}/qr/`
    ) {
      serveHtml(qrPagePath, res);
      return;
    }

    if (url.pathname === config.pathPrefix || url.pathname === `${config.pathPrefix}/`) {
      res.writeHead(200, { "content-type": "application/json" });
      res.end(
        JSON.stringify({
          name: "NxSocket Gateway",
          version: "0.2.0",
          websocket: wsPath,
          demo: `${config.pathPrefix}/demo`,
          demo2: `${config.pathPrefix}/demo2`,
          demo3: `${config.pathPrefix}/demo3`,
          demo4: `${config.pathPrefix}/demo4`,
          demo5: `${config.pathPrefix}/demo5`,
          demo6: `${config.pathPrefix}/demo6`,
          demo7: `${config.pathPrefix}/demo7`,
          demo8: `${config.pathPrefix}/demo8`,
          demo9: `${config.pathPrefix}/demo9`,
          demo10: `${config.pathPrefix}/demo10`,
          demo11: `${config.pathPrefix}/demo11`,
          demo12: `${config.pathPrefix}/demo12`,
          qr: `${config.pathPrefix}/qr`,
          qrJson: `${config.pathPrefix}/qr.json`,
          otp: `${config.pathPrefix}/otp`,
          otpRequest: `${config.pathPrefix}/otp/request`,
          otpVerify: `${config.pathPrefix}/otp/verify`,
          otpStatus: `${config.pathPrefix}/otp/status`,
          media: `${config.pathPrefix}/media`,
          adapter: config.adapter,
          endpoints: formatGatewayEndpoints(config),
          modules: [
            "presence",
            "chat",
            "notification",
            "monitoring",
            "tracking",
            "ai",
            "terminal",
            "webrtc",
            "feed",
            "groups",
            "otp",
            "media",
          ],
        }),
      );
      return;
    }

    if (url.pathname === `${config.pathPrefix}/health`) {
      res.writeHead(200, { "content-type": "application/json" });
      res.end(JSON.stringify({ ok: true, connections: connections.count() }));
      return;
    }

    if (url.pathname === `${config.pathPrefix}/monitoring`) {
      res.writeHead(200, { "content-type": "application/json" });
      res.end(JSON.stringify(monitoring.stats()));
      return;
    }

    res.writeHead(404, { "content-type": "application/json" });
    res.end(JSON.stringify({ error: "Not found" }));
  };

  const server: http.Server | https.Server = tls
    ? https.createServer({ key: tls.key, cert: tls.cert }, requestListener)
    : http.createServer(requestListener);

  const wss = new WebSocketServer({ noServer: true });

  server.on("upgrade", (req, socket, head) => {
    void (async () => {
      const url = new URL(req.url ?? "/", `http://${req.headers.host ?? "localhost"}`);
      if (url.pathname !== wsPath) {
        socket.write("HTTP/1.1 404 Not Found\r\n\r\n");
        socket.destroy();
        return;
      }

      const tokenValue = extractToken(req, url);
      if (!tokenValue) {
        socket.write("HTTP/1.1 401 Unauthorized\r\n\r\n");
        socket.destroy();
        return;
      }

      try {
        await tokens.reload();
      } catch (err) {
        console.error("[token-reload]", err);
        socket.write("HTTP/1.1 500 Internal Server Error\r\n\r\n");
        socket.destroy();
        return;
      }

      const record = tokens.findByToken(tokenValue);
      if (!record) {
        socket.write("HTTP/1.1 401 Unauthorized\r\n\r\n");
        socket.destroy();
        return;
      }

      try {
        assertTokenUsable(record);
      } catch (err) {
        const msg = err instanceof Error ? err.message : "Unauthorized";
        socket.write(`HTTP/1.1 401 Unauthorized\r\n\r\n${msg}`);
        socket.destroy();
        return;
      }

      wss.handleUpgrade(req, socket, head, (ws) => {
        wss.emit("connection", ws, req, record);
      });
    })();
  });

  wss.on("connection", (socket: WebSocket, _req: http.IncomingMessage, record: GatewayTokenRecord) => {
    const scopes = (record.scopes?.length ? record.scopes : ["*"]) as TokenScope[];
    const allowedRooms = record.allowedRooms ?? null;
    const state = connections.create(
      socket,
      record.id,
      { label: record.label },
      scopes,
      allowedRooms,
    );
    console.log(
      `[connect] session=${state.session.id} token=${record.label} total=${connections.count()}`,
    );
    send(socket, {
      type: "welcome",
      sessionId: state.session.id,
      serverTime: new Date().toISOString(),
    });
    {
      const saved = profiles.get(record.id);
      if (saved?.displayName) {
        connections.setDisplayName(state, saved.displayName);
      }
      send(socket, profiles.hintPayload(record.id));
    }
    send(socket, ai.statusPayload());
    send(socket, terminal.statusPayload());
    {
      const iceServers = resolveIceServers();
      send(socket, {
        type: "ice.config",
        iceServers,
        label: iceStatusLabel(iceServers),
      });
    }
    send(socket, webPush.configPayload());
    send(socket, {
      type: "fcm.status",
      enabled: fcm.enabled,
      devices: fcm.status().devices,
    });
    send(socket, sfu.statusPayload());
    // Beri tahu semua client berapa HP online (demo call)
    const onlinePayload = {
      type: "event" as const,
      room: "*",
      event: "peers.online",
      data: { count: connections.count() },
      from: state.session.id,
    };
    connections.broadcastAll(onlinePayload);
    presence.announceOnline(state);
    monitoring.publish();

    socket.on("pong", () => {
      connections.touch(socket);
    });

    socket.on("message", (raw: RawData) => {
      connections.touch(socket);
      if (!rateLimiter.allow(socket)) {
        send(socket, {
          type: "error",
          code: "rate_limited",
          message: "Terlalu banyak pesan. Coba lagi sebentar.",
        });
        return;
      }
      // Antre per-socket supaya join + call.ring tidak race
      const prev = (socket as WebSocket & { __nxChain?: Promise<void> }).__nxChain ?? Promise.resolve();
      const next = prev
        .catch(() => undefined)
        .then(async () => {
          let message: ClientMessage;
          try {
            message = JSON.parse(raw.toString()) as ClientMessage;
          } catch {
            send(socket, { type: "error", code: "bad_json", message: "Payload harus JSON" });
            return;
          }
          try {
            await handleClientMessage(socket, message);
          } catch (err) {
            const text = err instanceof Error ? err.message : "Unknown error";
            send(socket, { type: "error", code: "handler_error", message: text });
          }
        });
      (socket as WebSocket & { __nxChain?: Promise<void> }).__nxChain = next;
    });

    socket.on("close", () => {
      const removed = connections.remove(socket);
      if (removed) {
        resumeStore.park(removed);
        presence.announceOffline(removed);
        presence.clear(removed);
        monitoring.clear(removed.socket);
        tracking.clear(removed.socket);
        progress.clear(removed.socket);
        jobs.clear(removed.socket);
        sync.clear(removed.socket);
        ai.clearSocket(removed.socket);
        terminal.clearSocket(removed.socket);
        meetings.clearSocket(removed);
        rateLimiter.clear(removed.socket);
        const leftRooms = rooms.leaveAll(removed);
        for (const r of leftRooms) {
          rooms.broadcast(r, {
            type: "event",
            room: r,
            event: "room.peers",
            data: {
              peers: rooms.memberCount(r),
              peerIds: rooms.memberSessionIds(r),
              left: removed.session.id,
            },
            from: removed.session.id,
          } satisfies ServerMessage);
        }
        connections.broadcastAll({
          type: "event",
          room: "*",
          event: "peers.online",
          data: { count: connections.count() },
          from: removed.session.id,
        });
        monitoring.publish();
        console.log(`[disconnect] session=${removed.session.id} total=${connections.count()}`);
      }
    });

    socket.on("error", (err) => {
      console.error(`[socket-error] session=${state.session.id}`, err.message);
    });
  });

  function requireScope(
    state: { scopes: TokenScope[] },
    socket: WebSocket,
    scope: TokenScope,
  ): boolean {
    if (!hasScope(state, scope)) {
      send(socket, {
        type: "error",
        code: "forbidden",
        message: `Scope diperlukan: ${scope}`,
      });
      return false;
    }
    return true;
  }

  const lastCallPushAt = new Map<string, number>();

  function phonesFromDmRoom(room: string): string[] {
    const m = String(room || "").match(/^dm-(\d+)-(\d+)$/);
    if (!m) return [];
    return [m[1], m[2]];
  }

  function isDmBlockedForSender(room: string, senderPhone?: string): boolean {
    const phones = phonesFromDmRoom(room);
    if (phones.length !== 2) return false;
    const mine = String(senderPhone || "").replace(/\D/g, "");
    if (!mine) return false;
    const match = (p: string) => {
      const d = String(p || "").replace(/\D/g, "");
      return !!d && (d === mine || mine.endsWith(d) || d.endsWith(mine));
    };
    const peer = match(phones[0]) ? phones[1] : match(phones[1]) ? phones[0] : phones[1];
    return blocks.isEitherBlocked(mine, peer);
  }

  function notifyIncomingCallPush(opts: {
    room: string;
    mode: "audio" | "video";
    name: string;
    exceptSessionId: string;
  }): void {
    const dedupeKey = `${opts.room}|${opts.exceptSessionId}`;
    const now = Date.now();
    if ((lastCallPushAt.get(dedupeKey) || 0) + 4000 > now) return;
    lastCallPushAt.set(dedupeKey, now);

    const title = "Panggilan masuk";
    const body = `${opts.name} ${opts.mode === "audio" ? "menelepon" : "video call"}`;
    const tag = `call-${opts.room}`.slice(0, 64);

    void webPush
      .notifyRoom(
        opts.room,
        {
          title,
          body: `${body} via NxSocket`,
          room: opts.room,
          mode: opts.mode,
          name: opts.name,
          pathPrefix: config.pathPrefix,
        },
        opts.exceptSessionId,
      )
      .then((n) => {
        if (n > 0) console.log(`[web-push] room=${opts.room} sent=${n}`);
      })
      .catch((err) => console.warn("[web-push]", err));

    const fcmPayload = {
      title,
      body,
      androidChannelId: "remora_call",
      tag,
      data: {
        type: "call",
        room: opts.room,
        mode: opts.mode,
        name: opts.name,
      },
    };

    void fcm
      .notifyRoom(opts.room, fcmPayload, opts.exceptSessionId)
      .then((n) => {
        if (n > 0) console.log(`[fcm-call] room=${opts.room} sent=${n}`);
      })
      .catch((err) => console.warn("[fcm-call]", err));

    for (const phone of phonesFromDmRoom(opts.room)) {
      void fcm
        .notifyPhone(phone, fcmPayload, opts.exceptSessionId)
        .then((n) => {
          if (n > 0) console.log(`[fcm-call] phone=${phone} sent=${n}`);
        })
        .catch((err) => console.warn("[fcm-call]", err));
    }
  }

  async function handleClientMessage(socket: WebSocket, message: ClientMessage): Promise<void> {
    const state = connections.getBySocket(socket);
    if (!state) return;

    switch (message.type) {
      case "ping": {
        send(socket, { type: "pong", ts: message.ts ?? Date.now() });
        return;
      }
      case "identify": {
        connections.setDisplayName(state, message.name);
        if (typeof message.phone === "string" && message.phone.trim()) {
          connections.setPhone(state, message.phone);
        }
        profiles.setDisplayName(state.session.tokenId, state.displayName);
        send(socket, { type: "identified", name: state.displayName });
        presence.announceOnline(state);
        try {
          const n = groups.flushPendingFor(state);
          if (n > 0) console.log(`[groups] pending invites applied=${n}`);
        } catch (err) {
          console.warn("[groups] flushPending", err);
        }
        return;
      }
      case "push.subscribe": {
        webPush.subscribe({
          subscription: message.subscription,
          rooms: message.rooms,
          page: message.page,
          sessionId: state.session.id,
          tokenId: state.session.tokenId,
        });
        send(socket, {
          type: "push.subscribed",
          endpoint: message.subscription.endpoint,
        });
        return;
      }
      case "push.unsubscribe": {
        webPush.unsubscribe(message.endpoint);
        send(socket, { type: "push.unsubscribed", endpoint: message.endpoint });
        return;
      }
      case "fcm.register": {
        try {
          if (message.phone) connections.setPhone(state, message.phone);
          const device = fcm.register({
            token: message.token,
            platform: message.platform,
            phone: message.phone,
            rooms: message.rooms,
            sessionId: state.session.id,
            tokenId: state.session.tokenId,
          });
          send(socket, { type: "fcm.registered", token: device.token });
        } catch (err) {
          send(socket, {
            type: "error",
            code: "handler_error",
            message: err instanceof Error ? err.message : "FCM register gagal",
          });
        }
        return;
      }
      case "fcm.unregister": {
        fcm.unregister(message.token);
        send(socket, { type: "fcm.unregistered", token: message.token });
        return;
      }
      case "fcm.setRooms": {
        fcm.setRooms({
          sessionId: state.session.id,
          token: message.token,
          rooms: message.rooms || [],
        });
        return;
      }
      case "blocks.sync": {
        try {
          const phone = String(message.phone || state.phone || "").trim();
          if (phone) connections.setPhone(state, phone);
          const entry = blocks.setBlocks(
            phone || state.phone || "",
            Array.isArray(message.blocked) ? message.blocked : [],
          );
          send(socket, {
            type: "blocks.synced",
            phone: entry.byPhone,
            count: entry.blocked.length,
          });
        } catch (err) {
          send(socket, {
            type: "error",
            code: "handler_error",
            message: err instanceof Error ? err.message : "blocks.sync gagal",
          });
        }
        return;
      }
      case "meeting.enter": {
        if (!requireScope(state, socket, "call")) return;
        if (!canJoinRoom(state.allowedRooms, message.room)) {
          send(socket, {
            type: "error",
            code: "room_forbidden",
            message: `Token tidak diizinkan join room: ${message.room}`,
          });
          return;
        }
        meetings.enter(state, message.room, {
          title: message.title,
          asHost: message.asHost,
        });
        return;
      }
      case "meeting.admit": {
        if (!requireScope(state, socket, "call")) return;
        meetings.admit(state, message.room, message.sessionId);
        return;
      }
      case "meeting.admitAll": {
        if (!requireScope(state, socket, "call")) return;
        meetings.admitAll(state, message.room);
        return;
      }
      case "meeting.kick": {
        if (!requireScope(state, socket, "call")) return;
        meetings.kick(state, message.room, message.sessionId);
        return;
      }
      case "meeting.setLocked": {
        if (!requireScope(state, socket, "call")) return;
        meetings.setLocked(state, message.room, message.locked);
        return;
      }
      case "meeting.raiseHand": {
        if (!requireScope(state, socket, "call")) return;
        meetings.raiseHand(state, message.room, message.raised);
        return;
      }
      case "meeting.setMedia": {
        if (!requireScope(state, socket, "call")) return;
        meetings.setMedia(state, message.room, {
          mic: message.mic,
          cam: message.cam,
          screen: message.screen,
        });
        return;
      }
      case "meeting.leave": {
        meetings.leave(state, message.room);
        return;
      }
      case "meeting.end": {
        if (!requireScope(state, socket, "call")) return;
        meetings.end(state, message.room);
        return;
      }
      case "sfu.createToken": {
        if (!requireScope(state, socket, "call")) return;
        try {
          const out = await sfu.createJoinToken({
            room: message.room,
            identity: state.session.id,
            name: message.name || state.displayName || "User",
          });
          send(socket, {
            type: "sfu.token",
            url: out.url,
            token: out.token,
            room: out.room,
          });
        } catch (err) {
          send(socket, {
            type: "error",
            code: "sfu_unavailable",
            message: err instanceof Error ? err.message : "SFU unavailable",
          });
        }
        return;
      }
      case "join": {
        if (!canJoinRoom(state.allowedRooms, message.room)) {
          send(socket, {
            type: "error",
            code: "room_forbidden",
            message: `Token tidak diizinkan join room: ${message.room}`,
          });
          return;
        }
        const joinedRoom = rooms.join(state, message.room);
        profiles.setLastRoom(state.session.tokenId, joinedRoom);
        fcm.setRooms({
          sessionId: state.session.id,
          rooms: [...state.rooms],
        });
        const peerIds = rooms.memberSessionIds(joinedRoom, state.session.id);
        send(socket, {
          type: "joined",
          room: joinedRoom,
          peers: rooms.memberCount(joinedRoom),
          peerIds,
        });
        // Beri tahu anggota lain ada yang masuk (untuk UI peer count)
        rooms.broadcast(
          joinedRoom,
          {
            type: "event",
            room: joinedRoom,
            event: "room.peers",
            data: {
              peers: rooms.memberCount(joinedRoom),
              peerIds: rooms.memberSessionIds(joinedRoom),
              joined: state.session.id,
              name: state.displayName,
            },
            from: state.session.id,
          } satisfies ServerMessage,
          socket,
        );
        presence.announceRoomJoin(state, joinedRoom);
        monitoring.publish();
        void chat.sendHistory(state, joinedRoom).catch((err) => {
          console.warn("[chat] history:", err instanceof Error ? err.message : err);
        });
        return;
      }
      case "leave": {
        const leftRoom = message.room.trim();
        rooms.leave(state, leftRoom);
        send(socket, { type: "left", room: leftRoom });
        rooms.broadcast(leftRoom, {
          type: "event",
          room: leftRoom,
          event: "room.peers",
          data: {
            peers: rooms.memberCount(leftRoom),
            peerIds: rooms.memberSessionIds(leftRoom),
            left: state.session.id,
          },
          from: state.session.id,
        } satisfies ServerMessage);
        presence.announceRoomLeave(state, leftRoom);
        monitoring.publish();
        return;
      }
      case "broadcast": {
        const bRoom = message.room.trim();
        if (!state.rooms.has(bRoom)) {
          send(socket, {
            type: "error",
            code: "not_in_room",
            message: `Belum join room: ${bRoom}`,
          });
          return;
        }
        const sent = rooms.broadcast(
          bRoom,
          {
            type: "event",
            room: bRoom,
            event: message.event,
            data: message.data,
            from: state.session.id,
          } satisfies ServerMessage,
          socket,
        );
        if (sent === 0 && message.event === "call.invite") {
          send(socket, {
            type: "error",
            code: "no_peer",
            message: `Tidak ada lawan di room "${bRoom}". Lawan harus Masuk dulu dengan room sama.`,
          });
        }
        return;
      }
      case "call.ring": {
        const r = message.room.trim();
        if (!r) {
          send(socket, { type: "error", code: "bad_room", message: "Room kosong" });
          return;
        }
        if (!canJoinRoom(state.allowedRooms, r)) {
          send(socket, {
            type: "error",
            code: "room_forbidden",
            message: `Token tidak diizinkan join room: ${r}`,
          });
          return;
        }
        rooms.join(state, r);
        const callerName = message.name || state.displayName || "Teman";
        const mode = message.mode || "video";
        // Pesan khusus (bukan cuma event) — client demo3 wajib tangkap ini
        const incoming: ServerMessage = {
          type: "call.incoming",
          room: r,
          name: callerName,
          mode,
          from: state.session.id,
        };
        const eventPayload: ServerMessage = {
          type: "event",
          room: r,
          event: "call.invite",
          data: { name: callerName, mode, room: r },
          from: state.session.id,
        };
        const sentIncoming = connections.broadcastAll(incoming, socket);
        rooms.broadcast(r, incoming, socket);
        connections.broadcastAll(eventPayload, socket);
        rooms.broadcast(r, eventPayload, socket);
        const sent = sentIncoming;
        send(socket, {
          type: "call.ringing",
          room: r,
          peers: sent,
        });
        console.log(
          `[call.ring] from=${state.session.id} room=${r} peers=${sent} roomSize=${rooms.memberCount(r)}`,
        );
        notifyIncomingCallPush({
          room: r,
          mode,
          name: callerName,
          exceptSessionId: state.session.id,
        });
        if (sent === 0) {
          send(socket, {
            type: "error",
            code: "no_peer",
            message:
              "Tidak ada HP lain yang Online. Pastikan A2 sudah ketuk Masuk di demo3 (status Online).",
          });
        }
        return;
      }
      case "resume": {
        const parked = resumeStore.take(message.sessionId, state.session.tokenId);
        if (!parked) {
          send(socket, {
            type: "error",
            code: "resume_failed",
            message: "Session tidak bisa di-resume (kedaluwarsa atau token beda)",
          });
          return;
        }
        connections.rebindSession(state, parked.sessionId);
        state.displayName = parked.displayName;
        state.session.meta.name = parked.displayName;
        const restored: string[] = [];
        for (const room of parked.rooms) {
          if (!canJoinRoom(state.allowedRooms, room)) continue;
          rooms.join(state, room);
          restored.push(room);
          presence.announceRoomJoin(state, room);
        }
        send(socket, { type: "resumed", sessionId: state.session.id, rooms: restored });
        presence.announceOnline(state);
        monitoring.publish();
        console.log(
          `[resume] session=${state.session.id} rooms=${restored.join(",") || "-"}`,
        );
        return;
      }
      case "presence.subscribe": {
        if (!requireScope(state, socket, "presence")) return;
        presence.subscribe(state, message.scope, message.room);
        return;
      }
      case "presence.unsubscribe": {
        if (!requireScope(state, socket, "presence")) return;
        presence.unsubscribe(state, message.scope, message.room);
        return;
      }
      case "chat.send": {
        if (!requireScope(state, socket, "chat")) return;
        if (isDmBlockedForSender(message.room, state.phone)) {
          send(socket, {
            type: "error",
            code: "blocked",
            message: "Pesan diblokir (salah satu pihak memblokir).",
          });
          return;
        }
        await chat.send(state, message.room, message.text, message.to);
        if (!isSilentChatEnvelope(message.text)) {
          const chatFcmPayload = {
            title: state.displayName || "Remora",
            body: previewChatText(message.text),
            data: {
              type: "chat",
              room: message.room,
            },
          };
          void fcm
            .notifyRoom(message.room, chatFcmPayload, state.session.id)
            .then((n) => {
              if (n > 0) console.log(`[fcm] room=${message.room} sent=${n}`);
            })
            .catch((err) => console.warn("[fcm]", err));
          // Fallback: device lawan bicara belum tentu sudah fcm.setRooms untuk
          // room DM ini (baru pertama kali chat / belum pernah buka layarnya).
          // notifyRoom saja bisa berarti push tidak pernah sampai walau device
          // terdaftar FCM by phone -- sama seperti pola panggilan masuk.
          for (const phone of phonesFromDmRoom(message.room)) {
            void fcm
              .notifyPhone(phone, chatFcmPayload, state.session.id)
              .then((n) => {
                if (n > 0) console.log(`[fcm] chat phone=${phone} sent=${n}`);
              })
              .catch((err) => console.warn("[fcm]", err));
          }
        }
        return;
      }
      case "chat.typing": {
        if (!requireScope(state, socket, "chat")) return;
        chat.typing(state, message.room, message.typing);
        return;
      }
      case "chat.getHistory": {
        if (!requireScope(state, socket, "chat")) return;
        await chat.sendHistory(state, message.room, message.limit);
        return;
      }
      case "chat.read": {
        if (!requireScope(state, socket, "chat")) return;
        await chat.markRead(state, message.room, message.messageIds, message.upToTs);
        return;
      }
      case "feed.join": {
        if (!requireScope(state, socket, "chat")) return;
        feed.join(state, message.room);
        return;
      }
      case "feed.list": {
        if (!requireScope(state, socket, "chat")) return;
        feed.list(state, message.room, message.limit);
        return;
      }
      case "feed.post": {
        if (!requireScope(state, socket, "chat")) return;
        feed.createPost(state, message.room, message.text || "", message.image);
        return;
      }
      case "feed.comment": {
        if (!requireScope(state, socket, "chat")) return;
        feed.createComment(
          state,
          message.room,
          message.postId,
          message.text,
          message.parentId,
        );
        return;
      }
      case "feed.like": {
        if (!requireScope(state, socket, "chat")) return;
        feed.toggleLike(state, message.room, message.postId);
        return;
      }
      case "feed.delete": {
        if (!requireScope(state, socket, "chat")) return;
        feed.deletePost(state, message.room, message.postId);
        return;
      }
      case "feed.share": {
        if (!requireScope(state, socket, "chat")) return;
        feed.sharePost(state, message.room, message.postId, message.text);
        return;
      }
      case "feed.follow": {
        if (!requireScope(state, socket, "chat")) return;
        feed.toggleFollow(state, message.targetFrom, message.targetName);
        return;
      }
      case "group.create": {
        if (!requireScope(state, socket, "chat")) return;
        groups.create(state, message.name);
        return;
      }
      case "group.join": {
        if (!requireScope(state, socket, "chat")) return;
        groups.joinByCode(state, message.code);
        return;
      }
      case "group.leave": {
        if (!requireScope(state, socket, "chat")) return;
        groups.leave(state, message.groupId);
        return;
      }
      case "group.kick": {
        if (!requireScope(state, socket, "chat")) return;
        groups.kick(state, message.groupId, message.memberKey);
        return;
      }
      case "group.invite": {
        if (!requireScope(state, socket, "chat")) return;
        try {
          const result = groups.invite(state, message.groupId, message.peerName);
          if (!result.queued) {
            // joined path already broadcasts group.updated
          }
        } catch (err) {
          send(socket, {
            type: "error",
            code: "handler_error",
            message: err instanceof Error ? err.message : "Invite gagal",
          });
        }
        return;
      }
      case "group.sync": {
        if (!requireScope(state, socket, "chat")) return;
        groups.sync(state);
        return;
      }
      case "group.dm": {
        if (!requireScope(state, socket, "chat")) return;
        groups.openDm(state, message.peerName);
        return;
      }
      case "notification.send": {
        if (!requireScope(state, socket, "notify")) return;
        notifications.send(state, message);
        return;
      }
      case "monitoring.subscribe": {
        if (!requireScope(state, socket, "monitor")) return;
        monitoring.subscribe(socket);
        return;
      }
      case "monitoring.unsubscribe": {
        if (!requireScope(state, socket, "monitor")) return;
        monitoring.unsubscribe(socket);
        return;
      }
      case "monitoring.get": {
        if (!requireScope(state, socket, "monitor")) return;
        send(socket, monitoring.stats());
        return;
      }
      case "tracking.subscribe": {
        if (!requireScope(state, socket, "track")) return;
        tracking.subscribe(state, message.target);
        return;
      }
      case "tracking.unsubscribe": {
        if (!requireScope(state, socket, "track")) return;
        tracking.unsubscribe(state, message.target);
        return;
      }
      case "tracking.update": {
        if (!requireScope(state, socket, "track")) return;
        tracking.update(state, message.target, message.lat, message.lng, message.meta);
        return;
      }
      case "ai.start": {
        if (!requireScope(state, socket, "ai")) return;
        const streamId = ai.start(state, message.prompt, message.streamId);
        void streamId;
        return;
      }
      case "ai.cancel": {
        if (!requireScope(state, socket, "ai")) return;
        ai.cancel(message.streamId);
        return;
      }
      case "terminal.exec": {
        if (!requireScope(state, socket, "terminal")) return;
        terminal.exec(state, message.command, message.execId, message.cwd);
        return;
      }
      case "terminal.cancel": {
        if (!requireScope(state, socket, "terminal")) return;
        terminal.cancel(message.execId);
        return;
      }
      case "agent.run": {
        if (!requireScope(state, socket, "terminal")) return;
        terminal.runAgent(
          state,
          message.tool,
          message.prompt,
          message.cwd,
          message.execId,
        );
        return;
      }
      case "agent.cancel": {
        if (!requireScope(state, socket, "terminal")) return;
        terminal.cancel(message.execId);
        return;
      }
      case "webrtc.signal": {
        if (!requireScope(state, socket, "call")) return;
        if (isDmBlockedForSender(message.room, state.phone)) {
          send(socket, {
            type: "error",
            code: "blocked",
            message: "Panggilan diblokir (salah satu pihak memblokir).",
          });
          return;
        }
        webrtc.signal(state, message.room, message.signal, message.payload, message.to);
        // Remora: ring dulu; demo2: offer audio. Dedup di notifyIncomingCallPush.
        if (message.signal === "ring" || message.signal === "offer") {
          const payload = message.payload as {
            name?: string;
            withVideo?: boolean;
          } | null;
          let mode: "audio" | "video" = "audio";
          if (message.signal === "ring") {
            mode = payload?.withVideo ? "video" : "audio";
          } else {
            mode = detectOfferMode(message.payload);
          }
          const callerName =
            (payload && typeof payload === "object" && payload.name) ||
            state.displayName ||
            "Teman";
          notifyIncomingCallPush({
            room: message.room,
            mode,
            name: String(callerName),
            exceptSessionId: state.session.id,
          });
        }
        return;
      }
      case "progress.subscribe": {
        if (!requireScope(state, socket, "progress")) return;
        progress.subscribe(state, message.id);
        return;
      }
      case "progress.unsubscribe": {
        if (!requireScope(state, socket, "progress")) return;
        progress.unsubscribe(state, message.id);
        return;
      }
      case "progress.update": {
        if (!requireScope(state, socket, "progress")) return;
        progress.update(state, message.id, message.percent, {
          loaded: message.loaded,
          total: message.total,
          meta: message.meta,
        });
        return;
      }
      case "progress.done": {
        if (!requireScope(state, socket, "progress")) return;
        progress.done(state, message.id, message.ok !== false, message.meta);
        return;
      }
      case "job.subscribe": {
        if (!requireScope(state, socket, "job")) return;
        jobs.subscribe(state, message.jobId);
        return;
      }
      case "job.unsubscribe": {
        if (!requireScope(state, socket, "job")) return;
        jobs.unsubscribe(state, message.jobId);
        return;
      }
      case "job.create": {
        if (!requireScope(state, socket, "job")) return;
        const jobId = jobs.create(state, message.name, message.jobId, message.data);
        send(socket, {
          type: "job.update",
          jobId,
          name: message.name.trim() || "job",
          status: "running",
          progress: 0,
          result: message.data,
          from: state.session.id,
          ts: new Date().toISOString(),
        });
        return;
      }
      case "job.set": {
        if (!requireScope(state, socket, "job")) return;
        jobs.set(state, message.jobId, message);
        return;
      }
      case "job.run": {
        if (!requireScope(state, socket, "job")) return;
        const jobId = jobs.runDemo(state, message.name, message.jobId, message.steps);
        send(socket, {
          type: "job.update",
          jobId,
          name: message.name.trim() || "job",
          status: "running",
          progress: 0,
          from: state.session.id,
          ts: new Date().toISOString(),
        });
        return;
      }
      case "sync.subscribe": {
        if (!requireScope(state, socket, "sync")) return;
        sync.subscribe(state, message.channel);
        return;
      }
      case "sync.unsubscribe": {
        if (!requireScope(state, socket, "sync")) return;
        sync.unsubscribe(state, message.channel);
        return;
      }
      case "sync.set": {
        if (!requireScope(state, socket, "sync")) return;
        sync.set(state, message.channel, message.key, message.value);
        return;
      }
      case "sync.delete": {
        if (!requireScope(state, socket, "sync")) return;
        sync.delete(state, message.channel, message.key);
        return;
      }
      default: {
        send(socket, { type: "error", code: "unknown_type", message: "Tipe pesan tidak dikenal" });
      }
    }
  }

  heartbeat.start();

  await new Promise<void>((resolve, reject) => {
    server.listen(config.port, config.host, () => resolve());
    server.once("error", reject);
  });

  if (printBanner) {
    console.log("NxSocket Gateway siap");
    console.log(`TLS      : ${config.https ? "HTTPS ON (self-signed)" : "HTTP"}`);
    console.log(`Adapter  : ${config.adapter}`);
    console.log(`OTP API  : POST ${config.pathPrefix}/otp/request | /otp/verify`);
    console.log(
      `Media    : POST ${config.pathPrefix}/media | GET ${config.pathPrefix}/media/:id (max ${Math.round(media.maxBytes / (1024 * 1024))}MB, TTL ${Math.round(media.ttlMs / 86400000)}d)`,
    );
    console.log(`LiveKit  : ${sfu.enabled ? `ON (${sfu.url})` : "OFF — set NXSOCKET_LIVEKIT_* (docs/sfu-livekit.md)"}`);
    console.log(`Feed     : ${path.join(config.dataDir, "feed.json")}`);
    console.log(`GroupsDB : ${path.join(config.dataDir, "groups.json")}`);
    console.log(`OtpDB    : ${path.join(config.dataDir, "otp.json")} (debug=${otp.debug ? "ON" : "OFF"})`);
    console.log(`MediaDir : ${media.root}`);
    console.log(ai.describeBanner());
    console.log(`WebRTC   : ${iceStatusLabel(resolveIceServers())}`);
    console.log(`WebSocket : ${config.https ? "wss" : "ws"}://127.0.0.1:${config.port}${wsPath}`);
    console.log(`Web Push : ${webPush.enabled ? "ON (VAPID)" : "OFF"}`);
    console.log(
      `FCM      : ${fcm.enabled ? `ON (${fcm.status().devices} device)` : "OFF — set NXSOCKET_FIREBASE_CREDENTIALS (+ google-services.json di Remora)"}`,
    );
    console.log(`Profiles : ${path.join(config.dataDir, "profiles.json")}`);
    if (webPush.enabled) {
      console.log(`VAPID pub : ${webPush.publicKey.slice(0, 16)}…`);
    }
    for (const line of formatGatewayEndpoints(config)) {
      console.log(line);
    }
    console.log(`Token     : ${defaultToken.token}`);
    console.log(`Token ID  : ${defaultToken.id}`);
    console.log(`Scopes    : ${(defaultToken.scopes ?? ["*"]).join(",")}`);
    if (defaultToken.expiresAt) console.log(`Expires   : ${defaultToken.expiresAt}`);
    printTokenQr(defaultToken.token);
    printNetworkUrlQr({
      config,
      token: defaultToken.token,
      page: "demo3",
      https: config.https,
    });
    printLanAccessTips(config.port, config.https);
  }

  return {
    config,
    close: async () => {
      media.close();
      heartbeat.stop();
      for (const state of connections.all()) {
        state.socket.terminate();
      }
      await new Promise<void>((resolve, reject) => {
        wss.close((err) => (err ? reject(err) : resolve()));
      });
      await new Promise<void>((resolve, reject) => {
        server.close((err) => (err ? reject(err) : resolve()));
      });
      await dataAdapter.close();
    },
  };
}
