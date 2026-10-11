import fs from "node:fs";
import type { GatewayTokenRecord } from "../shared/types.js";
import type { AdapterOptions, ChatRecord, DataAdapter } from "./types.js";

type FirestoreLike = {
  collection: (name: string) => {
    doc: (id: string) => {
      set: (data: Record<string, unknown>) => Promise<unknown>;
      get: () => Promise<{ exists: boolean; data: () => Record<string, unknown> | undefined }>;
    };
    get: () => Promise<{
      docs: Array<{ id: string; data: () => Record<string, unknown> }>;
    }>;
    where: (field: string, op: string, value: unknown) => {
      orderBy: (field: string, dir?: string) => {
        limit: (n: number) => {
          get: () => Promise<{
            docs: Array<{ id: string; data: () => Record<string, unknown> }>;
          }>;
        };
      };
    };
  };
};

/**
 * Adapter Firebase (Firestore).
 * Butuh paket `firebase-admin` + file service account.
 *
 * Env / config:
 * - NXSOCKET_ADAPTER=firebase
 * - NXSOCKET_FIREBASE_CREDENTIALS=/path/to/serviceAccount.json
 * - NXSOCKET_FIREBASE_DATABASE_URL= (opsional)
 */
export class FirebaseAdapter implements DataAdapter {
  readonly kind = "firebase" as const;
  private db!: FirestoreLike;
  private tokens: GatewayTokenRecord[] = [];

  constructor(private readonly options: AdapterOptions) {}

  async init(): Promise<void> {
    const credPath = this.options.firebaseCredentials ?? process.env.NXSOCKET_FIREBASE_CREDENTIALS;
    if (!credPath) {
      throw new Error(
        "Firebase adapter membutuhkan NXSOCKET_FIREBASE_CREDENTIALS (path service account JSON)",
      );
    }
    if (!fs.existsSync(credPath)) {
      throw new Error(`File credentials Firebase tidak ditemukan: ${credPath}`);
    }

    let admin: {
      apps: unknown[];
      initializeApp: (options: Record<string, unknown>) => unknown;
      credential: { cert: (serviceAccount: object) => unknown };
      firestore: () => FirestoreLike;
    };
    try {
      // optional peer dependency
      admin = (await import(/* webpackIgnore: true */ "firebase-admin")) as typeof admin;
    } catch {
      throw new Error(
        "Paket firebase-admin belum terpasang. Jalankan: npm install firebase-admin",
      );
    }

    if (!admin.apps.length) {
      const serviceAccount = JSON.parse(fs.readFileSync(credPath, "utf8")) as object;
      admin.initializeApp({
        credential: admin.credential.cert(serviceAccount as never),
        databaseURL: this.options.firebaseDatabaseURL ?? process.env.NXSOCKET_FIREBASE_DATABASE_URL,
      });
    }

    this.db = admin.firestore() as unknown as FirestoreLike;
    await this.reloadTokens();
  }

  async close(): Promise<void> {
    /* firebase-admin app biasanya dibiarkan hidup selama proses */
  }

  async reloadTokens(): Promise<void> {
    const snap = await this.db.collection("nxsocket_tokens").get();
    this.tokens = snap.docs.map((doc) => {
      const d = doc.data();
      const scopesRaw = d.scopes;
      return {
        id: String(d.id ?? doc.id),
        token: String(d.token ?? ""),
        label: String(d.label ?? "default"),
        createdAt: String(d.createdAt ?? new Date().toISOString()),
        updatedAt: String(d.updatedAt ?? new Date().toISOString()),
        revokedAt: (d.revokedAt as string | null | undefined) ?? null,
        expiresAt: (d.expiresAt as string | null | undefined) ?? null,
        scopes: Array.isArray(scopesRaw) && scopesRaw.length ? scopesRaw : ["*"],
        allowedRooms: Array.isArray(d.allowedRooms) ? (d.allowedRooms as string[]) : null,
      };
    });
  }

  listTokens(includeRevoked = false): GatewayTokenRecord[] {
    return this.tokens.filter((r) => includeRevoked || !r.revokedAt);
  }

  findTokenByValue(token: string): GatewayTokenRecord | undefined {
    return this.tokens.find((r) => r.token === token && !r.revokedAt);
  }

  findTokenById(id: string): GatewayTokenRecord | undefined {
    return this.tokens.find((r) => r.id === id);
  }

  async upsertToken(record: GatewayTokenRecord): Promise<void> {
    await this.db.collection("nxsocket_tokens").doc(record.id).set({ ...record });
    await this.reloadTokens();
  }

  async replaceTokens(records: GatewayTokenRecord[]): Promise<void> {
    for (const record of records) {
      await this.db.collection("nxsocket_tokens").doc(record.id).set({ ...record });
    }
    this.tokens = records;
  }

  async saveChat(message: ChatRecord): Promise<void> {
    await this.db.collection("nxsocket_chat").doc(message.id).set({ ...message });
  }

  async listChat(room: string, limit = 50): Promise<ChatRecord[]> {
    const snap = await this.db
      .collection("nxsocket_chat")
      .where("room", "==", room)
      .orderBy("ts", "desc")
      .limit(limit)
      .get();

    return snap.docs
      .map((doc) => {
        const d = doc.data();
        return {
          id: String(d.id ?? doc.id),
          room: String(d.room ?? room),
          text: String(d.text ?? ""),
          from: String(d.from ?? ""),
          name: String(d.name ?? ""),
          to: d.to ? String(d.to) : undefined,
          ts: String(d.ts ?? ""),
          status: (d.status as ChatRecord["status"]) || "sent",
          readAt: d.readAt ? String(d.readAt) : undefined,
        };
      })
      .reverse();
  }

  async updateChatStatus(
    ids: string[],
    status: ChatRecord["status"],
    meta?: { readAt?: string },
  ): Promise<number> {
    if (!ids.length || !status) return 0;
    const rank = { sent: 1, delivered: 2, read: 3 } as const;
    let n = 0;
    for (const id of ids) {
      const ref = this.db.collection("nxsocket_chat").doc(id);
      const snap = await ref.get();
      if (!snap.exists) continue;
      const cur = (snap.data()?.status as keyof typeof rank) || "sent";
      if (rank[status] < (rank[cur] || 0)) continue;
      const patch: Record<string, string> = { status };
      if (status === "read") patch.readAt = meta?.readAt || new Date().toISOString();
      const prev = snap.data() || {};
      await ref.set({ ...prev, ...patch });
      n += 1;
    }
    return n;
  }

  async markChatRead(
    room: string,
    readerSessionId: string,
    opts?: { messageIds?: string[]; upToTs?: string },
  ): Promise<ChatRecord[]> {
    const rows = (await this.listChat(room, 200)).filter((r) => {
      if (r.from === readerSessionId) return false;
      if (r.status === "read") return false;
      if (opts?.messageIds?.length && !opts.messageIds.includes(r.id)) return false;
      if (opts?.upToTs && r.ts > opts.upToTs) return false;
      return true;
    });
    if (!rows.length) return [];
    const readAt = new Date().toISOString();
    await this.updateChatStatus(
      rows.map((r) => r.id),
      "read",
      { readAt },
    );
    return rows.map((r) => ({ ...r, status: "read" as const, readAt }));
  }
}
