import path from "node:path";
import type { AdapterKind, ServerConfig } from "./types.js";

export function loadConfig(overrides: Partial<ServerConfig> = {}): ServerConfig {
  const port = Number(process.env.NXSOCKET_PORT ?? overrides.port ?? 7080);
  const host = process.env.NXSOCKET_HOST ?? overrides.host ?? "0.0.0.0";
  const pathPrefix = process.env.NXSOCKET_PATH ?? overrides.pathPrefix ?? "/v1";
  const dataDir =
    process.env.NXSOCKET_DATA_DIR ??
    overrides.dataDir ??
    path.resolve(process.cwd(), "data");

  const adapter = normalizeAdapter(
    process.env.NXSOCKET_ADAPTER ?? overrides.adapter ?? "sqlite",
  );

  return {
    host,
    port,
    pathPrefix: normalizePrefix(pathPrefix),
    heartbeatIntervalMs: Number(
      process.env.NXSOCKET_HEARTBEAT_INTERVAL_MS ?? overrides.heartbeatIntervalMs ?? 15_000,
    ),
    heartbeatTimeoutMs: Number(
      process.env.NXSOCKET_HEARTBEAT_TIMEOUT_MS ?? overrides.heartbeatTimeoutMs ?? 45_000,
    ),
    dataDir,
    adapter,
    firebaseCredentials:
      process.env.NXSOCKET_FIREBASE_CREDENTIALS ?? overrides.firebaseCredentials,
    firebaseDatabaseURL:
      process.env.NXSOCKET_FIREBASE_DATABASE_URL ?? overrides.firebaseDatabaseURL,
    rateLimitMax: Number(
      process.env.NXSOCKET_RATE_LIMIT_MAX ?? overrides.rateLimitMax ?? 60,
    ),
    rateLimitWindowMs: Number(
      process.env.NXSOCKET_RATE_LIMIT_WINDOW_MS ?? overrides.rateLimitWindowMs ?? 10_000,
    ),
    https: parseBool(process.env.NXSOCKET_HTTPS, overrides.https ?? false),
  };
}

function parseBool(env: string | undefined, fallback: boolean): boolean {
  if (env === undefined) return fallback;
  return ["1", "true", "yes", "on"].includes(env.trim().toLowerCase());
}

function normalizePrefix(prefix: string): string {
  const withSlash = prefix.startsWith("/") ? prefix : `/${prefix}`;
  return withSlash.replace(/\/+$/, "") || "/v1";
}

function normalizeAdapter(value: string): AdapterKind {
  const v = value.trim().toLowerCase();
  if (v === "sqlite" || v === "firebase" || v === "json") return v;
  throw new Error(`Adapter tidak dikenal: ${value}. Pakai: json | sqlite | firebase`);
}
