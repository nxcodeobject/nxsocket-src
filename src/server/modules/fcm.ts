import fs from "node:fs";
import path from "node:path";
import { ensureFirebaseAdmin } from "../../shared/firebase-admin.js";

export type FcmDevice = {
  token: string;
  platform: "android" | "ios" | "unknown";
  phone?: string;
  tokenId?: string;
  sessionId?: string;
  rooms: string[];
  updatedAt: string;
};

export type FcmNotifyPayload = {
  title: string;
  body: string;
  data?: Record<string, string>;
  /** Android notification channel (default remora_chat). */
  androidChannelId?: string;
  /** Collapse/replace key agar ring+offer tidak dobel. */
  tag?: string;
};

type StoreFile = { devices: FcmDevice[] };

/**
 * Push FCM ke perangkat Remora (Android/iOS).
 * Butuh service account Firebase (NXSOCKET_FIREBASE_CREDENTIALS).
 */
export class FcmModule {
  private readonly storePath: string;
  private devices: FcmDevice[] = [];
  private ready = false;

  constructor(private readonly dataDir: string) {
    this.storePath = path.join(dataDir, "fcm-devices.json");
    this.devices = loadStore(this.storePath);
  }

  async init(): Promise<void> {
    const admin = await ensureFirebaseAdmin(this.dataDir);
    this.ready = !!admin;
  }

  get enabled(): boolean {
    return this.ready;
  }

  status(): { enabled: boolean; devices: number } {
    return { enabled: this.ready, devices: this.devices.length };
  }

  register(input: {
    token: string;
    platform?: string;
    phone?: string;
    tokenId?: string;
    sessionId?: string;
    rooms?: string[];
  }): FcmDevice {
    const token = String(input.token || "").trim();
    if (token.length < 20) {
      throw new Error("FCM token tidak valid");
    }
    const platform =
      input.platform === "ios" || input.platform === "android"
        ? input.platform
        : "unknown";
    const rooms = Array.isArray(input.rooms)
      ? [...new Set(input.rooms.map((r) => String(r || "").trim()).filter(Boolean))]
      : [];

    const next: FcmDevice = {
      token,
      platform,
      phone: input.phone ? String(input.phone).trim() : undefined,
      tokenId: input.tokenId,
      sessionId: input.sessionId,
      rooms,
      updatedAt: new Date().toISOString(),
    };

    const idx = this.devices.findIndex((d) => d.token === token);
    if (idx >= 0) {
      this.devices[idx] = {
        ...this.devices[idx],
        ...next,
        rooms: rooms.length ? rooms : this.devices[idx].rooms,
      };
    } else {
      this.devices.push(next);
    }
    this.persist();
    return this.devices.find((d) => d.token === token)!;
  }

  unregister(token: string): void {
    const t = String(token || "").trim();
    const before = this.devices.length;
    this.devices = this.devices.filter((d) => d.token !== t);
    if (this.devices.length !== before) this.persist();
  }

  /** Sinkron daftar room untuk session / token perangkat. */
  setRooms(opts: { sessionId?: string; token?: string; rooms: string[] }): void {
    const rooms = [...new Set(opts.rooms.map((r) => String(r || "").trim()).filter(Boolean))];
    let changed = false;
    for (const d of this.devices) {
      if (
        (opts.token && d.token === opts.token) ||
        (opts.sessionId && d.sessionId === opts.sessionId)
      ) {
        d.rooms = rooms;
        d.updatedAt = new Date().toISOString();
        changed = true;
      }
    }
    if (changed) this.persist();
  }

  bindSession(sessionId: string, tokenId: string, phone?: string): void {
    let changed = false;
    for (const d of this.devices) {
      if (d.tokenId === tokenId || d.sessionId === sessionId) {
        d.sessionId = sessionId;
        d.tokenId = tokenId;
        if (phone) d.phone = phone;
        d.updatedAt = new Date().toISOString();
        changed = true;
      }
    }
    if (changed) this.persist();
  }

