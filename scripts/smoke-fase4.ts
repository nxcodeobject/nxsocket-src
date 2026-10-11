import { createTokenStore } from "../src/shared/create-store.js";
import { NxSocketClient } from "../src/client/index.js";

const { store, config, close } = await createTokenStore();
const token = (await store.ensureDefault()).token;
await close();
const url = `http://127.0.0.1:${config.port}${config.pathPrefix}`;

const checks = {
  presence: false,
  chat: false,
  typing: false,
  notification: false,
  monitoring: false,
};

const watcher = new NxSocketClient({ url, token, reconnect: false });
const sender = new NxSocketClient({ url, token, reconnect: false });

await Promise.all([
  new Promise<void>((resolve) => {
    watcher.on("welcome", () => resolve());
    watcher.connect();
  }),
  new Promise<void>((resolve) => {
    sender.on("welcome", () => resolve());
    sender.connect();
  }),
]);

watcher.on("presence.update", (msg) => {
  if (msg.user.status === "online") checks.presence = true;
});
watcher.on("chat.typing", () => {
  checks.typing = true;
});
watcher.on("chat.message", () => {
  checks.chat = true;
});
watcher.on("notification", () => {
  checks.notification = true;
});
watcher.on("monitoring.stats", (msg) => {
  if (msg.connections >= 1) checks.monitoring = true;
});

watcher.subscribePresence("global");
watcher.subscribeMonitoring();
watcher.identify("Watcher");
sender.identify("Sender");

await sleep(150);
watcher.join("lobby");
sender.join("lobby");
await sleep(150);

sender.typing("lobby", true);
sender.chat("lobby", "ping fase4");
sender.notify({ title: "Test", body: "Notifikasi OK", room: "lobby" });

await sleep(500);

watcher.close();
sender.close();

const failed = Object.entries(checks).filter(([, ok]) => !ok).map(([k]) => k);
if (failed.length) {
  console.error("FASE4 FAIL:", failed.join(", "), checks);
  process.exit(1);
}

console.log("FASE4 PASS", checks);
process.exit(0);

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}
