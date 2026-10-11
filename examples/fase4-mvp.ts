/**
 * Demo Fase 4: presence → chat → typing → notification → monitoring
 */
import { createTokenStore } from "../src/shared/create-store.js";
import { NxSocketClient } from "../src/client/index.js";

const { store, config, close } = await createTokenStore();
const token = (await store.ensureDefault()).token;
await close();
const url = `http://127.0.0.1:${config.port}${config.pathPrefix}`;

function client(name: string): NxSocketClient {
  const c = new NxSocketClient({ url, token, reconnect: false });
  c.on("error", (err) => console.error(`[${name}]`, err.message));
  c.on("presence.update", (msg) => {
    console.log(`[${name}] presence`, msg.user.name, msg.user.status, msg.room ?? "global");
  });
  c.on("presence.snapshot", (msg) => {
    console.log(`[${name}] snapshot`, msg.scope, msg.users.map((u) => u.name).join(", "));
  });
  c.on("chat.typing", (msg) => {
    console.log(`[${name}] typing`, msg.name, msg.typing);
  });
  c.on("chat.message", (msg) => {
    console.log(`[${name}] chat`, `${msg.name}: ${msg.text}`);
  });
  c.on("notification", (msg) => {
    console.log(`[${name}] notif`, msg.title, "-", msg.body);
  });
  c.on("monitoring.stats", (msg) => {
    console.log(`[${name}] monitor`, `conn=${msg.connections} rooms=${msg.rooms}`);
  });
  return c;
}

const a = client("A");
const b = client("B");
const monitor = client("M");

await new Promise<void>((resolve) => {
  let ready = 0;
  const onReady = () => {
    ready += 1;
    if (ready === 3) resolve();
  };
  a.on("welcome", onReady);
  b.on("welcome", onReady);
  monitor.on("welcome", onReady);
  a.connect();
  b.connect();
  monitor.connect();
});

monitor.subscribeMonitoring();
a.identify("Iyan");
b.identify("Budi");
a.subscribePresence("global");
b.subscribePresence("global");

await sleep(200);
a.join("lobby");
b.join("lobby");
await sleep(200);

a.typing("lobby", true);
await sleep(200);
a.typing("lobby", false);
a.chat("lobby", "halo dari Iyan");
await sleep(200);

b.notify({
  title: "Pesanan masuk",
  body: "Ada order baru #42",
  room: "lobby",
});

await sleep(400);
a.close();
b.close();
monitor.close();
console.log("FASE4 DEMO DONE");
process.exit(0);

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}
