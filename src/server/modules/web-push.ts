import fs from "node:fs";
import path from "node:path";
import webpush from "web-push";

export type PushSubscriptionJson = {
  endpoint: string;
  expirationTime?: number | null;
  keys: { p256dh: string; auth: string };
};

export type StoredPushSub = {
  endpoint: string;
  keys: { p256dh: string; auth: string };
  expirationTime?: number | null;
  rooms: string[];
  page: "demo2" | "demo3" | "demo8" | "demo9" | "demo10";
  sessionId?: string;
  tokenId?: string;
  updatedAt: string;
};

export type CallPushPayload = {
  title: string;
  body: string;
  room: string;
  mode: "audio" | "video";
  name: string;
  pathPrefix: string;
};

type VapidFile = { publicKey: string; privateKey: string; subject: string };

export class WebPushModule {
  readonly enabled: boolean;
  readonly publicKey: string;
  private readonly storePath: string;
  private subs: StoredPushSub[] = [];

  constructor(dataDir: string) {
    this.storePath = path.join(dataDir, "push-subscriptions.json");
    const keys = loadOrCreateVapid(dataDir);
    this.publicKey = keys.publicKey;
    this.enabled = Boolean(keys.publicKey && keys.privateKey);
    if (this.enabled) {
      webpush.setVapidDetails(keys.subject, keys.publicKey, keys.privateKey);
    }
    this.subs = loadSubs(this.storePath);
  }

  configPayload(): { type: "push.vapid"; publicKey: string; enabled: boolean } {
    return {
      type: "push.vapid",
      publicKey: this.publicKey,
      enabled: this.enabled,
    };
  }

  subscribe(
    input: {
      subscription: PushSubscriptionJson;
      rooms?: string[];
      page?: "demo2" | "demo3" | "demo8" | "demo9" | "demo10";
      sessionId?: string;
      tokenId?: string;
    },
  ): void {
    if (!this.enabled) throw new Error("Web Push tidak aktif (VAPID gagal)");
    const sub = input.subscription;
    if (!sub?.endpoint || !sub.keys?.p256dh || !sub.keys?.auth) {
      throw new Error("Subscription push tidak valid");
    }
    const rooms = Array.isArray(input.rooms)
      ? [...new Set(input.rooms.map((r) => r.trim()).filter(Boolean))]
      : [];
    const allowed = new Set(["demo2", "demo3", "demo8", "demo9", "demo10"]);
    const page = allowed.has(input.page || "") ? input.page! : "demo3";
    const next: StoredPushSub = {
      endpoint: sub.endpoint,
      keys: { p256dh: sub.keys.p256dh, auth: sub.keys.auth },
      expirationTime: sub.expirationTime ?? null,
      rooms,
      page,
      sessionId: input.sessionId,
      tokenId: input.tokenId,
      updatedAt: new Date().toISOString(),
    };
    const idx = this.subs.findIndex((s) => s.endpoint === next.endpoint);
    if (idx >= 0) this.subs[idx] = { ...this.subs[idx], ...next };
    else this.subs.push(next);
    this.persist();
  }

  unsubscribe(endpoint: string): void {
    const before = this.subs.length;
    this.subs = this.subs.filter((s) => s.endpoint !== endpoint);
    if (this.subs.length !== before) this.persist();
  }

  /** Kirim push ke subscription yang join room (kecuali session pengirim). */
  async notifyRoom(
    room: string,
    payload: CallPushPayload,
    exceptSessionId?: string,
  ): Promise<number> {
    if (!this.enabled) return 0;
    const key = room.trim();
    if (!key) return 0;
    const targets = this.subs.filter(
      (s) => s.rooms.includes(key) && (!exceptSessionId || s.sessionId !== exceptSessionId),
    );
    if (!targets.length) return 0;

    let sent = 0;
    const gone: string[] = [];
    await Promise.all(
      targets.map(async (s) => {
        const openPath = `${payload.pathPrefix}/${s.page || (payload.mode === "audio" ? "demo2" : "demo3")}`;
        const body = JSON.stringify({
          title: payload.title,
          body: payload.body,
          room: payload.room,
          mode: payload.mode,
          name: payload.name,
          url: openPath,
          tag: `nxsocket-call-${key}`,
        });
        try {
          await webpush.sendNotification(
            {
              endpoint: s.endpoint,
              keys: s.keys,
              expirationTime: s.expirationTime ?? undefined,
            },
            body,
            {
              TTL: 60,
              urgency: "high",
              topic: `call-${key}`.slice(0, 32),
            },
          );
          sent += 1;
        } catch (err) {
          const status = (err as { statusCode?: number }).statusCode;
          if (status === 404 || status === 410) gone.push(s.endpoint);
          else console.warn("[web-push]", err instanceof Error ? err.message : err);
        }
      }),
    );
    if (gone.length) {
      this.subs = this.subs.filter((s) => !gone.includes(s.endpoint));
      this.persist();
    }
    return sent;
  }

  private persist(): void {
    try {
      fs.mkdirSync(path.dirname(this.storePath), { recursive: true });
      fs.writeFileSync(this.storePath, JSON.stringify(this.subs, null, 2), "utf8");
    } catch (err) {
      console.warn("[web-push] gagal simpan subscriptions", err);
    }
  }
}

function loadSubs(file: string): StoredPushSub[] {
  try {
    if (!fs.existsSync(file)) return [];
    const raw = JSON.parse(fs.readFileSync(file, "utf8")) as unknown;
    return Array.isArray(raw) ? (raw as StoredPushSub[]) : [];
  } catch {
    return [];
  }
}

function loadOrCreateVapid(dataDir: string): VapidFile {
  const subject =
    process.env.NXSOCKET_VAPID_SUBJECT?.trim() || "mailto:nxsocket@localhost";
  const envPub = process.env.NXSOCKET_VAPID_PUBLIC_KEY?.trim();
  const envPriv = process.env.NXSOCKET_VAPID_PRIVATE_KEY?.trim();
  if (envPub && envPriv) {
    return { publicKey: envPub, privateKey: envPriv, subject };
  }

  const file = path.join(dataDir, "vapid-keys.json");
  try {
    if (fs.existsSync(file)) {
      const raw = JSON.parse(fs.readFileSync(file, "utf8")) as Partial<VapidFile>;
      if (raw.publicKey && raw.privateKey) {
        return {
          publicKey: raw.publicKey,
          privateKey: raw.privateKey,
          subject: raw.subject || subject,
        };
      }
    }
  } catch {
    /* generate baru */
  }

  const generated = webpush.generateVAPIDKeys();
  const out: VapidFile = {
    publicKey: generated.publicKey,
    privateKey: generated.privateKey,
    subject,
  };
  try {
    fs.mkdirSync(dataDir, { recursive: true });
    fs.writeFileSync(file, JSON.stringify(out, null, 2), "utf8");
    console.log(`[web-push] VAPID keys dibuat → ${file}`);
  } catch (err) {
    console.warn("[web-push] gagal tulis vapid-keys.json", err);
  }
  return out;
}
