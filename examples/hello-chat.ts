/**
 * Hello chat — demo <15 menit dari README.
 *
 * Prerequisite: nxsocket server sudah jalan
 */
import { createTokenStore } from "../src/shared/create-store.js";
import { NxSocketClient } from "../src/client/index.js";

const { store, config, close } = await createTokenStore();
const token = (await store.ensureDefault()).token;
await close();

const url = `http://127.0.0.1:${config.port}${config.pathPrefix}`;
console.log("Connecting", url);

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

a.identify("Alice");
b.identify("Bob");

b.on("chat.message", (msg) => {
  console.log(`[Bob terima] ${msg.name}: ${msg.text}`);
});

a.join("hello");
b.join("hello");
await sleep(200);
a.chat("hello", "Halo dari Alice!");
await sleep(500);

a.close();
b.close();
console.log("HELLO CHAT OK");
process.exit(0);

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}
