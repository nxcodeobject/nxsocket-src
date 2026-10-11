#!/usr/bin/env node
import "../shared/load-env.js";
import { Command } from "commander";
import { loadConfig } from "../shared/config.js";
import { createTokenStore } from "../shared/create-store.js";
import { formatGatewayEndpoints } from "../shared/net.js";
import { printNetworkUrlQr, printTokenQr } from "../shared/qr.js";
import type { AdapterKind } from "../shared/types.js";
import { startServer } from "../server/index.js";
import { printNxsocketBanner } from "./banner.js";

printNxsocketBanner();

const program = new Command();

program
  .name("nxsocket")
  .description("CLI untuk menjalankan NxSocket Server & mengelola gateway token")
  .version("0.2.0");

program
  .command("server")
  .description("Jalankan NxSocket Endpoint Gateway / Server")
  .option("-p, --port <number>", "Port listen", (v) => Number(v))
  .option("-H, --host <host>", "Host bind")
  .option("--path <prefix>", "Path prefix gateway, default /v1")
  .option("--data-dir <dir>", "Direktori data")
  .option("--adapter <kind>", "Adapter data: json | sqlite | firebase (default: sqlite)", "sqlite")
  .option("--firebase-credentials <path>", "Path service account Firebase JSON")
  .option("--https", "Aktifkan HTTPS self-signed (disarankan untuk mic HP)", false)
  .action(async (opts: {
    port?: number;
    host?: string;
    path?: string;
    dataDir?: string;
    adapter?: string;
    firebaseCredentials?: string;
    https?: boolean;
  }) => {
    const runtime = await startServer({
      port: opts.port,
      host: opts.host,
      pathPrefix: opts.path,
      dataDir: opts.dataDir,
      adapter: opts.adapter as AdapterKind | undefined,
      firebaseCredentials: opts.firebaseCredentials,
      https: Boolean(opts.https),
      printBanner: true,
    });

    const shutdown = async () => {
      console.log("\nMematikan NxSocket...");
      await runtime.close();
      process.exit(0);
    };

    process.on("SIGINT", () => void shutdown());
    process.on("SIGTERM", () => void shutdown());
  });

const gateway = program.command("gateway").description("Kelola Endpoint Gateway");

function adapterOpts(opts: {
  dataDir?: string;
  adapter?: string;
  firebaseCredentials?: string;
  port?: number;
  https?: boolean;
}) {
  return {
    dataDir: opts.dataDir,
    adapter: opts.adapter as AdapterKind | undefined,
    firebaseCredentials: opts.firebaseCredentials,
    port: opts.port,
    https: opts.https,
  };
}

gateway
  .command("info")
  .description("Tampilkan endpoint gateway & token aktif")
  .option("--data-dir <dir>", "Direktori data")
  .option("--adapter <kind>", "Adapter data: json | sqlite | firebase")
  .option("--firebase-credentials <path>", "Path service account Firebase JSON")
  .option("-p, --port <number>", "Port (untuk tampilan URL)", (v) => Number(v))
  .option("--https", "Tampilkan URL sebagai https", false)
  .action(async (opts: {
    dataDir?: string;
    adapter?: string;
    firebaseCredentials?: string;
    port?: number;
    https?: boolean;
  }) => {
    const { store, config, close } = await createTokenStore({
      ...adapterOpts(opts),
      https: Boolean(opts.https),
    });
    try {
      const token = await store.ensureDefault();
      console.log("Endpoint gateway:");
      for (const line of formatGatewayEndpoints({ ...config, https: Boolean(opts.https) })) {
        console.log(`  ${line}`);
      }
      console.log(`  Token   : ${token.token}`);
      console.log(`  Token ID: ${token.id}`);
      console.log(`  Label   : ${token.label}`);
      console.log(`  Scopes  : ${(token.scopes ?? ["*"]).join(",")}`);
      console.log(`  Expires : ${token.expiresAt ?? "never"}`);
      console.log(`  Adapter : ${config.adapter}`);
      printTokenQr(token.token);
      printNetworkUrlQr({
        config: { ...config, https: Boolean(opts.https) },
        token: token.token,
        page: "demo3",
        https: Boolean(opts.https),
      });
    } finally {
      await close();
    }
  });

