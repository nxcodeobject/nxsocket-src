/**
 * Inisialisasi firebase-admin bersama (FCM + adapter Firestore).
 * Env: NXSOCKET_FIREBASE_CREDENTIALS=/path/to/serviceAccount.json
 */
import fs from "node:fs";
import path from "node:path";

type AdminModule = {
  apps: unknown[];
  initializeApp: (options: Record<string, unknown>) => unknown;
  credential: { cert: (serviceAccount: object) => unknown };
  firestore: () => unknown;
  messaging: () => {
    send: (message: Record<string, unknown>) => Promise<string>;
  };
};

let adminSingleton: AdminModule | null = null;
let initError: string | null = null;

export function getFirebaseAdmin(): AdminModule | null {
  return adminSingleton;
}

export function firebaseAdminError(): string | null {
  return initError;
}

export async function ensureFirebaseAdmin(
  dataDir?: string,
): Promise<AdminModule | null> {
  if (adminSingleton) return adminSingleton;
  if (initError && !process.env.NXSOCKET_FIREBASE_CREDENTIALS) return null;

  const credPath =
    process.env.NXSOCKET_FIREBASE_CREDENTIALS?.trim() ||
    (dataDir
      ? path.join(dataDir, "firebase-service-account.json")
      : "");

  if (!credPath) {
    initError = "NXSOCKET_FIREBASE_CREDENTIALS belum di-set";
    return null;
  }
  if (!fs.existsSync(credPath)) {
    initError = `File credentials tidak ditemukan: ${credPath}`;
    return null;
  }

  try {
    const mod = (await import("firebase-admin")) as unknown as {
      default?: AdminModule;
    } & AdminModule;
    const admin = (mod.default ?? mod) as AdminModule;
    const apps = (admin as { apps?: unknown[] }).apps;
    if (!Array.isArray(apps) || apps.length === 0) {
      const serviceAccount = JSON.parse(fs.readFileSync(credPath, "utf8")) as object;
      admin.initializeApp({
        credential: admin.credential.cert(serviceAccount as never),
        databaseURL: process.env.NXSOCKET_FIREBASE_DATABASE_URL,
      });
    }
    adminSingleton = admin;
    initError = null;
    console.log(`[firebase-admin] siap (${path.basename(credPath)})`);
    return admin;
  } catch (err) {
    initError = err instanceof Error ? err.message : String(err);
    console.warn("[firebase-admin]", initError);
    return null;
  }
}
