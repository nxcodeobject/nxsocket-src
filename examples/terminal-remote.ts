/**
 * Demo Remote Terminal — kirim perintah ke PC server, terima output.
 *
 * Prerequisite: nxsocket server sudah jalan (boleh --https)
 *
 *   npx tsx examples/terminal-remote.ts
 */
import { createTokenStore } from "../src/shared/create-store.js";
import { NxSocketClient } from "../src/client/index.js";

// Self-signed HTTPS: izinkan sertifikat lokal saat tes
process.env.NODE_TLS_REJECT_UNAUTHORIZED ??= "0";

const { store, config, close } = await createTokenStore({
  dataDir: process.env.NXSOCKET_DATA_DIR,
  adapter: (process.env.NXSOCKET_ADAPTER as "sqlite" | "json") || undefined,
});
const token = (await store.ensureDefault()).token;
await close();

const scheme = process.env.NXSOCKET_HTTPS === "0" ? "http" : "https";
const url = `${scheme}://127.0.0.1:${config.port}${config.pathPrefix}`;
console.log("Connecting", url);

const client = new NxSocketClient({ url, token, reconnect: false });

await new Promise<void>((resolve, reject) => {
  const t = setTimeout(() => reject(new Error("timeout connect")), 8000);
  client.on("welcome", () => {
    clearTimeout(t);
    resolve();
  });
  client.on("error", (err) => console.warn("ws error", err.message));
  client.connect();
});

console.log("Online — kirim perintah allowlist…\n");

client.on("terminal.started", (msg) => {
  console.log(`> ${msg.command}`);
});
client.on("terminal.output", (msg) => {
  process.stdout.write(msg.chunk);
});
client.on("terminal.exit", (msg) => {
  console.log(`(exit ${msg.code})\n`);
});
client.on("message", (msg) => {
  if (msg.type === "error") console.log("! ", msg.message, "\n");
});

const commands = ["hostname", "whoami", "echo halo-dari-remote-terminal", "dir"];
for (const cmd of commands) {
  client.exec(cmd);
  await sleep(900);
}

// Harus ditolak allowlist
client.exec("rm -rf /");
await sleep(600);

client.close();
console.log("TERMINAL REMOTE OK");
process.exit(0);

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}
