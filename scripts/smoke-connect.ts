/**
 * Smoke test: connect → welcome → ping/pong → disconnect
 */
import { createTokenStore } from "../src/shared/create-store.js";
import { NxSocketClient } from "../src/client/index.js";

const { store, config, close } = await createTokenStore();
const token = (await store.ensureDefault()).token;
await close();

const url = `http://127.0.0.1:${config.port}${config.pathPrefix}`;
const client = new NxSocketClient({
  url,
  token,
  reconnect: false,
});

let gotWelcome = false;
let gotPong = false;

const timeout = setTimeout(() => {
  console.error("FAIL: timeout menunggu welcome/pong");
  client.close();
  process.exit(1);
}, 8_000);

client.on("welcome", (sessionId) => {
  gotWelcome = true;
  console.log("OK welcome session=", sessionId);
  client.ping();
});

client.on("pong", (ts) => {
  gotPong = true;
  console.log("OK pong ts=", ts);
  clearTimeout(timeout);
  client.close();
  if (gotWelcome && gotPong) {
    console.log("SMOKE PASS");
    process.exit(0);
  }
  console.error("FAIL: state tidak lengkap");
  process.exit(1);
});

client.on("error", (err) => {
  console.error("error:", err.message);
});

client.on("close", (code, reason) => {
  if (!gotPong) {
    clearTimeout(timeout);
    console.error(`FAIL: closed early code=${code} reason=${reason}`);
    process.exit(1);
  }
});

console.log("Connecting to", url, "…");
client.connect();
