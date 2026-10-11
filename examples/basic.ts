import { createTokenStore } from "../src/shared/create-store.js";
import { NxSocketClient } from "../src/client/index.js";

const { store, config, close } = await createTokenStore();
const token = (await store.ensureDefault()).token;
await close();
const url = `http://127.0.0.1:${config.port}${config.pathPrefix}`;

function makeClient(name: string): NxSocketClient {
  const client = new NxSocketClient({ url, token, reconnect: false });
  client.on("welcome", (sessionId) => {
    console.log(`[${name}] welcome`, sessionId);
    client.join("lobby");
  });
  client.on("joined", (room) => {
    console.log(`[${name}] joined`, room);
    if (name === "A") {
      setTimeout(() => {
        client.broadcast(room, "chat", { text: "halo dari A" });
      }, 300);
    }
  });
  client.on("event", (payload) => {
    console.log(`[${name}] event`, payload.event, payload.data);
  });
  client.on("error", (err) => console.error(`[${name}]`, err.message));
  client.connect();
  return client;
}

const a = makeClient("A");
const b = makeClient("B");

setTimeout(() => {
  a.close();
  b.close();
  process.exit(0);
}, 2000);
