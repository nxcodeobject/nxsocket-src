/**
 * Smoke Fase 6: tracking + AI stream + terminal allowlist + webrtc signal
 */
import { createTokenStore } from "../src/shared/create-store.js";
import { NxSocketClient } from "../src/client/index.js";

const { store, config, close } = await createTokenStore();
const token = (await store.ensureDefault()).token;
await close();
const url = `http://127.0.0.1:${config.port}${config.pathPrefix}`;

const checks = {
  tracking: false,
  ai: false,
  terminal: false,
  terminalDenied: false,
  webrtc: false,
};

const a = new NxSocketClient({ url, token, reconnect: false });
const b = new NxSocketClient({ url, token, reconnect: false });

await Promise.all([
  new Promise<void>((r) => {
    a.on("welcome", () => r());
    a.connect();
  }),
  new Promise<void>((r) => {
    b.on("welcome", () => r());
    b.connect();
  }),
]);

a.on("error", (err) => {
  if (err.message.includes("tidak diizinkan")) checks.terminalDenied = true;
});

b.on("tracking.update", (msg) => {
  if (msg.target === "bus-1" && msg.lat === -6.2) checks.tracking = true;
});

let aiChunks = 0;
a.on("ai.chunk", () => {
  aiChunks += 1;
});
a.on("ai.done", (msg) => {
  if (msg.reason === "completed" && aiChunks > 0) checks.ai = true;
});

a.on("terminal.exit", () => {
  checks.terminal = true;
});

b.on("webrtc.signal", (msg) => {
  if (msg.signal === "offer") checks.webrtc = true;
});

b.subscribeTracking("bus-1");
await sleep(100);
a.updateTracking("bus-1", -6.2, 106.8, { speed: 40 });

a.startAi("halo dunia dari nxsocket", "s1");

a.exec("echo hello-nxsocket");
a.exec("rm -rf /"); // harus ditolak

a.join("call");
b.join("call");
await sleep(100);
a.webrtcSignal("call", "offer", { sdp: "v=0" });

await sleep(1200);

a.close();
b.close();

const failed = Object.entries(checks).filter(([, ok]) => !ok).map(([k]) => k);
if (failed.length) {
  console.error("FASE6 FAIL", failed, checks);
  process.exit(1);
}
console.log("FASE6 PASS", checks);
process.exit(0);

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}
