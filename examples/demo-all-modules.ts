/**
 * Demo uji semua modul yang sudah tersedia.
 *
 * Prerequisite:
 *   nxsocket server --adapter sqlite
 *
 * Jalankan:
 *   npm run example:demo
 */
import { createTokenStore } from "../src/shared/create-store.js";
import { NxSocketClient } from "../src/client/index.js";

type Result = { name: string; ok: boolean; detail?: string };

const results: Result[] = [];
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

function log(section: string, msg: string): void {
  console.log(`  [${section}] ${msg}`);
}

function pass(name: string, detail?: string): void {
  results.push({ name, ok: true, detail });
  console.log(`  ✅ ${name}${detail ? ` — ${detail}` : ""}`);
}

function fail(name: string, detail?: string): void {
  results.push({ name, ok: false, detail });
  console.log(`  ❌ ${name}${detail ? ` — ${detail}` : ""}`);
}

console.log("=== NxSocket Demo Semua Modul ===\n");

const { store, config, close } = await createTokenStore();
const token = (await store.ensureDefault()).token;
await close();
const url = `http://127.0.0.1:${config.port}${config.pathPrefix}`;
console.log(`Gateway : ${url}`);
console.log(`Adapter : ${config.adapter}`);
console.log(`Token   : ${token.slice(0, 12)}…\n`);

const alice = new NxSocketClient({ url, token, reconnect: false });
const bob = new NxSocketClient({ url, token, reconnect: false });

alice.on("error", (e) => log("Alice", `error: ${e.message}`));
bob.on("error", (e) => log("Bob", `error: ${e.message}`));

// ---- Connect ----
console.log("1) Core — Connect & Identify");
try {
  await Promise.all([
    new Promise<void>((resolve, reject) => {
      const t = setTimeout(() => reject(new Error("timeout Alice")), 5000);
      alice.on("welcome", (id) => {
        clearTimeout(t);
        log("Alice", `welcome ${id}`);
        resolve();
      });
      alice.connect();
    }),
    new Promise<void>((resolve, reject) => {
      const t = setTimeout(() => reject(new Error("timeout Bob")), 5000);
      bob.on("welcome", (id) => {
        clearTimeout(t);
        log("Bob", `welcome ${id}`);
        resolve();
      });
      bob.connect();
    }),
  ]);
  alice.identify("Alice");
  bob.identify("Bob");
  await sleep(150);
  pass("Connect + Identify");
} catch (err) {
  fail("Connect + Identify", err instanceof Error ? err.message : String(err));
  console.error("\nServer belum jalan? Jalankan dulu:\n  nxsocket server --adapter sqlite\n");
  process.exit(1);
}

// ---- Presence ----
console.log("\n2) Presence — online/offline");
{
  let got = false;
  bob.on("presence.update", (msg) => {
    if (msg.user.name === "Alice" && msg.user.status === "online") got = true;
  });
  bob.subscribePresence("global");
  await sleep(100);
  alice.identify("Alice");
  await sleep(300);
  if (got) pass("Presence");
  else fail("Presence", "tidak terima presence.update");
}

// ---- Chat + Typing ----
console.log("\n3) Chat + Typing");
{
  let typing = false;
  let chat = false;
  bob.on("chat.typing", (msg) => {
    if (msg.name === "Alice" && msg.typing) typing = true;
  });
  bob.on("chat.message", (msg) => {
    log("Bob", `chat: ${msg.name}: ${msg.text}`);
    if (msg.text.includes("Halo demo")) chat = true;
  });
  alice.join("demo-room");
  bob.join("demo-room");
  await sleep(150);
  alice.typing("demo-room", true);
  await sleep(100);
  alice.typing("demo-room", false);
  alice.chat("demo-room", "Halo demo dari Alice");
  await sleep(300);
  if (typing && chat) pass("Chat + Typing");
  else fail("Chat + Typing", `typing=${typing} chat=${chat}`);
}

