import { createTokenStore } from "../src/shared/create-store.js";
import { NxSocketClient } from "../src/client/index.js";

function tryConnect(token: string, port: number, pathPrefix: string): Promise<"ok" | "fail"> {
  return new Promise((resolve) => {
    const client = new NxSocketClient({
      url: `http://127.0.0.1:${port}${pathPrefix}`,
      token,
      reconnect: false,
    });
    const timer = setTimeout(() => {
      client.close();
      resolve("fail");
    }, 2500);
    client.on("welcome", () => {
      clearTimeout(timer);
      client.close();
      resolve("ok");
    });
    client.on("error", () => {
      /* wait for close */
    });
    client.on("close", () => {
      clearTimeout(timer);
      resolve("fail");
    });
    client.connect();
  });
}

const { store, config, close } = await createTokenStore();
const current = await store.ensureDefault();
const oldToken = current.token;

const before = await tryConnect(oldToken, config.port, config.pathPrefix);
console.log("before regenerate:", before);

const regenerated = await store.regenerate(current.id);
const afterOld = await tryConnect(oldToken, config.port, config.pathPrefix);
const afterNew = await tryConnect(regenerated.token, config.port, config.pathPrefix);
await close();

console.log("old token after regenerate:", afterOld);
console.log("new token after regenerate:", afterNew);

if (before === "ok" && afterOld === "fail" && afterNew === "ok") {
  console.log("REGENERATE PASS");
  process.exit(0);
}

console.error("REGENERATE FAIL");
process.exit(1);
