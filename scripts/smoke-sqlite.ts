/**
 * Uji adapter SQLite: buat token + simpan chat + baca ulang.
 */
import { createAdapter } from "../src/adapters/index.js";
import { TokenStore } from "../src/shared/token-store.js";
import { loadConfig } from "../src/shared/config.js";

const config = loadConfig({ adapter: "sqlite" });
const dataDir = config.dataDir;
const adapter = await createAdapter("sqlite", { dataDir });
const store = new TokenStore(adapter);
const token = await store.ensureDefault();
console.log("sqlite token ok", token.id);

await adapter.saveChat({
  id: "test-1",
  room: "lobby",
  text: "hello sqlite",
  from: "u1",
  name: "Tester",
  ts: new Date().toISOString(),
});

const history = await adapter.listChat("lobby", 10);
console.log("chat rows", history.length, history.at(-1)?.text);

await adapter.close();

const again = await createAdapter("sqlite", { dataDir });
const history2 = await again.listChat("lobby", 10);
console.log("after reopen", history2.length);
await again.close();

if (history2.length < 1) {
  console.error("SQLITE FAIL");
  process.exit(1);
}
console.log("SQLITE PASS");