// ---- Notification ----
console.log("\n4) Notification");
{
  let got = false;
  bob.on("notification", (msg) => {
    log("Bob", `notif: ${msg.title} — ${msg.body}`);
    if (msg.title === "Demo") got = true;
  });
  alice.notify({ title: "Demo", body: "Notifikasi uji modul", room: "demo-room" });
  await sleep(250);
  if (got) pass("Notification");
  else fail("Notification");
}

// ---- Monitoring ----
console.log("\n5) Monitoring");
{
  let got = false;
  bob.on("monitoring.stats", (msg) => {
    log("Bob", `stats conn=${msg.connections} rooms=${msg.rooms}`);
    if (msg.connections >= 1) got = true;
  });
  bob.subscribeMonitoring();
  bob.getMonitoring();
  await sleep(250);
  if (got) pass("Monitoring");
  else fail("Monitoring");
}

// ---- Tracking ----
console.log("\n6) Tracking");
{
  let got = false;
  bob.on("tracking.update", (msg) => {
    log("Bob", `track ${msg.target} ${msg.lat},${msg.lng}`);
    if (msg.target === "bus-demo" && msg.lat === -6.2) got = true;
  });
  bob.subscribeTracking("bus-demo");
  await sleep(100);
  alice.updateTracking("bus-demo", -6.2, 106.8, { speed: 42 });
  await sleep(250);
  if (got) pass("Tracking");
  else fail("Tracking");
}

// ---- AI streaming ----
console.log("\n7) AI streaming (demo)");
{
  let chunks = 0;
  let done = false;
  process.stdout.write("  ");
  alice.on("ai.chunk", (msg) => {
    chunks += 1;
    process.stdout.write(msg.text);
  });
  alice.on("ai.done", (msg) => {
    done = msg.reason === "completed";
    console.log(`\n  [AI] done=${msg.reason} chunks=${chunks}`);
  });
  alice.startAi("Satu dua tiga empat lima", "demo-ai");
  await sleep(800);
  if (chunks > 0 && done) pass("AI streaming", `${chunks} chunks`);
  else fail("AI streaming", `chunks=${chunks} done=${done}`);
}

// ---- Terminal ----
console.log("\n8) Remote Terminal");
{
  let output = false;
  let exited = false;
  let denied = false;
  alice.on("terminal.output", (msg) => {
    output = true;
    log("Term", msg.chunk.trim());
  });
  alice.on("terminal.exit", () => {
    exited = true;
  });
  alice.on("error", (err) => {
    if (err.message.includes("tidak diizinkan")) denied = true;
  });
  alice.exec("echo nxsocket-demo");
  await sleep(400);
  alice.exec("rm -rf /");
  await sleep(200);
  if (output && exited && denied) pass("Terminal", "exec OK + perintah berbahaya ditolak");
  else fail("Terminal", `output=${output} exit=${exited} denied=${denied}`);
}

// ---- WebRTC signaling ----
console.log("\n9) WebRTC signaling");
{
  let got = false;
  bob.on("webrtc.signal", (msg) => {
    log("Bob", `signal ${msg.signal} from=${msg.from.slice(0, 8)}`);
    if (msg.signal === "offer") got = true;
  });
  alice.join("call-demo");
  bob.join("call-demo");
  await sleep(150);
  alice.webrtcSignal("call-demo", "offer", { sdp: "v=0-demo" });
  await sleep(250);
  if (got) pass("WebRTC signaling");
  else fail("WebRTC signaling");
}

// ---- Summary ----
alice.close();
bob.close();

const okCount = results.filter((r) => r.ok).length;
const failCount = results.length - okCount;

console.log("\n=== Ringkasan ===");
for (const r of results) {
  console.log(`${r.ok ? "✅" : "❌"} ${r.name}`);
}
console.log(`\nLulus: ${okCount}/${results.length}`);

if (failCount > 0) {
  console.log("Ada modul yang gagal. Pastikan server jalan di port yang sama.");
  process.exit(1);
}

console.log("Semua modul yang tersedia lulus uji demo.");
process.exit(0);
