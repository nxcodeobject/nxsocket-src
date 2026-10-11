import { randomBytes, randomInt } from "node:crypto";
import fs from "node:fs";
import path from "node:path";

export type OtpPending = {
  phone: string;
  code: string;
  expiresAt: number;
  attempts: number;
  createdAt: number;
};

export type OtpClaim = {
  phone: string;
  claimId: string;
  claimToken: string;
  verifiedAt: string;
  expiresAt: number;
};

type Store = {
  pending: OtpPending[];
  claims: OtpClaim[];
};

const CODE_TTL_MS = 5 * 60_000;
const CLAIM_TTL_MS = 24 * 60_000 * 60;
const MAX_ATTEMPTS = 5;
const RESEND_COOLDOWN_MS = 30_000;

/** Samakan dengan Remora: 08… / 8… → 62… */
export function normalizePhone(raw: string): string {
  let d = String(raw || "").replace(/\D/g, "");
  if (!d) return "";
  if (d.startsWith("0")) d = `62${d.slice(1)}`;
  else if (d.startsWith("8") && !d.startsWith("62")) d = `62${d}`;
  return d;
}

export class OtpModule {
  private readonly storePath: string;
  private pending = new Map<string, OtpPending>();
  private claims = new Map<string, OtpClaim>();
  /** Dev: kembalikan kode di JSON. Matikan: NXSOCKET_OTP_DEBUG=0 */
  readonly debug: boolean;

  constructor(dataDir: string) {
    this.storePath = path.join(dataDir, "otp.json");
    this.debug = !["0", "false", "no", "off"].includes(
      String(process.env.NXSOCKET_OTP_DEBUG ?? "1").trim().toLowerCase(),
    );
    this.load();
  }

  async request(phoneRaw: string): Promise<{
    ok: true;
    phone: string;
    expiresInSec: number;
    channel: "dev" | "sms";
    debugCode?: string;
    cooldownSec?: number;
  }> {
    const phone = normalizePhone(phoneRaw);
    if (phone.length < 10 || phone.length > 16) {
      throw new Error("Nomor HP tidak valid");
    }

    const now = Date.now();
    this.purge(now);
    const prev = this.pending.get(phone);
    if (prev && now - prev.createdAt < RESEND_COOLDOWN_MS) {
      const wait = Math.ceil((RESEND_COOLDOWN_MS - (now - prev.createdAt)) / 1000);
      const err = new Error(`Tunggu ${wait}s sebelum minta OTP lagi`) as Error & {
        cooldownSec: number;
      };
      err.cooldownSec = wait;
      throw err;
    }

    const code = String(randomInt(100_000, 999_999));
    const row: OtpPending = {
      phone,
      code,
      expiresAt: now + CODE_TTL_MS,
      attempts: 0,
      createdAt: now,
    };
    this.pending.set(phone, row);
    this.persist();

    // Hook kirim SMS / WhatsApp — nanti diisi provider proyek Remora
    await this.dispatchOtp(phone, code);

    const channel = this.channelLabel();
    const out: {
      ok: true;
      phone: string;
      expiresInSec: number;
      channel: "dev" | "sms";
      debugCode?: string;
    } = {
      ok: true,
      phone,
      expiresInSec: Math.floor(CODE_TTL_MS / 1000),
      channel,
    };
    if (this.debug) out.debugCode = code;
    console.log(`[otp] request phone=${phone} channel=${channel}${this.debug ? ` code=${code}` : ""}`);
    return out;
  }

  verify(phoneRaw: string, codeRaw: string): {
    ok: true;
    verified: true;
    phone: string;
    claimId: string;
    claimToken: string;
    expiresAt: string;
  } {
    const phone = normalizePhone(phoneRaw);
    const code = String(codeRaw || "").replace(/\D/g, "");
    if (phone.length < 10) throw new Error("Nomor HP tidak valid");
    if (code.length !== 6) throw new Error("Kode OTP harus 6 digit");

    const now = Date.now();
    this.purge(now);
    const row = this.pending.get(phone);
    if (!row) throw new Error("OTP tidak ditemukan — minta kode baru");
    if (row.expiresAt <= now) {
      this.pending.delete(phone);
      this.persist();
      throw new Error("OTP kedaluwarsa — minta kode baru");
    }
    if (row.attempts >= MAX_ATTEMPTS) {
      this.pending.delete(phone);
      this.persist();
      throw new Error("Terlalu banyak percobaan — minta kode baru");
    }
    if (row.code !== code) {
      row.attempts += 1;
      this.persist();
      throw new Error("Kode OTP salah");
    }

    this.pending.delete(phone);
    const claim: OtpClaim = {
      phone,
      claimId: randomBytes(8).toString("hex"),
      claimToken: randomBytes(24).toString("hex"),
      verifiedAt: new Date().toISOString(),
      expiresAt: now + CLAIM_TTL_MS,
    };
    this.claims.set(phone, claim);
    this.persist();
    console.log(`[otp] verified phone=${phone} claim=${claim.claimId}`);

    return {
      ok: true,
      verified: true,
      phone,
      claimId: claim.claimId,
      claimToken: claim.claimToken,
      expiresAt: new Date(claim.expiresAt).toISOString(),
    };
  }

