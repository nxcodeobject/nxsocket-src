/**
 * Smoke backlog: progress + job + sync
 */
import { createTokenStore } from "../src/shared/create-store.js";
import { NxSocketClient } from "../src/client/index.js";

const { store, config, close } = await createTokenStore();
const token = (await store.ensureDefault()).token;
await close();
const url = `http://127.0.0.1:${config.port}${config.pathPrefix}`;

const checks = {
  progress: false,
  progressDone: false,
  jobDone: false,
  sync: false,
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

b.on("progress.update", (msg) => {
  if (msg.id === "up-1" && msg.percent === 50) checks.progress = true;
});
b.on("progress.done", (msg) => {
  if (msg.id === "up-1" && msg.ok) checks.progressDone = true;
});
b.on("job.update", (msg) => {
  if (msg.jobId === "job-demo" && msg.status === "done") checks.jobDone = true;
});
b.on("sync.update", (msg) => {
  if (msg.channel === "board" && msg.key === "title" && msg.value === "hello") {
    checks.sync = true;
  }
});

b.subscribeProgress("up-1");
b.subscribeJob("job-demo");
b.subscribeSync("board");
await sleep(80);

a.updateProgress("up-1", 50, { loaded: 50, total: 100 });
a.doneProgress("up-1", true, { file: "a.bin" });
a.runJob("export-csv", "job-demo", 4);
a.setSync("board", "title", "hello");

await sleep(900);

a.close();
b.close();

const failed = Object.entries(checks).filter(([, ok]) => !ok).map(([k]) => k);
if (failed.length) {
  console.error("BACKLOG FAIL", failed, checks);
  process.exit(1);
}
console.log("BACKLOG PASS", checks);
process.exit(0);

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}
