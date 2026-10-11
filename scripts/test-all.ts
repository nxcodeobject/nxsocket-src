/**
 * Test suite inti: start server sementara → jalankan smoke → tutup.
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawn } from "node:child_process";
import { startServer } from "../src/server/index.js";

const port = 17080;
const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "nxsocket-test-"));

process.env.NXSOCKET_PORT = String(port);
process.env.NXSOCKET_DATA_DIR = dataDir;
process.env.NXSOCKET_ADAPTER = "sqlite";

const runtime = await startServer({
  port,
  host: "127.0.0.1",
  dataDir,
  adapter: "sqlite",
  printBanner: false,
});

console.log("test server up on", port, dataDir);

async function run(script: string): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    const child = spawn("npx", ["tsx", script], {
      cwd: process.cwd(),
      env: { ...process.env },
      stdio: "inherit",
      shell: true,
    });
    child.on("exit", (code) => {
      if (code === 0) resolve();
      else reject(new Error(`${script} exit ${code}`));
    });
  });
}

try {
  await run("scripts/smoke-connect.ts");
  await run("scripts/smoke-fase4.ts");
  await run("scripts/smoke-fase6.ts");
  await run("scripts/smoke-backlog.ts");
  await run("scripts/smoke-sqlite.ts");
  console.log("TEST ALL PASS");
} finally {
  await runtime.close();
  fs.rmSync(dataDir, { recursive: true, force: true });
}