  async notifyRoom(
    room: string,
    payload: FcmNotifyPayload,
    exceptSessionId?: string,
  ): Promise<number> {
    if (!this.ready) return 0;
    const key = String(room || "").trim();
    if (!key) return 0;

    const targets = this.devices.filter(
      (d) =>
        d.rooms.includes(key) &&
        (!exceptSessionId || d.sessionId !== exceptSessionId),
    );
    if (!targets.length) return 0;

    return this.sendToDevices(targets, payload);
  }

  /**
   * Push ke semua perangkat yang terdaftar dengan nomor (normalisasi digit).
   * Berguna untuk panggilan DM saat daftar room FCM belum tersinkron.
   */
  async notifyPhone(
    phone: string,
    payload: FcmNotifyPayload,
    exceptSessionId?: string,
  ): Promise<number> {
    if (!this.ready) return 0;
    const want = digitsOnly(phone);
    if (!want) return 0;

    const targets = this.devices.filter((d) => {
      if (exceptSessionId && d.sessionId === exceptSessionId) return false;
      const have = digitsOnly(d.phone || "");
      if (!have) return false;
      return have === want || have.endsWith(want) || want.endsWith(have);
    });
    if (!targets.length) return 0;

    return this.sendToDevices(targets, payload);
  }

  private async sendToDevices(
    targets: FcmDevice[],
    payload: FcmNotifyPayload,
  ): Promise<number> {
    const admin = await ensureFirebaseAdmin(this.dataDir);
    if (!admin) return 0;

    const data: Record<string, string> = {};
    if (payload.data) {
      for (const [k, v] of Object.entries(payload.data)) {
        data[k] = String(v ?? "");
      }
    }

    const channelId = payload.androidChannelId || "remora_chat";
    const tag = payload.tag ? String(payload.tag).slice(0, 64) : undefined;

    // Dedup token (room + phone bisa overlap)
    const seen = new Set<string>();
    const unique = targets.filter((d) => {
      if (seen.has(d.token)) return false;
      seen.add(d.token);
      return true;
    });

    let sent = 0;
    const gone: string[] = [];
    // Panggilan masuk: kirim data-only (tanpa `notification`). Notification
    // message diserahkan ke system tray Android tanpa membangunkan JS/native
    // handler saat app background/killed, sehingga UI full-screen dering
    // (angkat/tolak) tidak pernah tampil. Data-only memaksa Android selalu
    // memanggil FirebaseMessagingService.onMessageReceived kita.
    const isCall = channelId === "remora_call";
    data.title = data.title || payload.title.slice(0, 64);
    data.body = data.body || payload.body.slice(0, 180);
    data.androidChannelId = channelId;
    if (tag) data.tag = tag;

    await Promise.all(
      unique.map(async (d) => {
        try {
          await admin.messaging().send({
            token: d.token,
            ...(isCall
              ? {}
              : {
                  notification: {
                    title: payload.title.slice(0, 64),
                    body: payload.body.slice(0, 180),
                  },
                }),
            data,
            android: {
              priority: "high",
              collapseKey: tag || undefined,
              ...(isCall
                ? {}
                : {
                    notification: {
                      channelId,
                      sound: "default",
                      ...(tag ? { tag } : {}),
                    },
                  }),
            },
          });
          sent += 1;
        } catch (err) {
          const msg = err instanceof Error ? err.message : String(err);
          if (/not-registered|invalid-registration|registration-token/i.test(msg)) {
            gone.push(d.token);
          } else {
            console.warn("[fcm]", msg);
          }
        }
      }),
    );

    if (gone.length) {
      this.devices = this.devices.filter((d) => !gone.includes(d.token));
      this.persist();
    }
    return sent;
  }

  private persist(): void {
    const payload: StoreFile = { devices: this.devices };
    fs.writeFileSync(this.storePath, JSON.stringify(payload, null, 2), "utf8");
  }
}

function loadStore(file: string): FcmDevice[] {
  try {
    if (!fs.existsSync(file)) return [];
    const parsed = JSON.parse(fs.readFileSync(file, "utf8")) as StoreFile;
    return Array.isArray(parsed?.devices) ? parsed.devices : [];
  } catch {
    return [];
  }
}

function digitsOnly(value: string): string {
  return String(value || "").replace(/\D/g, "");
}
