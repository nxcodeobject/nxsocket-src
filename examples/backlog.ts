/**
 * Contoh Progress + Job + Sync
 */
import { createTokenStore } from "../src/shared/create-store.js";
import { NxSocketClient } from "../src/client/index.js";

const { store, config, close } = await createTokenStore();
const token = (await store.ensureDefault()).token;
await close();
const url = `http://127.0.0.1:${config.port}${config.pathPrefix}`;

const viewer = new NxSocketClient({ url, token, reconnect: false });
const worker = new NxSocketClient({ url, token, reconnect: false });

await Promise.all([
  new Promise<void>((r) => {
    viewer.on("welcome", () => r());
    viewer.connect();
  }),
  new Promise<void>((r) => {
    worker.on("welcome", () => r());
    worker.connect();
  }),
]);

viewer.on("progress.update", (m) => console.log("[progress]", m.percent + "%"));
viewer.on("progress.done", (m) => console.log("[progress done]", m.ok));
viewer.on("job.update", (m) => console.log("[job]", m.status, m.progress + "%"));
viewer.on("sync.update", (m) => console.log("[sync]", m.key, "=", m.value));

viewer.subscribeProgress("upload-demo");
viewer.subscribeJob("batch-1");
viewer.subscribeSync("doc:1");
await sleep(100);

for (const p of [10, 40, 80]) {
  worker.updateProgress("upload-demo", p, { loaded: p, total: 100 });
  await sleep(80);
}
worker.doneProgress("upload-demo", true);

worker.runJob("resize-images", "batch-1", 5);
worker.setSync("doc:1", "cursor", { line: 12, col: 4 });

await sleep(1000);
viewer.close();
worker.close();
console.log("example backlog selesai");

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}
