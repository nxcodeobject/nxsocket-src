/**
 * Demo AI streaming — token/chunk dikirim bertahap lewat WebSocket.
 *
 * Tanpa NXSOCKET_AI_API_KEY / OPENAI_API_KEY → fallback demo (pecah kata).
 * Dengan API key → stream dari OpenAI-compatible provider.
 *
 * Prerequisite: nxsocket server sudah jalan
 *
 *   npx tsx examples/ai-stream.ts
 */
import { createTokenStore } from "../src/shared/create-store.js";
import { NxSocketClient } from "../src/client/index.js";

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
console.log(
  "Mode:",
  process.env.NXSOCKET_AI_API_KEY || process.env.OPENAI_API_KEY
    ? "OpenAI-compatible (API key terdeteksi di env proses ini — server pakai env saat start)"
    : "demo fallback (server tanpa key = pecah kata)",
);
console.log("");

const client = new NxSocketClient({ url, token, reconnect: false });

await new Promise<void>((resolve, reject) => {
  const t = setTimeout(() => reject(new Error("timeout connect")), 8000);
  client.on("welcome", () => {
    clearTimeout(t);
    resolve();
  });
  client.connect();
});

let assembled = "";
client.on("ai.chunk", (msg) => {
  assembled += msg.text;
  process.stdout.write(msg.text);
});
client.on("ai.done", (msg) => {
  console.log(`\n\n[done] reason=${msg.reason}`);
  console.log("[assembled]", assembled);
  client.close();
  console.log("AI STREAM OK");
  process.exit(0);
});
client.on("message", (msg) => {
  if (msg.type === "error") {
    console.log("\n! ", msg.message);
    client.close();
    process.exit(1);
  }
});

const prompt = "Halo NxSocket AI streaming satu dua tiga empat lima";
console.log("Prompt:", prompt);
console.log("--- chunks ---");
client.startAi(prompt);

setTimeout(() => {
  console.log("\n! timeout menunggu ai.done");
  client.close();
  process.exit(1);
}, 15000);