gateway
  .command("qr")
  .description("Tampilkan QR token di terminal (token saja)")
  .option("--data-dir <dir>", "Direktori data")
  .option("--adapter <kind>", "Adapter data: json | sqlite | firebase", "sqlite")
  .option("--firebase-credentials <path>", "Path service account Firebase JSON")
  .option("-p, --port <number>", "Port (opsional)")
  .action(async (opts: {
    dataDir?: string;
    adapter?: string;
    firebaseCredentials?: string;
    port?: number;
  }) => {
    const { store, close } = await createTokenStore(adapterOpts(opts));
    try {
      const token = await store.ensureDefault();
      printTokenQr(token.token);
    } finally {
      await close();
    }
  });

gateway
  .command("qr-url")
  .description("Tampilkan QR URL jaringan HTTPS (demo2 + token) untuk scan HP")
  .option("--data-dir <dir>", "Direktori data")
  .option("--adapter <kind>", "Adapter data: json | sqlite | firebase", "sqlite")
  .option("-p, --port <number>", "Port", (v) => Number(v))
  .option("--http", "Pakai http:// (mic HP biasanya gagal)", false)
  .option("--page <name>", "demo | demo2 | … | demo7", "demo3")
  .option("--ip <ip>", "Pilih IP jaringan")
  .action(async (opts: {
    dataDir?: string;
    adapter?: string;
    port?: number;
    http?: boolean;
    page?: string;
    ip?: string;
  }) => {
    const { store, config, close } = await createTokenStore(adapterOpts(opts));
    try {
      const token = await store.ensureDefault();
      const useHttps = !opts.http;
      const allowed = new Set([
        "demo",
        "demo2",
        "demo3",
        "demo4",
        "demo5",
        "demo6",
        "demo7",
      ]);
      const page = allowed.has(String(opts.page))
        ? (opts.page as
            | "demo"
            | "demo2"
            | "demo3"
            | "demo4"
            | "demo5"
            | "demo6"
            | "demo7")
        : "demo3";
      printNetworkUrlQr({
        config: { ...config, https: useHttps },
        token: token.token,
        page,
        https: useHttps,
        ip: opts.ip,
      });
      if (useHttps) {
        console.log("Pastikan server jalan dengan: nxsocket server --https");
      }
    } finally {
      await close();
    }
  });

const tokenCmd = gateway.command("token").description("Kelola gateway token");

tokenCmd
  .command("create")
  .description("Buat gateway token baru")
  .option("-l, --label <label>", "Label / nama user", "default")
  .option("--expires <dur>", "Masa berlaku: 1h, 7d, 30d, never", "never")
  .option(
    "--scope <list>",
    "Scope dipisah koma: * | chat,call,presence,notify,monitor,track,ai,terminal,progress,job,sync,admin",
    "*",
  )
  .option(
    "--rooms <list>",
    "ACL room dipisah koma (kosong/* = semua room)",
  )
  .option("--data-dir <dir>", "Direktori data")
  .option("--adapter <kind>", "Adapter data: json | sqlite | firebase")
  .option("--firebase-credentials <path>", "Path service account Firebase JSON")
  .action(async (opts: {
    label: string;
    expires: string;
    scope: string;
    rooms?: string;
    dataDir?: string;
    adapter?: string;
    firebaseCredentials?: string;
  }) => {
    const { store, config, close } = await createTokenStore(adapterOpts(opts));
    try {
      const record = await store.create({
        label: opts.label,
        expiresIn: opts.expires,
        scopes: opts.scope,
        rooms: opts.rooms,
      });
      printToken(record, config.adapter);
    } finally {
      await close();
    }
  });