  status(phoneRaw: string): {
    verified: boolean;
    phone: string;
    claimId?: string;
    expiresAt?: string;
  } {
    const phone = normalizePhone(phoneRaw);
    this.purge(Date.now());
    const c = this.claims.get(phone);
    if (!c || c.expiresAt <= Date.now()) {
      return { verified: false, phone };
    }
    return {
      verified: true,
      phone,
      claimId: c.claimId,
      expiresAt: new Date(c.expiresAt).toISOString(),
    };
  }

  /** Cek klaim Remora (header / body nanti). */
  checkClaim(phoneRaw: string, claimToken: string): boolean {
    const phone = normalizePhone(phoneRaw);
    this.purge(Date.now());
    const c = this.claims.get(phone);
    return Boolean(c && c.claimToken === claimToken && c.expiresAt > Date.now());
  }

  /**
   * Kirim OTP:
   * - Dev: log + debugCode di response (NXSOCKET_OTP_DEBUG=1).
   * - Produksi: POST ke NXSOCKET_OTP_WEBHOOK_URL
   *   body: { phone, code, channel: "sms" }
   *   header opsional: X-NxSocket-Otp-Secret = NXSOCKET_OTP_WEBHOOK_SECRET
   */
  protected async dispatchOtp(phone: string, code: string): Promise<void> {
    const webhook = String(process.env.NXSOCKET_OTP_WEBHOOK_URL || "").trim();
    if (!webhook) {
      if (this.debug) {
        console.log(`[otp:dev] kirim ke ${phone}: ${code}`);
      }
      return;
    }

    const secret = String(process.env.NXSOCKET_OTP_WEBHOOK_SECRET || "").trim();
    const headers: Record<string, string> = {
      "content-type": "application/json",
    };
    if (secret) headers["x-nxsocket-otp-secret"] = secret;

    try {
      const res = await fetch(webhook, {
        method: "POST",
        headers,
        body: JSON.stringify({ phone, code, channel: "sms" }),
      });
      if (!res.ok) {
        const text = await res.text().catch(() => "");
        console.warn(`[otp] webhook HTTP ${res.status} ${text.slice(0, 200)}`);
      } else {
        console.log(`[otp] webhook ok phone=${phone}`);
      }
    } catch (err) {
      console.warn("[otp] webhook gagal", err);
    }
  }

  /** channel yang dilaporkan ke client */
  channelLabel(): "dev" | "sms" {
    return String(process.env.NXSOCKET_OTP_WEBHOOK_URL || "").trim() ? "sms" : "dev";
  }

  private purge(now: number): void {
    for (const [k, v] of this.pending) {
      if (v.expiresAt <= now) this.pending.delete(k);
    }
    for (const [k, v] of this.claims) {
      if (v.expiresAt <= now) this.claims.delete(k);
    }
  }

  private load(): void {
    try {
      if (!fs.existsSync(this.storePath)) return;
      const raw = JSON.parse(fs.readFileSync(this.storePath, "utf8")) as Store;
      const now = Date.now();
      for (const p of raw.pending || []) {
        if (p?.phone && p.code && p.expiresAt > now) this.pending.set(p.phone, p);
      }
      for (const c of raw.claims || []) {
        if (c?.phone && c.claimToken && c.expiresAt > now) this.claims.set(c.phone, c);
      }
    } catch {
      this.pending.clear();
      this.claims.clear();
    }
  }

  private persist(): void {
    try {
      fs.mkdirSync(path.dirname(this.storePath), { recursive: true });
      const store: Store = {
        pending: [...this.pending.values()],
        claims: [...this.claims.values()],
      };
      fs.writeFileSync(this.storePath, JSON.stringify(store, null, 2), "utf8");
    } catch (err) {
      console.warn("[otp] gagal simpan", err);
    }
  }
}
