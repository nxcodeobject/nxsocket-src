/**
 * Demo Fase 6 singkat
 */
import { createTokenStore } from "../src/shared/create-store.js";
import { NxSocketClient } from "../src/client/index.js";

const { store, config, close } = await createTokenStore();
const token = (await store.ensureDefault()).token;
await close();
const url = `http://127.0.0.1:${config.port}${config.pathPrefix}`;

const c = new NxSocketClient({ url, token, reconnect: false });

await new Promise<void>((resolve) => {
  c.on("welcome", () => resolve());
  c.connect();
});

c.on("tracking.update", (m) => console.log("track", m.target, m.lat, m.lng));
c.on("ai.chunk", (m) => process.stdout.write(m.text));
c.on("ai.done", (m) => console.log("\nAI done:", m.reason));
c.on("terminal.output", (m) => process.stdout.write(m.chunk));
c.on("terminal.exit", (m) => console.log("\nexit", m.code));
c.on("error", (e) => console.error("err", e.message));

c.subscribeTracking("unit-1");
c.updateTracking("unit-1", -6.2, 106.8);
c.startAi("NxSocket streaming satu dua tiga");
c.exec(process.platform === "win32" ? "echo hello" : "echo hello");

await sleep(1500);
c.close();
process.exit(0);

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}