tokenCmd
  .command("list")
  .description("Lihat token aktif")
  .option("--all", "Termasuk yang sudah di-revoke")
  .option("--data-dir <dir>", "Direktori data")
  .option("--adapter <kind>", "Adapter data: json | sqlite | firebase")
  .option("--firebase-credentials <path>", "Path service account Firebase JSON")
  .action(async (opts: {
    all?: boolean;
    dataDir?: string;
    adapter?: string;
    firebaseCredentials?: string;
  }) => {
    const { store, close } = await createTokenStore(adapterOpts(opts));
    try {
      await store.reload();
      const rows = store.list(Boolean(opts.all));
      if (rows.length === 0) {
        console.log("Belum ada token. Jalankan: nxsocket gateway token create");
        return;
      }
      for (const row of rows) {
        const scopes = (row.scopes ?? ["*"]).join(",");
        const rooms = row.allowedRooms?.length ? row.allowedRooms.join(",") : "*";
        const exp = row.expiresAt ?? "never";
        console.log(
          `${row.id}  ${row.label}  ${row.revokedAt ? "REVOKED" : "ACTIVE"}  scopes=${scopes}  rooms=${rooms}  exp=${exp}  ${row.token}`,
        );
      }
    } finally {
      await close();
    }
  });

tokenCmd
  .command("regenerate")
  .description("Regenerasi token (token lama invalid)")
  .argument("<id>", "Token ID")
  .option("--data-dir <dir>", "Direktori data")
  .option("--adapter <kind>", "Adapter data: json | sqlite | firebase")
  .option("--firebase-credentials <path>", "Path service account Firebase JSON")
  .action(async (id: string, opts: {
    dataDir?: string;
    adapter?: string;
    firebaseCredentials?: string;
  }) => {
    const { store, config, close } = await createTokenStore(adapterOpts(opts));
    try {
      const record = await store.regenerate(id);
      console.log("Token di-regenerate. Token lama tidak berlaku.");
      printToken(record, config.adapter);
    } finally {
      await close();
    }
  });

tokenCmd
  .command("revoke")
  .description("Cabut token")
  .argument("<id>", "Token ID")
  .option("--data-dir <dir>", "Direktori data")
  .option("--adapter <kind>", "Adapter data: json | sqlite | firebase")
  .option("--firebase-credentials <path>", "Path service account Firebase JSON")
  .action(async (id: string, opts: {
    dataDir?: string;
    adapter?: string;
    firebaseCredentials?: string;
  }) => {
    const { store, close } = await createTokenStore(adapterOpts(opts));
    try {
      const record = await store.revoke(id);
      console.log(`Token di-revoke: ${record.id}`);
    } finally {
      await close();
    }
  });

function printToken(record: {
  id: string;
  token: string;
  label: string;
  scopes?: string[];
  expiresAt?: string | null;
  allowedRooms?: string[] | null;
}, adapter?: string): void {
  const config = loadConfig();
  console.log("Endpoint gateway:");
  for (const line of formatGatewayEndpoints(config)) {
    console.log(`  ${line}`);
  }
  console.log(`  Token   : ${record.token}`);
  console.log(`  Token ID: ${record.id}`);
  console.log(`  Label   : ${record.label}`);
  console.log(`  Scopes  : ${(record.scopes ?? ["*"]).join(",")}`);
  console.log(
    `  Rooms   : ${record.allowedRooms?.length ? record.allowedRooms.join(",") : "*"}`,
  );
  console.log(`  Expires : ${record.expiresAt ?? "never"}`);
  if (adapter) console.log(`  Adapter : ${adapter}`);
  printTokenQr(record.token);
}

program.parseAsync(process.argv).catch((err: unknown) => {
  const message = err instanceof Error ? err.message : String(err);
  console.error(message);
  process.exit(1);
});
